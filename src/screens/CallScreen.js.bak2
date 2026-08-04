// src/screens/CallScreen.js
//
// Full-screen call UI. REPLACES CallOverlay.js + GroupCallOverlay.js as a
// single component — mount it once in App.js alongside IncomingCallOverlay
// and GroupCallInviteOverlay, same pattern as before (no react-navigation).
//
// Renders nothing when neither a 1:1 call (CallContext.activeCall) nor a
// group call (GroupCallContext.room) is active, so it's safe to mount
// unconditionally at the root.
//
// Field names below are pulled directly from the real CallContext.js /
// GroupCallContext.js — not guessed:
//   1:1   → activeCall{conversationId,mode,contact,isIncoming}, status{state,reason},
//           hangup(), muted, toggleMute(), speakerOn, toggleSpeaker(), callQuality,
//           localStream, remoteStream
//   group → room{roomId,mode}, peers{[id]:{name,color,stream}}, localStream,
//           leaveRoom(), MAX_PARTICIPANTS
//   Camera on/off has no context method in either — same as CallOverlay.js /
//   GroupCallOverlay.js, it's done locally by flipping localStream's video
//   track .enabled and mirroring that in component state.

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { Av, Pulse } from '../components/atoms';
import { useCallContext } from '../lib/CallContext';
import { useGroupCallContext } from '../lib/GroupCallContext';

const END_REASON_LABEL = {
  declined: 'Call declined',
  busy: 'User is busy',
  unavailable: 'Unavailable',
  timeout: 'No answer',
  cancelled: 'Call cancelled',
  network_lost: 'Connection lost',
  hangup: 'Call ended',
  permission_denied: 'Camera/mic access needed',
  media_error: 'Could not access camera or mic',
};

const QUALITY_LABEL = { excellent: 'Excellent', good: 'Good', poor: 'Poor connection' };
const QUALITY_COLOR = { excellent: '#2ecc71', good: '#f1c40f', poor: '#e74c3c' };

const DISMISS_DELAY_MS = 1400;
const CONTROLS_HIDE_MS = 4000;

const fmtElapsed = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function CallScreen() {
  const oneOnOne = useCallContext();
  const group = useGroupCallContext();
  const insets = useSafeAreaInsets();

  // A 1:1 call and a group call can never be active at once in this app,
  // so whichever has a live call wins for what we render.
  const isGroup = !!group.room && !oneOnOne.activeCall;

  return isGroup
    ? <GroupCallBody group={group} insets={insets} />
    : <OneOnOneBody call={oneOnOne} insets={insets} />;
}

// ── 1:1 call ────────────────────────────────────────────────────────────
function OneOnOneBody({ call, insets }) {
  const { activeCall, status, localStream, remoteStream, hangup, speakerOn, toggleSpeaker, callQuality, muted, toggleMute } = call;

  const [camOff, setCamOff] = useState(false);
  const [ending, setEnding] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showControls, setShowControls] = useState(true);

  const [display, setDisplay] = useState(null);
  const dismissTimerRef = useRef(null);
  const activeSinceRef = useRef(null);
  const controlsTimerRef = useRef(null);

  useEffect(() => {
    if (activeCall) {
      if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
      setDisplay(activeCall);
      setEnding(false);
    } else if (display && !dismissTimerRef.current) {
      dismissTimerRef.current = setTimeout(() => { setDisplay(null); dismissTimerRef.current = null; }, DISMISS_DELAY_MS);
    }
  }, [activeCall]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current); }, []);

  useEffect(() => {
    if (status.state === 'active') {
      if (!activeSinceRef.current) activeSinceRef.current = Date.now();
      const id = setInterval(() => setElapsed(Math.floor((Date.now() - activeSinceRef.current) / 1000)), 1000);
      return () => clearInterval(id);
    }
    if (status.state !== 'reconnecting') {
      activeSinceRef.current = null;
      setElapsed(0);
    }
  }, [status.state]);

  // Auto-hide controls while connected — tap anywhere to bring them back.
  useEffect(() => {
    if (!display || status.state !== 'active') { setShowControls(true); return; }
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(controlsTimerRef.current);
  }, [display, status.state, showControls]);

  if (!display) return null;

  const toggleCam = () => { localStream?.getVideoTracks().forEach((t) => { t.enabled = camOff; }); setCamOff((v) => !v); };

  const isPreConnect = status.state === 'dialing' || status.state === 'connecting';
  const isEnded = !activeCall;

  const handleEnd = () => {
    if (ending) return;
    setEnding(true);
    hangup();
  };

  const CONTROLS = isEnded ? [] : [
    { icon: muted ? '🔇' : '🎙️', label: muted ? 'Unmute' : 'Mute', action: toggleMute, active: muted },
    { icon: speakerOn ? '🔊' : '🔈', label: speakerOn ? 'Speaker' : 'Earpiece', action: toggleSpeaker, active: speakerOn },
    ...(display.mode === 'video' ? [{ icon: camOff ? '📷' : '📸', label: camOff ? 'Cam off' : 'Camera', action: toggleCam, active: camOff }] : []),
    { icon: '📞', label: isPreConnect ? 'Cancel' : 'End', action: handleEnd, end: true, disabled: ending },
  ];

  const statusText = isEnded
    ? (END_REASON_LABEL[status.reason] || 'Call ended')
    : status.state === 'dialing' ? 'CALLING…'
    : status.state === 'connecting' ? 'CONNECTING…'
    : status.state === 'reconnecting' ? 'RECONNECTING…'
    : status.state === 'active' ? `ON CALL · ${fmtElapsed(elapsed)}`
    : 'CONNECTING…';

  const hasFullscreenVideo = display.mode === 'video' && remoteStream;

  return (
    <TouchableOpacity
      activeOpacity={1}
      style={[cs.overlay, { paddingTop: insets.top }]}
      onPress={() => setShowControls((v) => !v)}
    >
      {hasFullscreenVideo && (
        <RTCView streamURL={remoteStream.toURL()} style={cs.remoteVideo} objectFit="cover" />
      )}

      {status.state === 'dialing' || status.state === 'connecting' || status.state === 'reconnecting' ? (
        <Pulse size={16} label={statusText} style={cs.statusPulse} />
      ) : (
        <Text style={cs.status}>{statusText}</Text>
      )}
      {status.state === 'active' && callQuality && (
        <Text style={[cs.quality, { color: QUALITY_COLOR[callQuality] }]}>● {QUALITY_LABEL[callQuality]}</Text>
      )}

      {!hasFullscreenVideo && (
        <View style={{ marginBottom: 24 }}><Av name={display.contact.name} color={display.contact.color} size={96} /></View>
      )}
      <Text style={cs.name}>{display.contact.name}</Text>
      <Text style={cs.subLabel}>{display.mode === 'video' ? 'Video call' : 'Voice call'}</Text>

      {display.mode === 'video' && localStream && (
        <View style={cs.pip}><RTCView streamURL={localStream.toURL()} style={{ flex: 1, borderRadius: 12 }} objectFit="cover" mirror /></View>
      )}

      <View style={{ flex: 1 }} />

      {!isEnded && showControls && (
        <View style={[cs.controls, { paddingBottom: insets.bottom + 10 }]}>
          {CONTROLS.map(({ icon, label, action, active, end, disabled }) => (
            <View key={label} style={cs.controlItem}>
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); action(); }}
                disabled={disabled}
                style={[
                  cs.controlBtn,
                  end && { backgroundColor: C.danger },
                  active && !end && { backgroundColor: C.accentD, borderColor: C.borderM },
                  disabled && { opacity: 0.5 },
                ]}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 22, color: end ? '#fff' : active ? C.accentL : C.sub }}>{icon}</Text>
              </TouchableOpacity>
              <Text style={[cs.controlLabel, end && { color: C.danger }]}>{label}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Group call ──────────────────────────────────────────────────────────
function GroupCallBody({ group, insets }) {
  const { room, peers, localStream, leaveRoom, MAX_PARTICIPANTS } = group;
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const controlsTimerRef = useRef(null);

  useEffect(() => {
    if (!room) return;
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(controlsTimerRef.current);
  }, [room, showControls]);

  if (!room) return null;

  const toggleMuted = () => { localStream?.getAudioTracks().forEach((t) => { t.enabled = muted; }); setMuted((v) => !v); };
  const toggleCam = () => { localStream?.getVideoTracks().forEach((t) => { t.enabled = camOff; }); setCamOff((v) => !v); };

  const peerList = Object.entries(peers).map(([id, p]) => ({ id, ...p }));
  const tileCount = peerList.length + 1;

  const CONTROLS = [
    { icon: muted ? '🔇' : '🎙️', label: muted ? 'Unmute' : 'Mute', action: toggleMuted, active: muted },
    { icon: speaker ? '🔊' : '🔈', label: speaker ? 'Speaker' : 'Earpiece', action: () => setSpeaker((v) => !v), active: speaker },
    ...(room.mode === 'video' ? [{ icon: camOff ? '📷' : '📸', label: camOff ? 'Cam off' : 'Camera', action: toggleCam, active: camOff }] : []),
    { icon: '📞', label: 'Leave', action: leaveRoom, end: true },
  ];

  return (
    <TouchableOpacity
      activeOpacity={1}
      style={[cs.overlay, { paddingTop: insets.top }]}
      onPress={() => setShowControls((v) => !v)}
    >
      <Text style={cs.status}>GROUP CALL · {tileCount}/{MAX_PARTICIPANTS}</Text>

      <View style={cs.grid}>
        <View style={cs.tile}>
          {room.mode === 'video' && localStream ? (
            <RTCView streamURL={localStream.toURL()} style={cs.tileVideo} objectFit="cover" mirror />
          ) : (
            <Av name="You" color={C.accentD} size={64} />
          )}
          <Text style={cs.tileLabel}>You</Text>
        </View>

        {peerList.map((p) => (
          <View key={p.id} style={cs.tile}>
            {room.mode === 'video' && p.stream ? (
              <RTCView streamURL={p.stream.toURL()} style={cs.tileVideo} objectFit="cover" />
            ) : (
              <Av name={p.name || '…'} color={p.color || '#888'} size={64} />
            )}
            {p.name ? (
              <Text style={cs.tileLabel}>{p.name}</Text>
            ) : (
              <Pulse size={7} label="Connecting…" style={cs.tileLabelPulse} />
            )}
          </View>
        ))}
      </View>

      <View style={{ flex: 1 }} />

      {showControls && (
        <View style={[cs.controls, { paddingBottom: insets.bottom + 10 }]}>
          {CONTROLS.map(({ icon, label, action, active, end }) => (
            <View key={label} style={cs.controlItem}>
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); action(); }}
                style={[cs.controlBtn, end && { backgroundColor: C.danger }, active && !end && { backgroundColor: C.accentD, borderColor: C.borderM }]}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 22, color: end ? '#fff' : active ? C.accentL : C.sub }}>{icon}</Text>
              </TouchableOpacity>
              <Text style={[cs.controlLabel, end && { color: C.danger }]}>{label}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

const cs = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: C.bg, alignItems: 'center', paddingBottom: 40, zIndex: 999 },
  remoteVideo: { ...StyleSheet.absoluteFillObject },
  status: { color: C.sub, fontSize: 13, letterSpacing: 1, marginTop: 60, marginBottom: 4 },
  statusPulse: { marginTop: 60, marginBottom: 4 },
  quality: { fontSize: 11, marginBottom: 16, letterSpacing: 0.3 },
  name: { color: C.text, fontSize: 22, fontWeight: '600', marginTop: 4 },
  subLabel: { color: C.sub, fontSize: 13, marginTop: 4 },
  pip: { position: 'absolute', top: 60, right: 20, width: 90, height: 130, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  controls: { flexDirection: 'row', gap: 28, marginBottom: 10 },
  controlItem: { alignItems: 'center', gap: 6 },
  controlBtn: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s1, borderWidth: 1, borderColor: C.border },
  controlLabel: { fontSize: 11, color: C.sub },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', paddingHorizontal: 12, marginTop: 24, justifyContent: 'center', gap: 12 },
  tile: { width: '46%', aspectRatio: 0.85, borderRadius: 16, backgroundColor: C.s1, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileVideo: { ...StyleSheet.absoluteFillObject },
  tileLabel: { position: 'absolute', bottom: 8, left: 10, color: C.text, fontSize: 13, fontWeight: '600' },
  tileLabelPulse: { position: 'absolute', bottom: 8, left: 10 },
});
