// src/lib/CallContext.js
//
// Single persistent /calls/signal socket per app session, opened once
// CallProvider mounts with a real myUser. Owns all signaling + WebRTC state;
// CallOverlay and IncomingCallOverlay are pure consumers via useCallContext().
//
// Message shapes (matches the rewritten backend routes/calls.js):
//   → call-start   {to, conversationId, mode}
//   ← incoming-call {from, conversationId, mode}
//   → call-accept  {to, conversationId}
//   ← call-accept  {from, conversationId}
//   → call-decline {to, conversationId}
//   ← call-decline {from, conversationId}
//   ↔ offer/answer/ice-candidate {to/from, conversationId, sdp|candidate}
//   ↔ hangup {to/from, conversationId}
//   ← peer-left {from, conversationId}     (their socket dropped mid-call)
//   ← unavailable {conversationId}          (callee wasn't connected at all)
//
// Known gaps (flagging, not fixing here):
//   - Reconnect on close is a flat 3s retry, no backoff — fine for now,
//     revisit if Railway connection churn becomes a real problem.
//   - No handling for the Supabase access token expiring mid-session; the
//     socket just keeps using whatever token it opened with.
//   - No call-waiting: a second incoming-call while already on a call is
//     silently ignored (see the guard in the message handler below).

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { mediaDevices, RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'react-native-webrtc';
import { supabase } from './supabase';
import { API_BASE } from './api';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const CallContext = createContext(null);

export function CallProvider({ myUser, children }) {
  const [incomingCall, setIncomingCall] = useState(null); // { conversationId, mode, caller } | null
  const [activeCall, setActiveCall] = useState(null);     // { conversationId, mode, contact, isIncoming } | null
  const [phase, setPhase] = useState('idle');              // idle | ringing | active | ended
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const activeCallRef = useRef(null);
  const incomingCallRef = useRef(null);
  const knownUsers = useRef(new Map());
  activeCallRef.current = activeCall;
  incomingCallRef.current = incomingCall;

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(msg));
  }, []);

  const lookupUser = useCallback(async (userId) => {
    if (knownUsers.current.has(userId)) return knownUsers.current.get(userId);
    const { data } = await supabase
      .from('app_user_public')
      .select('id, display_name, color')
      .eq('id', userId)
      .maybeSingle();
    const info = data ? { id: data.id, name: data.display_name, color: data.color } : { id: userId, name: 'Unknown', color: '#888' };
    knownUsers.current.set(userId, info);
    return info;
  }, []);

  const teardownPeer = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
  }, [localStream]);

  const ensurePeerConnection = useCallback(async (peerId, conversationId, wantVideo) => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'ice-candidate', to: peerId, conversationId, candidate: e.candidate });
    };
    pc.ontrack = (e) => setRemoteStream(e.streams[0]);
    const stream = await mediaDevices.getUserMedia({ audio: true, video: wantVideo });
    setLocalStream(stream);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pcRef.current = pc;
    return pc;
  }, [send]);

  const endCall = useCallback(() => {
    teardownPeer();
    setActiveCall(null);
    setPhase('idle');
  }, [teardownPeer]);

  const startOutgoingCall = useCallback((peerId, conversationId, mode, contact) => {
    setActiveCall({ conversationId, mode, contact, isIncoming: false });
    setPhase('ringing');
    send({ type: 'call-start', to: peerId, conversationId, mode });
  }, [send]);

  const acceptIncomingCall = useCallback(() => {
    const call = incomingCallRef.current;
    if (!call) return;
    setActiveCall({ conversationId: call.conversationId, mode: call.mode, contact: call.caller, isIncoming: true });
    setPhase('ringing');
    send({ type: 'call-accept', to: call.caller.id, conversationId: call.conversationId });
    setIncomingCall(null);
  }, [send]);

  const declineIncomingCall = useCallback(() => {
    const call = incomingCallRef.current;
    if (!call) return;
    send({ type: 'call-decline', to: call.caller.id, conversationId: call.conversationId });
    setIncomingCall(null);
  }, [send]);

  const hangup = useCallback(() => {
    const call = activeCallRef.current;
    if (call) send({ type: 'hangup', to: call.contact.id, conversationId: call.conversationId });
    endCall();
  }, [send, endCall]);

  const handleMessage = useCallback(async (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    switch (msg.type) {
      case 'incoming-call': {
        if (activeCallRef.current) return; // already on a call — no call-waiting yet
        const caller = await lookupUser(msg.from);
        setIncomingCall({ conversationId: msg.conversationId, mode: msg.mode, caller });
        break;
      }

      case 'call-accept': {
        // We're the caller — peer accepted, now actually build the offer.
        const call = activeCallRef.current;
        if (!call || call.conversationId !== msg.conversationId) return;
        await ensurePeerConnection(call.contact.id, call.conversationId, call.mode === 'video');
        const offer = await pcRef.current.createOffer();
        await pcRef.current.setLocalDescription(offer);
        send({ type: 'offer', to: call.contact.id, conversationId: call.conversationId, sdp: offer });
        break;
      }

      case 'call-decline':
      case 'unavailable':
        if (activeCallRef.current?.conversationId === msg.conversationId) endCall();
        break;

      case 'offer': {
        // We're the callee — build our side and answer.
        const call = activeCallRef.current;
        if (!call || call.conversationId !== msg.conversationId) return;
        await ensurePeerConnection(call.contact.id, call.conversationId, call.mode === 'video');
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        send({ type: 'answer', to: call.contact.id, conversationId: call.conversationId, sdp: answer });
        setPhase('active');
        break;
      }

      case 'answer':
        if (pcRef.current) await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        setPhase('active');
        break;

      case 'ice-candidate':
        if (pcRef.current && msg.candidate) {
          try { await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
        }
        break;

      case 'hangup':
      case 'peer-left':
        if (activeCallRef.current?.conversationId === msg.conversationId) {
          endCall();
          setPhase('ended');
        }
        break;

      default:
        break;
    }
  }, [lookupUser, ensurePeerConnection, send, endCall]);

  // Persistent connection, opened once we have a real user; flat 3s retry
  // if it drops.
  useEffect(() => {
    if (!myUser?.id) return;
    let cancelled = false;
    let retryTimer = null;

    const connect = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || cancelled) return;
      const base = API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');
      const ws = new WebSocket(`${base}/calls/signal?token=${session.access_token}`);
      wsRef.current = ws;
      ws.onmessage = handleMessage;
      ws.onclose = () => {
        wsRef.current = null;
        if (!cancelled) retryTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [myUser?.id, handleMessage]);

  return (
    <CallContext.Provider value={{
      incomingCall, activeCall, phase, localStream, remoteStream,
      startOutgoingCall, acceptIncomingCall, declineIncomingCall, hangup,
    }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCallContext() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCallContext must be used within CallProvider');
  return ctx;
}
