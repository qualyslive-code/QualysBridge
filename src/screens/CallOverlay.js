// src/screens/CallOverlay.js — rendered from App.js whenever
// CallContext.activeCall is set. Pure UI: all signaling/WebRTC state
// (phase, localStream, remoteStream, hangup) comes straight from
// useCallContext(), no separate hook.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { Av } from '../components/atoms';
import { useCallContext } from '../lib/CallContext';

export default function CallOverlay() {
  const { activeCall, phase, localStream, remoteStream, hangup } = useCallContext();
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [speaker, setSpeaker] = useState(true);

  if (!activeCall) return null;

  const toggleMuted = () => { localStream?.getAudioTracks().forEach((t) => { t.enabled = muted; }); setMuted((v) => !v); };
  const toggleCam = () => { localStream?.getVideoTracks().forEach((t) => { t.enabled = camOff; }); setCamOff((v) => !v); };

  const CONTROLS = [
    { icon: muted ? '🔇' : '🎙️', label: muted ? 'Unmute' : 'Mute', action: toggleMuted, active: muted },
    { icon: speaker ? '🔊' : '🔈', label: speaker ? 'Speaker' : 'Earpiece', action: () => setSpeaker((v) => !v), active: speaker },
    ...(activeCall.mode === 'video' ? [{ icon: camOff ? '📷' : '📸', label: camOff ? 'Cam off' : 'Camera', action: toggleCam, active: camOff }] : []),
    { icon: '📞', label: 'End', action: hangup, end: true },
  ];

  const statusText = phase === 'idle' ? 'CONNECTING…' : phase === 'ringing' ? 'CALLING…' : phase === 'active' ? 'ON CALL' : 'CALL ENDED';

  return (
    <View style={[co.overlay, { paddingTop: insets.top }]}>
      {activeCall.mode === 'video' && remoteStream && (
        <RTCView streamURL={remoteStream.toURL()} style={co.remoteVideo} objectFit="cover" />
      )}
      <Text style={co.status}>{statusText}</Text>
      {!(activeCall.mode === 'video' && remoteStream) && (
        <View style={{ marginBottom: 24 }}><Av name={activeCall.contact.name} color={activeCall.contact.color} size={96} /></View>
      )}
      <Text style={co.name}>{activeCall.contact.name}</Text>
      <Text style={co.subLabel}>{activeCall.mode === 'video' ? 'Video call' : 'Voice call'}</Text>
      {activeCall.mode === 'video' && localStream && (
        <View style={co.pip}><RTCView streamURL={localStream.toURL()} style={{ flex: 1, borderRadius: 12 }} objectFit="cover" mirror /></View>
      )}
      <View style={{ flex: 1 }} />
      <View style={co.controls}>
        {CONTROLS.map(({ icon, label, action, active, end }) => (
          <View key={label} style={co.controlItem}>
            <TouchableOpacity onPress={action} style={[co.controlBtn, end && { backgroundColor: C.danger }, active && !end && { backgroundColor: C.accentD, borderColor: C.borderM }]} activeOpacity={0.8}>
              <Text style={{ fontSize: 22, color: end ? '#fff' : active ? C.accentL : C.sub }}>{icon}</Text>
            </TouchableOpacity>
            <Text style={[co.controlLabel, end && { color: C.danger }]}>{label}</Text>
          </View>
        ))}
      </View>
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
