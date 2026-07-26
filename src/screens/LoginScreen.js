// Qualys Family App — LoginScreen

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Animated, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { C } from '../theme';
import { PBtn, Spin } from '../components/atoms';
import { supabase } from '../lib/supabase';
import { createSessionFromUrl } from '../lib/authSession';

const REDIRECT_TO = 'qualysfamily://login-callback';

// FIX (was false claims): "E2E encrypted" and "Zero-fee transfers" described
// capabilities that don't exist yet — messages/email are stored as plain
// columns with no encryption layer anywhere in the stack, and "transfers"
// don't move real money (no payment rail integration exists). Reworded to
// describe what's actually true today; the underlying feature concepts
// (private-by-design discovery, in-chat money notes) are unchanged.
const FEATURES = [
  { icon: '🔑', t: 'QID identity',      d: 'One code. No number ever shown to anyone.' },
  { icon: '🔒', t: 'Private by design', d: 'No directory, no search — only people you give your QID to can reach you.' },
  { icon: '🛡️', t: 'Spam wall',         d: 'Strangers get 3 messages. You choose who gets through.' },
  { icon: '💸', t: 'Money notes',       d: 'Log what you send or owe a contact, right inside the chat.' },
];

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState('');
  const insets = useSafeAreaInsets();

  // FIX (was completely non-functional): signInWithOAuth() on React Native
  // only returns a { url } — calling it and discarding the result, like
  // before, opens nothing. The actual flow needs: get the url, hand it to
  // WebBrowser.openAuthSessionAsync so a real browser sheet opens, then
  // turn whatever redirect comes back into a session via
  // createSessionFromUrl (src/lib/authSession.js — exchangeCodeForSession
  // under the hood, since supabase-js uses the PKCE flow by default).
  //
  // PRODUCTION SEAM (unchanged from before): the schema's own comments
  // (01_qualys_family_schema.sql, app_user table) say this should go
  // through Railway, which calls Supabase Auth server-side and forwards
  // the session JWT — not the client calling Supabase directly. No Railway
  // service exists yet, so this talks to Supabase's native OAuth directly,
  // which works standalone. If/when Railway exists, only this function's
  // internals change.
  const go = async () => {
    setLoading(true);
    setErr('');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
    });
    if (error || !data?.url) {
      console.error('[LoginScreen] signInWithOAuth', error);
      setLoading(false);
      setErr('Could not start sign-in — try again.');
      return;
    }

    const res = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_TO);
    setLoading(false);

    if (res.type === 'success' && res.url) {
      const result = await createSessionFromUrl(res.url);
      if (!result.ok) setErr('Sign-in failed — try again.');
      // On success there's nothing else to do here: App.js's
      // supabase.auth.onAuthStateChange listener is what actually drives
      // navigation once the session lands.
    }
    // res.type === 'cancel' / 'dismiss' → user backed out of the browser
    // sheet themselves; not an error worth surfacing.
  };

  return (
    <LinearGradient
      colors={[C.bg, C.bg]}
      style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
    >
      {/* Ambient glow */}
      <View style={styles.ambientGlow} pointerEvents="none" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={styles.logoSection}>
          <LinearGradient
            colors={[C.accent, C.accentL]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.logoMark}
          >
            <Text style={styles.logoQ}>Q</Text>
          </LinearGradient>
          <Text style={styles.appName}>Qualys</Text>
          <Text style={styles.tagline}>Your identity.{'\n'}No phone number.</Text>
        </View>

        {/* Feature list */}
        <View style={styles.featureList}>
          {FEATURES.map(({ icon, t, d }) => (
            <View key={t} style={styles.featureRow}>
              <Text style={styles.featureIcon}>{icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{t}</Text>
                <Text style={styles.featureDesc}>{d}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* CTA */}
        <View style={styles.cta}>
          <PBtn onPress={go} disabled={loading} full variant="accent">
            {loading ? 'Signing in…' : 'Continue with Google'}
          </PBtn>
          {!!err && <Text style={styles.errText}>{err}</Text>}
          <Text style={styles.disclaimer}>
            Only your Gmail address is stored —{'\n'}
            for legal compliance only. Never visible to users.
          </Text>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    flexGrow: 1, justifyContent: 'space-between',
    paddingHorizontal: 28,
  },
  ambientGlow: {
    position: 'absolute', top: '-20%', alignSelf: 'center',
    width: 320, height: 320, borderRadius: 160,
    backgroundColor: C.accent + '18',
  },

  logoSection: { alignItems: 'center', paddingTop: 20 },
  logoMark: {
    width: 72, height: 72, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  logoQ:    { fontSize: 32, color: '#fff', fontWeight: '900' },
  appName:  { fontSize: 38, fontWeight: '800', color: C.text, letterSpacing: -1.5, lineHeight: 42 },
  tagline:  { fontSize: 15, color: C.sub, lineHeight: 26, textAlign: 'center', marginTop: 10 },

  featureList: { gap: 12, marginTop: 32 },
  featureRow: {
    flexDirection: 'row', gap: 14,
    padding: 13, paddingHorizontal: 15,
    backgroundColor: C.s1, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
  },
  featureIcon:  { fontSize: 19, flexShrink: 0 },
  featureTitle: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 2 },
  featureDesc:  { fontSize: 12, color: C.sub, lineHeight: 19 },

  cta:         { marginTop: 32, gap: 0 },
  errText:     { fontSize: 12, color: C.danger, textAlign: 'center', marginTop: 10 },
  disclaimer:  { fontSize: 11, color: C.dim, textAlign: 'center', marginTop: 13, lineHeight: 20 },
});
