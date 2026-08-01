// src/screens/IncomingCallOverlay.js — global ringing screen, shows
// whenever CallContext.incomingCall is set, on top of any screen. App-wide
// because CallProvider's socket is opened once at app start, not per-screen.
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { Av } from '../components/atoms';
import { useCallContext } from '../lib/CallContext';

export default function IncomingCallOverlay() {
  const { incomingCall, acceptIncomingCall, declineIncomingCall } = useCallContext();
  const insets = useSafeAreaInsets();
  const [responding, setResponding] = useState(false);

  // A new incoming call always means a fresh overlay instance for it —
  // reset the guard so a prior call's tap can't leave this one stuck.
  useEffect(() => { if (!incomingCall) setResponding(false); }, [incomingCall]);

  if (!incomingCall) return null;

  const handleDecline = () => { if (responding) return; setResponding(true); declineIncomingCall(); };
  const handleAccept = () => { if (responding) return; setResponding(true); acceptIncomingCall(); };

  return (
    <View style={[ic.overlay, { paddingTop: insets.top + 40 }]}>
      <Text style={ic.label}>Incoming {incomingCall.mode === 'video' ? 'video' : 'voice'} call</Text>
      <Av name={incomingCall.caller.name} color={incomingCall.caller.color} size={110} />
      <Text style={ic.name}>{incomingCall.caller.name}</Text>
      <View style={{ flex: 1 }} />
      <View style={ic.row}>
        <TouchableOpacity
          onPress={handleDecline}
          disabled={responding}
          style={[ic.btn, { backgroundColor: C.danger }, responding && { opacity: 0.5 }]}
          activeOpacity={0.85}
        >
          <Text style={ic.btnIcon}>📞</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleAccept}
          disabled={responding}
          style={[ic.btn, { backgroundColor: C.money }, responding && { opacity: 0.5 }]}
          activeOpacity={0.85}
        >
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
  row: { flexDirection: 'row', gap: 60 },
  btn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  btnIcon: { fontSize: 26, color: '#fff' },
});
