// QualysBridge — SettingsScreen

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { Av, PBtn, IBtn, Hr } from '../components/atoms';
import { supabase } from '../lib/supabase';

// FIX: "Encryption: E2E · AES-256-GCM" and "Server storage: Ciphertext
// only" were both false — message.body and app_user.email are plain
// Postgres columns, no encryption layer exists anywhere in the stack.
// Reworded to what's actually true today. "Identity" now reflects the RLS
// fix (app_user_select_public removed) that makes the old claim true.
const SECURITY = [
  { k: 'In transit',   v: 'TLS' },
  { k: 'At rest',      v: 'Not yet encrypted' },
  { k: 'Identity',     v: 'Email hidden from all other users' },
  { k: 'Legal access', v: 'Court order only' },
];

export default function SettingsScreen({ user, onBack, onLogout, onAvatarUpdated }) {
  const [avatarUploading, setAvatarUploading] = useState(false);

  const changeAvatar = async () => {
    const ImagePicker = require('expo-image-picker');
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1],
    });
    if (result.canceled) return;
    setAvatarUploading(true);
    try {
      const asset = result.assets[0];
      const fileExt = (asset.uri.split('.').pop() || 'jpg').toLowerCase();
      const { getMediaUploadUrl } = require('../lib/api');
      const upRes = await getMediaUploadUrl({ conversationId: 'avatars', fileExt });
      if (!upRes.ok) return;
      const { path, token } = upRes.data;
      const fileBuffer = await (await fetch(asset.uri)).arrayBuffer();
      const CONTENT_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
      const contentType = CONTENT_TYPES[fileExt] || 'image/jpeg';
      const { error: uploadErr } = await supabase.storage
        .from('qualys-family-media')
        .uploadToSignedUrl(path, token, fileBuffer, { contentType });
      if (uploadErr) return;
      const { data: signed } = await supabase.storage
        .from('qualys-family-media')
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      const { error: dbErr } = await supabase
        .from('app_user')
        .update({ avatar_url: path })
        .eq('id', user.id);
      if (!dbErr) onAvatarUpdated?.(signed?.signedUrl ?? path);
    } finally {
      setAvatarUploading(false);
    }
  };

  // Initialized from the real column — App.js's create_profile/login flow
  // needs to populate user.readReceiptsEnabled for this to reflect the
  // actual stored value rather than always starting true on every mount.
  const [readRx, setReadRx] = useState(user.readReceiptsEnabled ?? true);
  const insets = useSafeAreaInsets();

  const copyQid = async () => {
    await Clipboard.setStringAsync(user.qid);
  };

  const toggleReadReceipts = async (value) => {
    setReadRx(value); // optimistic — matches the original's instant-feeling Switch
    const { error } = await supabase
      .from('app_user')
      .update({ read_receipts_enabled: value })
      .eq('id', user.id);
    if (error) {
      console.error('[SettingsScreen] read_receipts_enabled', error);
      setReadRx((v) => !v); // revert on failure
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('[SettingsScreen] signOut', error);
    onLogout(); // still drives App.js's navigation back to 'login' either way
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <IBtn icon="‹" onPress={onBack} />
        <Text style={s.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <View style={s.profileCard}>
          <TouchableOpacity onPress={changeAvatar} disabled={avatarUploading} activeOpacity={0.8}>
            <Av name={user.displayName} color={user.color} avatarUrl={user.avatarUrl} size={58} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName}>{user.displayName}</Text>
            <Text style={s.profileQid}>{user.qid}</Text>
            <Text style={s.profileSub}>Email never shown to anyone</Text>
          </View>
        </View>

        {/* QID row */}
        <View style={s.qidRow}>
          <Text style={s.qidLabel}>YOUR QID</Text>
          <Text style={s.qidValue} numberOfLines={1}>{user.qid}</Text>
          <TouchableOpacity onPress={copyQid} activeOpacity={0.7}>
            <Text style={s.copyBtn}>Copy</Text>
          </TouchableOpacity>
        </View>

        {/* Privacy */}
        <Text style={s.sectionLabel}>PRIVACY</Text>
        <View style={s.card}>
          <View style={s.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.toggleTitle}>Read receipts</Text>
              <Text style={s.toggleSub}>Show contacts when you've read their messages</Text>
            </View>
            <Switch
              value={readRx}
              onValueChange={toggleReadReceipts}
              trackColor={{ false: C.s3, true: C.accent }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Security */}
        <Text style={[s.sectionLabel, { marginTop: 20 }]}>SECURITY</Text>
        <View style={[s.card, { overflow: 'hidden' }]}>
          {SECURITY.map((row, i) => (
            <View key={row.k}>
              <View style={s.secRow}>
                <Text style={s.secKey}>{row.k}</Text>
                <Text style={s.secVal}>{row.v}</Text>
              </View>
              {i < SECURITY.length - 1 && <Hr />}
            </View>
          ))}
        </View>

        <View style={{ height: 24 }} />
        <PBtn onPress={signOut} variant="danger" full>Sign out</PBtn>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.s1,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  scroll: { padding: 16 },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.border,
    borderRadius: 20, padding: 16, marginBottom: 12,
  },
  profileName: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 3 },
  profileQid:  { fontSize: 11, color: C.accentL, letterSpacing: 1 },
  profileSub:  { fontSize: 11, color: C.dim, marginTop: 3 },

  qidRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 11, paddingHorizontal: 16, marginBottom: 20,
  },
  qidLabel: { fontSize: 9, color: C.dim, letterSpacing: 1.5 },
  qidValue: { flex: 1, fontSize: 13, fontWeight: '600', color: C.accentL, letterSpacing: 1.5 },
  copyBtn:  { fontSize: 11, fontWeight: '700', color: C.accentL },

  sectionLabel: { fontSize: 10, fontWeight: '600', color: C.dim, letterSpacing: 1.5, marginBottom: 10 },
  card: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.border, borderRadius: 16 },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 15, paddingHorizontal: 16,
  },
  toggleTitle: { fontSize: 14, fontWeight: '500', color: C.text },
  toggleSub:   { fontSize: 11, color: C.sub, marginTop: 2 },

  secRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, paddingHorizontal: 16 },
  secKey: { fontSize: 13, color: C.sub },
  secVal: { fontSize: 11, color: C.text },
});
