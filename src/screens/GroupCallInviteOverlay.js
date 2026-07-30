// src/screens/GroupCallInviteOverlay.js — global invite prompt, shows
// whenever GroupCallContext.roomInvite is set, same pattern as
// IncomingCallOverlay but for group-call rooms (keyed by roomId, not
// conversationId).
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { Av } from '../components/atoms';
import { useGroupCallContext } from '../lib/GroupCallContext';

export default function GroupCallInviteOverlay() {
  const { roomInvite, acceptRoomInvite, declineRoomInvite } = useGroupCallContext();
  const insets = useSafeAreaInsets();
  if (!roomInvite) return null;

  return (
    <View style={[ic.overlay, { paddingTop: insets.top + 40 }]}>
      <Text style={ic.label}>Group call invite</Text>
      <Av name={roomInvite.from.name} color={roomInvite.from.color} size={110} />
      <Text style={ic.name}>{roomInvite.from.name}</Text>
      <Text style={ic.sub}>is starting a group call</Text>
      <View style={{ flex: 1 }} />
      <View style={ic.row}>
        <TouchableOpacity onPress={declineRoomInvite} style={[ic.btn, { backgroundColor: C.danger }]} activeOpacity={0.85}>
          <Text style={ic.btnIcon}>📞</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={acceptRoomInvite} style={[ic.btn, { backgroundColor: C.money }]} activeOpacity={0.85}>
          <Text style={ic.btnIcon}>📞</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const ic = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: C.bg, alignItems: 'center', paddingBottom: 60, zIndex: 1000 },
  label: { color: C.sub, fontSize: 13, letterSpacing: 1, marginBottom: 20 },
  name: { color: C.text, fontSize: 22, fontWeight: '600', marginTop: 16 },
  sub: { color: C.sub, fontSize: 13, marginTop: 4 },
  row: { flexDirection: 'row', gap: 60 },
  btn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  btnIcon: { fontSize: 26, color: '#fff' },
});
