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
//   ← call-decline {from, conversationId, reason}
//   ← call-busy    {conversationId, reason: 'busy'}      (target already on a call)
//   ← call-timeout {conversationId, reason: 'timeout'}   (server ring-timeout backstop)
//   ↔ offer/answer/ice-candidate {to/from, conversationId, sdp|candidate}
//   ↔ hangup {to/from, conversationId, reason}
//   ← peer-left {from, conversationId, reason: 'network_lost'}
//   ← unavailable {conversationId, reason: 'unavailable'}
//
// Call lifecycle, exposed as status: { state, reason }:
//   idle → dialing → connecting → active → idle
//              ↘ incoming (callee, pre-accept) → connecting → active → idle
//   `reason` is only meaningful right as a call ends: declined | busy |
//   unavailable | timeout | cancelled | hangup | network_lost | null.
//   A legacy `phase` string (idle|ringing|active|ended) is still exposed,
//   derived from `status`, so CallOverlay/IncomingCallOverlay keep working
//   unmodified until they're rewired to consume `status` directly.
//
// Known gaps (flagging, not fixing here):
//   - Reconnect on close is a flat 3s retry, no backoff — fine for now,
//     revisit if Railway connection churn becomes a real problem.
//   - No handling for the Supabase access token expiring mid-session; the
//     socket just keeps using whatever token it opened with.
//   - No call-waiting UI: a second incoming-call while already on a call
//     is silently ignored (server also now replies `call-busy` to the
//     second caller, so they at least get a signal).
//   - No incoming-side backgrounding auto-decline yet — only outgoing
//     (caller backgrounding pre-connect cancels). Revisit if it matters.
//   - Overlay-level double-tap guards (Accept/Decline/Hangup buttons)
//     still belong to CallOverlay/IncomingCallOverlay — not this file.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { mediaDevices, RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'react-native-webrtc';
import { supabase } from './supabase';
import * as signalSocket from './signalSocket';
import { getTurnCredentials } from './api';

const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

// Backstop behind the backend's own RING_TIMEOUT_MS (35s) — the server is
// authoritative and sends call-timeout to both parties, so this should
// rarely fire. It exists only for the case where that message itself
// never arrives (e.g. a network partition on this device specifically).
const CLIENT_DIALING_TIMEOUT_MS = 42000;

// Fetched fresh per call from the backend (which holds the Metered API
// key) rather than shipping static TURN credentials in the app bundle.
// Falls back to STUN-only if the fetch fails, so a call can still attempt
// a direct P2P path instead of failing outright.
async function resolveIceServers() {
  try {
    const res = await getTurnCredentials();
    if (res.ok && Array.isArray(res.data?.iceServers) && res.data.iceServers.length) {
      return res.data.iceServers;
    }
  } catch {
    // fall through to STUN-only
  }
  return FALLBACK_ICE_SERVERS;
}
const CallContext = createContext(null);

export function CallProvider({ myUser, children }) {
  const [incomingCall, setIncomingCall] = useState(null); // { conversationId, mode, caller } | null
  const [activeCall, setActiveCall] = useState(null);     // { conversationId, mode, contact, isIncoming } | null
  const [status, setStatus] = useState({ state: 'idle', reason: null }); // dialing|connecting|active|idle
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const pcRef = useRef(null);
  const activeCallRef = useRef(null);
  const incomingCallRef = useRef(null);
  const statusRef = useRef(status);
  const knownUsers = useRef(new Map());
  const dialingTimeoutRef = useRef(null);
  const callLockRef = useRef(false); // synchronous debounce, independent of render timing
  activeCallRef.current = activeCall;
  incomingCallRef.current = incomingCall;
  statusRef.current = status;

  const send = signalSocket.send;

  const setCallState = useCallback((state, reason = null) => setStatus({ state, reason }), []);

  const clearDialingTimeout = useCallback(() => {
    if (dialingTimeoutRef.current) { clearTimeout(dialingTimeoutRef.current); dialingTimeoutRef.current = null; }
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
    const iceServers = await resolveIceServers();
    const pc = new RTCPeerConnection({ iceServers });
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

  // Single cleanup path for every way a call can end (hangup, decline,
  // busy, timeout, unavailable, remote disconnect). Always goes through
  // here so nothing forgets to release the peer connection or clear the
  // dialing timer.
  const endCall = useCallback((reason = null) => {
    teardownPeer();
    clearDialingTimeout();
    callLockRef.current = false;
    setActiveCall(null);
    setCallState('idle', reason);
  }, [teardownPeer, clearDialingTimeout, setCallState]);

  const startOutgoingCall = useCallback((peerId, conversationId, mode, contact) => {
    if (callLockRef.current || activeCallRef.current) return; // debounce + can't start a second call
    callLockRef.current = true;
    setActiveCall({ conversationId, mode, contact, isIncoming: false });
    setCallState('dialing');
    send({ type: 'call-start', to: peerId, conversationId, mode });

    clearDialingTimeout();
    dialingTimeoutRef.current = setTimeout(() => {
      if (activeCallRef.current?.conversationId === conversationId && statusRef.current.state !== 'active') {
        // Server's own 35s timeout should have already fired and cleaned
        // this up server-side; this just guarantees the client doesn't
        // hang forever if that message got lost in transit.
        send({ type: 'hangup', to: peerId, conversationId });
        endCall('timeout');
      }
    }, CLIENT_DIALING_TIMEOUT_MS);
  }, [send, setCallState, clearDialingTimeout, endCall]);

  const acceptIncomingCall = useCallback(() => {
    const call = incomingCallRef.current;
    if (!call || callLockRef.current) return;
    callLockRef.current = true;
    setActiveCall({ conversationId: call.conversationId, mode: call.mode, contact: call.caller, isIncoming: true });
    setCallState('connecting');
    send({ type: 'call-accept', to: call.caller.id, conversationId: call.conversationId });
    setIncomingCall(null);
  }, [send, setCallState]);

  const declineIncomingCall = useCallback(() => {
    const call = incomingCallRef.current;
    if (!call) return;
    send({ type: 'call-decline', to: call.caller.id, conversationId: call.conversationId });
    setIncomingCall(null);
  }, [send]);

  const hangup = useCallback(() => {
    const call = activeCallRef.current;
    if (call) send({ type: 'hangup', to: call.contact.id, conversationId: call.conversationId });
    endCall('hangup');
  }, [send, endCall]);

  // Caller backgrounding the app before the call connects almost always
  // means they backed out — don't leave a ghost ringing call behind. Once
  // active, backgrounding is normal (audio calls keep running), so this
  // only fires pre-connect.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' && activeCallRef.current && statusRef.current.state !== 'active') {
        hangup();
      }
    });
    return () => sub.remove();
  }, [hangup]);

  const handleMessage = useCallback(async (msg) => {
    // signalSocket now dispatches group-call room messages to every
    // subscriber too — ignore them here, GroupCallContext owns those.
    if (msg.roomId) return;

    switch (msg.type) {
      case 'incoming-call': {
        if (activeCallRef.current) return; // already on a call — server also sends the caller `call-busy`
        const caller = await lookupUser(msg.from);
        setIncomingCall({ conversationId: msg.conversationId, mode: msg.mode, caller });
        break;
      }

      case 'call-busy':
        if (activeCallRef.current?.conversationId === msg.conversationId) endCall(msg.reason || 'busy');
        break;

      case 'call-timeout':
        if (incomingCallRef.current?.conversationId === msg.conversationId) setIncomingCall(null);
        if (activeCallRef.current?.conversationId === msg.conversationId) endCall('timeout');
        break;

      case 'call-accept': {
        // We're the caller — peer accepted, now actually build the offer.
        const call = activeCallRef.current;
        if (!call || call.conversationId !== msg.conversationId) return;
        if (pcRef.current) return; // duplicate call-accept — already negotiating, ignore
        clearDialingTimeout();
        setCallState('connecting');
        await ensurePeerConnection(call.contact.id, call.conversationId, call.mode === 'video');
        const offer = await pcRef.current.createOffer();
        await pcRef.current.setLocalDescription(offer);
        send({ type: 'offer', to: call.contact.id, conversationId: call.conversationId, sdp: offer });
        break;
      }

      case 'call-decline':
        if (activeCallRef.current?.conversationId === msg.conversationId) endCall(msg.reason || 'declined');
        break;

      case 'unavailable':
        if (activeCallRef.current?.conversationId === msg.conversationId) endCall(msg.reason || 'unavailable');
        break;

      case 'offer': {
        // We're the callee — build our side and answer.
        const call = activeCallRef.current;
        if (!call || call.conversationId !== msg.conversationId) return;
        if (pcRef.current) return; // duplicate offer — already answered, ignore
        await ensurePeerConnection(call.contact.id, call.conversationId, call.mode === 'video');
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        send({ type: 'answer', to: call.contact.id, conversationId: call.conversationId, sdp: answer });
        setCallState('active');
        break;
      }

      case 'answer':
        if (!activeCallRef.current || activeCallRef.current.conversationId !== msg.conversationId) return;
        if (pcRef.current) await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        clearDialingTimeout();
        setCallState('active');
        break;

      case 'ice-candidate':
        if (!activeCallRef.current || activeCallRef.current.conversationId !== msg.conversationId) return;
        if (pcRef.current && msg.candidate) {
          try { await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
        }
        break;

      case 'hangup':
      case 'peer-left':
        if (activeCallRef.current?.conversationId === msg.conversationId) {
          endCall(msg.reason || (msg.type === 'peer-left' ? 'network_lost' : 'hangup'));
        }
        break;

      default:
        break;
    }
  }, [lookupUser, ensurePeerConnection, send, endCall, setCallState, clearDialingTimeout]);

  useEffect(() => {
    if (!myUser?.id) return;
    signalSocket.connect();
    const unsubscribe = signalSocket.subscribe(handleMessage);

    return () => {
      unsubscribe();
      signalSocket.disconnect();
    };
  }, [myUser?.id, handleMessage]);

  const phase = status.state === 'dialing' || status.state === 'connecting' ? 'ringing' : status.state;

  return (
    <CallContext.Provider value={{
      incomingCall, activeCall, phase, status, localStream, remoteStream,
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
