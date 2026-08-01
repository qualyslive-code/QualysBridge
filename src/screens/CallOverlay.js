// src/screens/CallOverlay.js — rendered from App.js whenever
// CallContext.activeCall is set. Pure UI: all signaling/WebRTC state
// (status, localStream, remoteStream, hangup) comes straight from
// useCallContext(), no separate hook.
//
// Consumes CallContext's status{state,reason} directly now (Phase 3) —
// the legacy `phase` string is still exported there for anything else
// that might read it, but this screen no longer needs it.
//
// The overlay stays mounted for a beat after the call actually ends so
// the reason (Declined/Busy/No answer/...) is visible instead of the
// screen just vanishing the instant activeCall clears.
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { Av } from '../components/atoms';
import { useCallContext } from '../lib/CallContext';

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

const DISMISS_DELAY_MS = 1400;

const fmtElapsed = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function CallOverlay() {
  const { activeCall, status, localStream, remoteStream, hangup, speakerOn, toggleSpeaker } = useCallContext();
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [ending, setEnding] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Snapshot of activeCall kept alive briefly after it clears, purely so
  // the end-reason text has something to render against.
  const [display, setDisplay] = useState(null);
  const dismissTimerRef = useRef(null);
  const activeSinceRef = useRef(null);

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

  // Call timer keyed off a stable start timestamp (not an incrementing
  // counter) so a skipped render can't make it drift.
  useEffect(() => {
    if (status.state === 'active') {
      if (!activeSinceRef.current) activeSinceRef.current = Date.now();
      const id = setInterval(() => setElapsed(Math.floor((Date.now() - activeSinceRef.current) / 1000)), 1000);
      return () => clearInterval(id);
    }
    activeSinceRef.current = null;
    setElapsed(0);
  }, [status.state]);

  if (!display) return null;

  const toggleMuted = () => { localStream?.getAudioTracks().forEach((t) => { t.enabled = muted; }); setMuted((v) => !v); };
  const toggleCam = () => { localStream?.getVideoTracks().forEach((t) => { t.enabled = camOff; }); setCamOff((v) => !v); };

  const isPreConnect = status.state === 'dialing' || status.state === 'connecting';
  const isEnded = !activeCall;

  const handleEnd = () => {
    if (ending) return; // one tap only — no duplicate hangup signals
    setEnding(true);
    hangup();
  };

  const CONTROLS = isEnded ? [] : [
    { icon: muted ? '🔇' : '🎙️', label: muted ? 'Unmute' : 'Mute', action: toggleMuted, active: muted },
    { icon: speakerOn ? '🔊' : '🔈', label: speakerOn ? 'Speaker' : 'Earpiece', action: toggleSpeaker, active: speakerOn },
    ...(display.mode === 'video' ? [{ icon: camOff ? '📷' : '📸', label: camOff ? 'Cam off' : 'Camera', action: toggleCam, active: camOff }] : []),
    { icon: '📞', label: isPreConnect ? 'Cancel' : 'End', action: handleEnd, end: true, disabled: ending },
  ];

  const statusText = isEnded
    ? (END_REASON_LABEL[status.reason] || 'Call ended')
    : status.state === 'dialing' ? 'CALLING…'
    : status.state === 'connecting' ? 'CONNECTING…'
    : status.state === 'active' ? `ON CALL · ${fmtElapsed(elapsed)}`
    : 'CONNECTING…';

  return (
    <View style={[co.overlay, { paddingTop: insets.top }]}>
      {display.mode === 'video' && remoteStream && (
        <RTCView streamURL={remoteStream.toURL()} style={co.remoteVideo} objectFit="cover" />
      )}
      <Text style={co.status}>{statusText}</Text>
      {!(display.mode === 'video' && remoteStream) && (
        <View style={{ marginBottom: 24 }}><Av name={display.contact.name} color={display.contact.color} size={96} /></View>
      )}
      <Text style={co.name}>{display.contact.name}</Text>
      <Text style={co.subLabel}>{display.mode === 'video' ? 'Video call' : 'Voice call'}</Text>
      {display.mode === 'video' && localStream && (
        <View style={co.pip}><RTCView streamURL={localStream.toURL()} style={{ flex: 1, borderRadius: 12 }} objectFit="cover" mirror /></View>
      )}
      <View style={{ flex: 1 }} />
      {!isEnded && (
        <View style={co.controls}>
          {CONTROLS.map(({ icon, label, action, active, end, disabled }) => (
            <View key={label} style={co.controlItem}>
              <TouchableOpacity
                onPress={action}
                disabled={disabled}
                style={[
                  co.controlBtn,
                  end && { backgroundColor: C.danger },
                  active && !end && { backgroundColor: C.accentD, borderColor: C.borderM },
                  disabled && { opacity: 0.5 },
                ]}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 22, color: end ? '#fff' : active ? C.accentL : C.sub }}>{icon}</Text>
              </TouchableOpacity>
              <Text style={[co.controlLabel, end && { color: C.danger }]}>{label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const co = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: C.bg, alignItems: 'center', paddingBottom: 40, zIndex: 999 },
  remoteVideo: { ...StyleSheet.absoluteFillObject },
  status: { color: C.sub, fontSize: 13, letterSpacing: 1, marginTop: 60, marginBottom: 20 },
  name: { color: C.text, fontSize: 22, fontWeight: '600', marginTop: 4 },
  subLabel: { color: C.sub, fontSize: 13, marginTop: 4 },
  pip: { position: 'absolute', top: 60, right: 20, width: 90, height: 130, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  controls: { flexDirection: 'row', gap: 28, marginBottom: 10 },
  controlItem: { alignItems: 'center', gap: 6 },
  controlBtn: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s1, borderWidth: 1, borderColor: C.border },
  controlLabel: { fontSize: 11, color: C.sub },
});
