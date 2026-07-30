// src/screens/GroupCallOverlay.js — rendered whenever
// GroupCallContext.room is set. 2x2 grid: local tile + up to 3 remote
// peer tiles. Peers with no stream yet (still connecting, or the link
// was skipped because they're blocked) show an avatar placeholder
// instead of video — same fallback CallOverlay uses before connect.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { Av } from '../components/atoms';
import { useGroupCallContext } from '../lib/GroupCallContext';

export default function GroupCallOverlay() {
  const { room, peers, localStream, leaveRoom, MAX_PARTICIPANTS } = useGroupCallContext();
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [speaker, setSpeaker] = useState(true);

  if (!room) return null;

  const toggleMuted = () => { localStream?.getAudioTracks().forEach((t) => { t.enabled = muted; }); setMuted((v) => !v); };
  const toggleCam = () => { localStream?.getVideoTracks().forEach((t) => { t.enabled = camOff; }); setCamOff((v) => !v); };

  const peerList = Object.entries(peers).map(([id, p]) => ({ id, ...p }));
  const tileCount = peerList.length + 1; // + local tile

  const CONTROLS = [
    { icon: muted ? '🔇' : '🎙️', label: muted ? 'Unmute' : 'Mute', action: toggleMuted, active: muted },
    { icon: speaker ? '🔊' : '🔈', label: speaker ? 'Speaker' : 'Earpiece', action: () => setSpeaker((v) => !v), active: speaker },
    ...(room.mode === 'video' ? [{ icon: camOff ? '📷' : '📸', label: camOff ? 'Cam off' : 'Camera', action: toggleCam, active: camOff }] : []),
    { icon: '📞', label: 'Leave', action: leaveRoom, end: true },
  ];

  return (
    <View style={[gc.overlay, { paddingTop: insets.top }]}>
      <Text style={gc.status}>GROUP CALL · {tileCount}/{MAX_PARTICIPANTS}</Text>

      <View style={gc.grid}>
        <View style={gc.tile}>
          {room.mode === 'video' && localStream ? (
            <RTCView streamURL={localStream.toURL()} style={gc.tileVideo} objectFit="cover" mirror />
          ) : (
            <Av name="You" color={C.accentD} size={64} />
          )}
          <Text style={gc.tileLabel}>You</Text>
        </View>

        {peerList.map((p) => (
          <View key={p.id} style={gc.tile}>
            {room.mode === 'video' && p.stream ? (
              <RTCView streamURL={p.stream.toURL()} style={gc.tileVideo} objectFit="cover" />
            ) : (
              <Av name={p.name || '…'} color={p.color || '#888'} size={64} />
            )}
            <Text style={gc.tileLabel}>{p.name || 'Connecting…'}</Text>
          </View>
        ))}
      </View>

      <View style={{ flex: 1 }} />
      <View style={gc.controls}>
        {CONTROLS.map(({ icon, label, action, active, end }) => (
          <View key={label} style={gc.controlItem}>
            <TouchableOpacity onPress={action} style={[gc.controlBtn, end && { backgroundColor: C.danger }, active && !end && { backgroundColor: C.accentD, borderColor: C.borderM }]} activeOpacity={0.8}>
              <Text style={{ fontSize: 22, color: end ? '#fff' : active ? C.accentL : C.sub }}>{icon}</Text>
            </TouchableOpacity>
            <Text style={[gc.controlLabel, end && { color: C.danger }]}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const gc = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: C.bg, alignItems: 'center', paddingBottom: 40, zIndex: 999 },
  status: { color: C.sub, fontSize: 13, letterSpacing: 1, marginTop: 24, marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', paddingHorizontal: 12, justifyContent: 'center', gap: 12 },
  tile: { width: '46%', aspectRatio: 0.85, borderRadius: 16, backgroundColor: C.s1, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileVideo: { ...StyleSheet.absoluteFillObject },
  tileLabel: { position: 'absolute', bottom: 8, left: 10, color: C.text, fontSize: 13, fontWeight: '600' },
  controls: { flexDirection: 'row', gap: 28, marginBottom: 10 },
  controlItem: { alignItems: 'center', gap: 6 },
  controlBtn: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s1, borderWidth: 1, borderColor: C.border },
  controlLabel: { fontSize: 11, color: C.sub },
});
