// src/lib/GroupCallContext.js
//
// Group call (2-4 participants) signaling + WebRTC. Shares the single
// /calls/signal socket via signalSocket.js — this context never calls
// signalSocket.connect()/disconnect() itself, only subscribe()/send().
// CallContext (1:1) owns the connection lifecycle.
//
// Peer topology: option B — a newly-joining participant initiates the
// offer to every already-connected peer (received via 'room-peers' on
// join). Existing participants don't initiate on 'room-peer-joined';
// they wait for the newcomer's offer and answer it.
//
// Blocklist: room membership is already filtered server-side at
// create/invite time (caller vs invitee only). This does NOT cover
// every pair — e.g. two invitees who've blocked each other, or someone
// who blocked you after you were already invited. So every peer
// connection is additionally gated client-side: before creating a
// peer connection with peerId (whether initiating or answering), we
// check `block` between us and them. Blocked pair -> both stay in the
// room's participant list, but the individual WebRTC link is never
// established; no stream is exchanged either direction.
//
// Known gaps (flagging, not fixing here):
//  - No call_log-equivalent for group calls yet (1:1 has call_log;
//    group calls only have call_participant status).
//  - No ringing UI for invitees — room-invite just surfaces a raw
//    from/roomId; needs the same lookupUser treatment as CallContext
//    (handled here, but no "ringing" phase distinction yet).
//  - Declining an invite doesn't currently mark call_participant
//    status — the row stays 'invited' forever if never joined.
//  - Audio/video mode is fixed per-call at creation, no toggle-per-add.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { mediaDevices, RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'react-native-webrtc';
import { supabase } from './supabase';
import * as signalSocket from './signalSocket';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const MAX_PARTICIPANTS = 4;
const GroupCallContext = createContext(null);

export function GroupCallProvider({ myUser, children }) {
  const [room, setRoom] = useState(null);             // { roomId, mode } | null
  const [roomInvite, setRoomInvite] = useState(null);  // { roomId, from: {id,name,color} } | null
  const [peers, setPeers] = useState({});              // peerId -> { name, color, stream }
  const [localStream, setLocalStream] = useState(null);

  const roomRef = useRef(null);
  roomRef.current = room;
  const pcMap = useRef(new Map());       // peerId -> RTCPeerConnection
  const localStreamRef = useRef(null);
  const knownUsers = useRef(new Map());
  const blockCache = useRef(new Map());  // peerId -> boolean

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

  const isBlocked = useCallback(async (peerId) => {
    if (blockCache.current.has(peerId)) return blockCache.current.get(peerId);
    const { data } = await supabase
      .from('block')
      .select('blocker_id')
      .or(`and(blocker_id.eq.${myUser.id},blocked_id.eq.${peerId}),and(blocker_id.eq.${peerId},blocked_id.eq.${myUser.id})`)
      .maybeSingle();
    const blocked = !!data;
    blockCache.current.set(peerId, blocked);
    return blocked;
  }, [myUser?.id]);

  const ensureLocalStream = useCallback(async (wantVideo) => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await mediaDevices.getUserMedia({ audio: true, video: wantVideo });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const removePeer = useCallback((peerId) => {
    const pc = pcMap.current.get(peerId);
    if (pc) { pc.close(); pcMap.current.delete(peerId); }
    setPeers((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const teardownRoom = useCallback(() => {
    pcMap.current.forEach((pc) => pc.close());
    pcMap.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setPeers({});
    setRoom(null);
  }, []);

  const createPeerConnection = useCallback(async (peerId, roomId, wantVideo) => {
    if (pcMap.current.has(peerId)) return pcMap.current.get(peerId);
    const stream = await ensureLocalStream(wantVideo);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => {
      if (e.candidate) signalSocket.send({ type: 'room-ice-candidate', roomId, to: peerId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      setPeers((prev) => ({ ...prev, [peerId]: { ...prev[peerId], stream: e.streams[0] } }));
    };
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pcMap.current.set(peerId, pc);

    const info = await lookupUser(peerId);
    setPeers((prev) => ({ ...prev, [peerId]: { ...prev[peerId], name: info.name, color: info.color } }));

    return pc;
  }, [ensureLocalStream, lookupUser]);

  const connectToPeer = useCallback(async (peerId, roomId, wantVideo) => {
    if (await isBlocked(peerId)) return; // blocked pair — stay in room, never link
    const pc = await createPeerConnection(peerId, roomId, wantVideo);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signalSocket.send({ type: 'room-offer', roomId, to: peerId, sdp: offer });
  }, [isBlocked, createPeerConnection]);

  const startGroupCall = useCallback(async (inviteeIds, mode = 'video') => {
    const { data, error } = await supabase.rpc('create_call_room', { p_invitee_ids: inviteeIds });
    if (error || !data?.[0]) { console.error('[GroupCall] create_call_room', error); return null; }
    const { room_id: roomId, excluded_ids: excludedIds } = data[0];

    setRoom({ roomId, mode });
    signalSocket.send({ type: 'room-join', roomId });

    const allowed = inviteeIds.filter((id) => !(excludedIds || []).includes(id));
    allowed.forEach((id) => signalSocket.send({ type: 'room-invite', roomId, to: id }));

    return { roomId, excludedIds: excludedIds || [] };
  }, []);

  const acceptRoomInvite = useCallback(() => {
    const invite = roomInvite;
    if (!invite) return;
    setRoom({ roomId: invite.roomId, mode: 'video' });
    signalSocket.send({ type: 'room-join', roomId: invite.roomId });
    setRoomInvite(null);
  }, [roomInvite]);

  const declineRoomInvite = useCallback(() => {
    setRoomInvite(null);
    // Known gap: call_participant status stays 'invited' — no decline signal sent yet.
  }, []);

  const leaveRoom = useCallback(() => {
    const current = roomRef.current;
    if (current) signalSocket.send({ type: 'room-leave', roomId: current.roomId });
    teardownRoom();
  }, [teardownRoom]);

  const handleRoomMessage = useCallback(async (msg) => {
    if (!msg.roomId) return;
    const current = roomRef.current;

    switch (msg.type) {
      case 'room-invite': {
        if (current) return; // already on a call — no call-waiting for group calls either
        const from = await lookupUser(msg.from);
        setRoomInvite({ roomId: msg.roomId, from });
        break;
      }

      case 'room-peers': {
        if (!current || current.roomId !== msg.roomId) return;
        for (const peerId of msg.peers || []) {
          await connectToPeer(peerId, msg.roomId, current.mode === 'video');
        }
        break;
      }

      case 'room-peer-joined':
        break; // we wait for their offer, don't initiate

      case 'room-peer-left': {
        if (!current || current.roomId !== msg.roomId) return;
        removePeer(msg.from);
        break;
      }

      case 'room-offer': {
        if (!current || current.roomId !== msg.roomId) return;
        if (await isBlocked(msg.from)) return;
        const pc = await createPeerConnection(msg.from, msg.roomId, current.mode === 'video');
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signalSocket.send({ type: 'room-answer', roomId: msg.roomId, to: msg.from, sdp: answer });
        break;
      }

      case 'room-answer': {
        const pc = pcMap.current.get(msg.from);
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        break;
      }

      case 'room-ice-candidate': {
        const pc = pcMap.current.get(msg.from);
        if (pc && msg.candidate) {
          try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
        }
        break;
      }

      default:
        break;
    }
  }, [connectToPeer, createPeerConnection, isBlocked, removePeer, lookupUser]);

  useEffect(() => {
    if (!myUser?.id) return;
    const unsubscribe = signalSocket.subscribe(handleRoomMessage);
    return () => unsubscribe();
  }, [myUser?.id, handleRoomMessage]);

  return (
    <GroupCallContext.Provider value={{
      room, roomInvite, peers, localStream,
      startGroupCall, acceptRoomInvite, declineRoomInvite, leaveRoom,
      MAX_PARTICIPANTS,
    }}>
      {children}
    </GroupCallContext.Provider>
  );
}

export function useGroupCallContext() {
  const ctx = useContext(GroupCallContext);
  if (!ctx) throw new Error('useGroupCallContext must be used within GroupCallProvider');
  return ctx;
}
