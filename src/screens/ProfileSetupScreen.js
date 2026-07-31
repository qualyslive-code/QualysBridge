// QualysBridge — ProfileSetupScreen

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, PALETTE } from '../theme';
import { PBtn } from '../components/atoms';
import { supabase } from '../lib/supabase';
import sodium from 'react-native-libsodium';
import { ensureKeyPair } from '../lib/e2e';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { getMediaUploadUrl } from '../lib/api';
import * as Application from 'expo-application';
import { getAppInstanceId } from '../lib/deviceIdentity';

export function ProfileSetupScreen({ gUser, onDone, onNeedLogin }) {
  const [name,  setName]  = useState(gUser?.name?.split(' ')[0] ?? '');
  const [color, setColor] = useState('#5E4FE8');
  const [err,   setErr]   = useState('');
  const [photo, setPhoto] = useState(null); // local picked asset, uploaded on submit
  const insets = useSafeAreaInsets();

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1],
    });
    if (result.canceled) return;
    setPhoto(result.assets[0]);
  };

  const [submitting, setSubmitting] = useState(false);
  const initials = name.trim().slice(0, 2).toUpperCase() || 'YO';

  const go = async () => {
    if (!name.trim()) { setErr('Choose a display name.'); return; }
    setSubmitting(true);
    setErr('');
    const deviceId = Application.getAndroidId(); // stable per-device, survives reinstall
    const instanceId = await getAppInstanceId(); // app-controlled UUID, survives Android ID quirks

    const { data: row, error } = await supabase.rpc('create_profile', {
      p_display_name: name.trim().slice(0, 40),
      p_color: color,
      p_device_id: deviceId,
      p_instance_id: instanceId,
    });
    setSubmitting(false);
    if (error) {
      console.error('[ProfileSetupScreen] create_profile', error);
      if (error.message?.includes('DEVICE_ALREADY_BOUND')) {
        setErr('This device already has an account. Log in instead.');
        onNeedLogin?.();
        return;
      }
      setErr('Could not create your profile — try again.');
      return;
    }
    try {
      await ensureKeyPair(row.id);
    } catch (e) {
      console.error('[ProfileSetupScreen] ensureKeyPair failed:', e);
      setErr('Profile created, but key setup failed. Restart the app to retry.');
      return;
    }

    let avatarUrl = null;
    if (photo) {
      try {
        const fileExt = (photo.uri.split('.').pop() || 'jpg').toLowerCase();
        const upRes = await getMediaUploadUrl({ conversationId: 'avatars', fileExt });
        if (upRes.ok) {
          const { path, token } = upRes.data;
          const fileBuffer = await (await fetch(photo.uri)).arrayBuffer();
          const CONTENT_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
          const contentType = CONTENT_TYPES[fileExt] || 'image/jpeg';
          const { error: uploadErr } = await supabase.storage
            .from('qualys-family-media')
            .uploadToSignedUrl(path, token, fileBuffer, { contentType });
          if (!uploadErr) {
            const { data: pub } = supabase.storage
              .from('qualys-family-media')
              .getPublicUrl(path);
            avatarUrl = pub?.publicUrl ?? null;
            await supabase.from('app_user').update({ avatar_url: avatarUrl }).eq('id', row.id);
          }
        }
      } catch (photoErr) {
        console.warn('[ProfileSetupScreen] avatar upload failed:', photoErr);
      }
    }

    onDone({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      color: row.color,
      qid: row.qid,
      avatarUrl,
    });
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.headline}>Create your profile</Text>
      <Text style={styles.sub}>
        Only people with your QID will find you.{'\n'}No search, no discovery.
      </Text>

      {/* Avatar preview */}
      <TouchableOpacity onPress={pickPhoto} activeOpacity={0.85} style={styles.avatarWrap}>
        {photo ? (
          <Image source={{ uri: photo.uri }} style={styles.avatar} contentFit="cover" />
        ) : (
          <LinearGradient
            colors={[color + 'EE', color + '55']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>{initials}</Text>
          </LinearGradient>
        )}
        <View style={styles.avatarEditBadge}>
          <Text style={{ fontSize: 12 }}>📷</Text>
        </View>
      </TouchableOpacity>

      {/* Colour picker */}
      <Text style={styles.label}>COLOUR</Text>
      <View style={styles.palette}>
        {PALETTE.map((cl) => (
          <TouchableOpacity
            key={cl}
            onPress={() => setColor(cl)}
            style={[
              styles.swatch,
              { backgroundColor: cl },
              color === cl && { borderWidth: 3, borderColor: cl, opacity: 1 },
            ]}
            activeOpacity={0.8}
          />
        ))}
      </View>

      {/* Display name */}
      <Text style={[styles.label, { marginTop: 24 }]}>DISPLAY NAME</Text>
      <TextInput
        value={name}
        onChangeText={(v) => { setName(v); setErr(''); }}
        placeholder="How should people address you?"
        placeholderTextColor={C.dim}
        maxLength={40}
        autoFocus
        style={[styles.input, err ? styles.inputErr : null]}
      />
      {!!err && <Text style={styles.errText}>{err}</Text>}

      <View style={{ height: 28 }} />
      <PBtn onPress={go} disabled={submitting} full>{submitting ? 'Creating…' : 'Continue →'}</PBtn>
      <View style={{ height: insets.bottom + 20 }} />
    </ScrollView>
  );
}

// ── QID REVEAL ────────────────────────────────────────────────────────────────
import { useMemo } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';

export function QIDRevealScreen({ user, onEnter }) {
  const [understood, setUnderstood] = useState(false);
  const [showQR,     setShowQR]     = useState(false);
  const [copied,     setCopied]     = useState(false);
  const insets = useSafeAreaInsets();

  const segments = user.qid.split('-');

  // Deterministic pseudo-QR grid
  const qrDots = useMemo(() => {
    const seed = user.qid.replace(/-/g, '');
    const sz = 13;
    return Array.from({ length: sz * sz }, (_, i) => {
      const r = Math.floor(i / sz), c = i % sz;
      const finder = (r < 3 && c < 3) || (r < 3 && c >= sz - 3) || (r >= sz - 3 && c < 3);
      const on = finder ? true : seed.charCodeAt(i % seed.length) % 3 !== 0;
      return { r, c, on };
    });
  }, [user.qid]);

  const copy = async () => {
    await Clipboard.setStringAsync(user.qid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = async () => {
    const available = await Sharing.isAvailableAsync();
    if (available) {
      // expo-sharing is for files; use React Native's built-in Share for text
      const { Share } = require('react-native');
      Share.share({ message: `My Qualys QID: ${user.qid}`, title: 'Add me on Qualys' });
    } else {
      copy();
    }
  };

  const HOW = [
    'Share your QID with someone — in person, over another app, wherever you trust them.',
    'They enter it here. You enter theirs.',
    'No directory. No search. Only people you choose.',
  ];

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.headline, { textAlign: 'center' }]}>Your Qualys ID</Text>
      <Text style={[styles.sub, { textAlign: 'center', maxWidth: 260, alignSelf: 'center' }]}>
        This is your only identity on Qualys.{'\n'}
        Share it like you'd share a number — only with people you trust.
      </Text>

      {/* QID card */}
      <View style={styles.qidCard}>
        {/* Card header */}
        <LinearGradient
          colors={[C.accent, C.accentL]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.qidCardHeader}
        >
          <View style={styles.qidCardLeft}>
            <View style={styles.qidLogoMark}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Q</Text>
            </View>
            <View>
              <Text style={styles.qidHeaderSub}>QUALYS ID</Text>
              <Text style={styles.qidHeaderName}>{user.displayName}</Text>
            </View>
          </View>
          <Text style={styles.qidHeaderRight}>VERIFIED{'\n'}IDENTITY</Text>
        </LinearGradient>

        {/* Segments */}
        <View style={styles.qidBody}>
          <Text style={styles.label}>QUALYS IDENTITY NUMBER</Text>
          <View style={styles.segments}>
            {segments.map((seg, i) => (
              <View key={i} style={styles.segPill}>
                <Text style={styles.segText}>{seg}</Text>
              </View>
            ))}
          </View>

          {/* Actions */}
          <View style={styles.qidActions}>
            {[
              { label: copied ? '✓ Copied' : 'Copy', onPress: copy, active: copied },
              { label: showQR ? 'Hide QR' : 'QR Code', onPress: () => setShowQR((v) => !v), active: showQR },
              { label: '↑ Share', onPress: share, primary: true },
            ].map(({ label, onPress, active, primary }) => (
              <TouchableOpacity
                key={label}
                onPress={onPress}
                activeOpacity={0.8}
                style={[
                  styles.qidActionBtn,
                  primary && styles.qidActionPrimary,
                  active && !primary && { backgroundColor: C.accent + '16', borderColor: C.accent + '35' },
                ]}
              >
                <Text style={[
                  styles.qidActionText,
                  primary && { color: '#fff', fontWeight: '700' },
                  active && !primary && { color: C.accentL },
                ]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* QR grid */}
          {showQR && (
            <View style={styles.qrWrap}>
              <View style={styles.qrGrid}>
                {qrDots.map(({ r, c, on }) => (
                  <View
                    key={`${r}-${c}`}
                    style={[styles.qrDot, { backgroundColor: on ? '#111' : '#fff' }]}
                  />
                ))}
              </View>
              <Text style={styles.qrLabel}>{user.qid}</Text>
            </View>
          )}
        </View>
      </View>

      {/* How it works */}
      <View style={styles.howCard}>
        <Text style={styles.label}>HOW IT WORKS</Text>
        {HOW.map((txt, i) => (
          <View key={i} style={styles.howRow}>
            <View style={styles.howNum}>
              <Text style={styles.howNumText}>{i + 1}</Text>
            </View>
            <Text style={styles.howText}>{txt}</Text>
          </View>
        ))}
      </View>

      {/* Spam wall notice */}
      <View style={styles.wallCard}>
        <Text style={styles.wallCardTitle}>🛡️ The Spam Wall</Text>
        <Text style={styles.wallCardBody}>
          Anyone who has your QID but who you haven't saved gets{' '}
          <Text style={{ color: C.text, fontWeight: '700' }}>3 messages</Text>.
          The wall lifts only when{' '}
          <Text style={{ color: C.text, fontWeight: '700' }}>you reply</Text>{' '}
          or save their QID.
        </Text>
      </View>

      {/* Understood checkbox */}
      <TouchableOpacity
        onPress={() => setUnderstood((v) => !v)}
        style={[styles.checkRow, understood && styles.checkRowActive]}
        activeOpacity={0.8}
      >
        <View style={[styles.checkbox, understood && styles.checkboxActive]}>
          {understood && <Text style={{ color: '#001A12', fontSize: 12, fontWeight: '800' }}>✓</Text>}
        </View>
        <Text style={[styles.checkText, understood && { color: C.money }]}>
          I understand my Gmail is stored for legal compliance only — it's never shown to any user
        </Text>
      </TouchableOpacity>

      <PBtn onPress={onEnter} disabled={!understood} full>
        Enter Qualys →
      </PBtn>
      <View style={{ height: insets.bottom + 20 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 24, paddingTop: 28 },

  headline: { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: -0.8, marginBottom: 8 },
  sub:      { fontSize: 13, color: C.sub, lineHeight: 22, marginBottom: 32 },
  label:    { fontSize: 10, fontWeight: '600', color: C.dim, letterSpacing: 1.5, marginBottom: 12 },
  errText:  { fontSize: 11, color: C.danger, marginTop: 6 },

  avatarWrap: { alignItems: 'center', marginBottom: 32, alignSelf: 'center' },
  avatar:     { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 36, fontWeight: '700', color: '#fff' },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.s2, borderWidth: 2, borderColor: C.bg,
    alignItems: 'center', justifyContent: 'center',
  },

  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch:  { width: 34, height: 34, borderRadius: 17, opacity: 0.85 },

  input: {
    backgroundColor: C.s2, borderWidth: 1.5, borderColor: C.border,
    borderRadius: 14, padding: 14, paddingHorizontal: 16,
    fontSize: 15, color: C.text,
  },
  inputErr: { borderColor: C.danger + '60' },

  // QID card
  qidCard: {
    borderRadius: 24, overflow: 'hidden',
    borderWidth: 1, borderColor: C.borderM,
    backgroundColor: C.s1, marginBottom: 14, marginTop: 24,
  },
  qidCardHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', padding: 14, paddingHorizontal: 20,
  },
  qidCardLeft:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qidLogoMark:   {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  qidHeaderSub:  { fontSize: 9, color: 'rgba(255,255,255,0.6)', letterSpacing: 2, marginBottom: 2 },
  qidHeaderName: { fontSize: 14, fontWeight: '600', color: '#fff' },
  qidHeaderRight: { fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: 1, textAlign: 'right', lineHeight: 16 },

  qidBody:   { padding: 20, paddingTop: 18 },
  segments:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18, marginTop: 6 },
  segPill:   {
    backgroundColor: C.s2, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
  },
  segText:   { fontSize: 20, fontWeight: '600', color: C.text, letterSpacing: 3.5 },

  qidActions:     { flexDirection: 'row', gap: 8 },
  qidActionBtn:   {
    flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center',
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
  },
  qidActionPrimary: {
    backgroundColor: C.accent,
  },
  qidActionText:  { fontSize: 12, fontWeight: '500', color: C.sub },

  qrWrap: { marginTop: 16, alignItems: 'center', gap: 10 },
  qrGrid: {
    backgroundColor: '#fff', borderRadius: 14, padding: 10,
    flexDirection: 'row', flexWrap: 'wrap', width: 13 * 10 + 20,
  },
  qrDot:  { width: 9, height: 9, borderRadius: 1.5, margin: 0.5 },
  qrLabel: { fontSize: 9, color: C.dim, letterSpacing: 1.5 },

  howCard: {
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.border,
    borderRadius: 18, padding: 16, paddingHorizontal: 18, marginBottom: 14,
  },
  howRow:  { flexDirection: 'row', gap: 12, marginBottom: 10 },
  howNum:  {
    width: 22, height: 22, borderRadius: 7, flexShrink: 0,
    backgroundColor: C.accentD, borderWidth: 1, borderColor: C.borderM,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  howNumText: { fontSize: 10, fontWeight: '700', color: C.accentL },
  howText:    { fontSize: 12, color: C.sub, lineHeight: 20, flex: 1, paddingTop: 2 },

  wallCard: {
    backgroundColor: C.warnD, borderWidth: 1, borderColor: C.warn + '20',
    borderRadius: 16, padding: 13, paddingHorizontal: 16, marginBottom: 14,
  },
  wallCardTitle: { fontSize: 12, fontWeight: '700', color: C.warn, marginBottom: 5 },
  wallCardBody:  { fontSize: 12, color: C.sub, lineHeight: 21 },

  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    padding: 12, paddingHorizontal: 16,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.border,
    borderRadius: 14, marginBottom: 14,
  },
  checkRowActive: { backgroundColor: C.money + '10', borderColor: C.money + '35' },
  checkbox: {
    width: 22, height: 22, borderRadius: 7,
    backgroundColor: C.s2, borderWidth: 1.5, borderColor: C.borderM,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  checkboxActive: { backgroundColor: C.money, borderColor: C.money },
  checkText: { fontSize: 12, color: C.sub, lineHeight: 20, flex: 1 },
});
