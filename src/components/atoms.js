// QualysBridge — Atom Components
// RN port: div → View, span/p → Text, button → TouchableOpacity,
//          inline CSS → StyleSheet, keyframes → Animated,
//          GRAIN_URL dropped (no SVG filter support in RN; replaced by subtle opacity layer)

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { C, F } from '../theme';
import { getMediaDownloadUrl } from '../lib/api';

// ── AVATAR ────────────────────────────────────────────────────────────────────
//
// `avatarUrl` here is a bare storage PATH (e.g. 'avatars/<uid>/<file>.jpeg'),
// not a fetchable URL — the media bucket is private, so every path needs a
// short-lived signed URL from the backend to actually load. Resolved and
// cached at module scope (shared across every Av instance, not per-component)
// so a contact list showing the same avatar 20 times signs it once, and
// concurrent renders of the same path in-flight share one request instead of
// firing 20 simultaneously.
const avatarUrlCache = new Map();    // path -> { url, expiresAt }
const avatarUrlInflight = new Map(); // path -> Promise<string|null>

async function resolveAvatarUrl(path) {
  const cached = avatarUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now() + 5000) return cached.url;
  if (avatarUrlInflight.has(path)) return avatarUrlInflight.get(path);

  const promise = (async () => {
    try {
      const res = await getMediaDownloadUrl({ path });
      if (!res.ok) return null;
      const expiresAt = Date.now() + (res.data.expiresInSeconds ?? 3600) * 1000;
      avatarUrlCache.set(path, { url: res.data.signedUrl, expiresAt });
      return res.data.signedUrl;
    } finally {
      avatarUrlInflight.delete(path);
    }
  })();
  avatarUrlInflight.set(path, promise);
  return promise;
}

export const Av = ({ name, color, size = 44, online = false, style, avatarUrl }) => {
  const [imgFailed, setImgFailed] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setImgFailed(false);
    if (!avatarUrl) { setResolvedUrl(null); return; }
    // Legacy rows from before this fix may still hold a full public URL
    // for a short window until the data migration runs — those are
    // already broken (private bucket, 400s), so there's nothing useful to
    // do with them here; only resolve real storage paths.
    if (avatarUrl.startsWith('http')) { setResolvedUrl(null); return; }
    resolveAvatarUrl(avatarUrl).then((url) => { if (!cancelled) setResolvedUrl(url); });
    return () => { cancelled = true; };
  }, [avatarUrl]);

  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const fontSize = Math.round(size * 0.33);

  return (
    <View style={[{ position: 'relative', flexShrink: 0 }, style]}>
      {resolvedUrl && !imgFailed ? (
        <Image
          source={{ uri: resolvedUrl }}
          style={[styles.avBase, { width: size, height: size, borderRadius: size / 2 }]}
          contentFit="cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
      <LinearGradient
        colors={[color + 'EE', color + '55']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.avBase,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Text style={[styles.avText, { fontSize }]}>{initials}</Text>
      </LinearGradient>
      )}
      {online && (
        <View
          style={[
            styles.onlineDot,
            {
              width:  Math.max(10, size * 0.22),
              height: Math.max(10, size * 0.22),
              borderRadius: Math.max(5, size * 0.11),
            },
          ]}
        />
      )}
    </View>
  );
};

// ── TAG ───────────────────────────────────────────────────────────────────────
export const Tag = ({ children, color = C.accent, size = 10 }) => (
  <View style={[styles.tagWrap, { backgroundColor: color + '14', borderColor: color + '28' }]}>
    <Text style={[styles.tagText, { fontSize: size, color }]}>{children}</Text>
  </View>
);

// ── PRIMARY BUTTON ────────────────────────────────────────────────────────────
const PBTN_BG = {
  accent: [C.accent, C.accentL],
  money:  [C.money, '#00E8B0'],
  ghost:  ['transparent', 'transparent'],
  danger: [C.danger + '18', C.danger + '18'],
};
const PBTN_CLR = { accent: '#fff', money: '#001A12', ghost: C.sub, danger: C.danger };

export const PBtn = ({
  children, onPress, disabled = false,
  variant = 'accent', full = false, style,
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  const press = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.93, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1,    duration: 120, useNativeDriver: true }),
    ]).start();
    if (!disabled) onPress?.();
  };

  return (
    <Animated.View style={{ transform: [{ scale }], width: full ? '100%' : undefined }}>
      <TouchableOpacity
        onPress={press}
        disabled={disabled}
        activeOpacity={0.85}
        style={[styles.pbtnWrap, { opacity: disabled ? 0.3 : 1, width: full ? '100%' : undefined }]}
      >
        <LinearGradient
          colors={PBTN_BG[variant]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.pbtnInner,
            variant === 'ghost' && styles.pbtnGhostBorder,
            style,
          ]}
        >
          <Text style={[styles.pbtnText, { color: PBTN_CLR[variant] }]}>
            {children}
          </Text>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
};

// ── ICON BUTTON ───────────────────────────────────────────────────────────────
export const IBtn = ({ icon, onPress, active = false, danger = false }) => {
  const bg  = active ? C.accentD : danger ? C.dangerD : C.s2;
  const bc  = active ? C.borderM : danger ? C.danger + '25' : C.border;
  const clr = active ? C.accentL : danger ? C.danger : C.sub;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.iBtn, { backgroundColor: bg, borderColor: bc }]}
    >
      <Text style={{ color: clr, fontSize: 16 }}>{icon}</Text>
    </TouchableOpacity>
  );
};

// ── SPINNER ───────────────────────────────────────────────────────────────────
export const Spin = () => (
  <ActivityIndicator size="small" color={C.accentL} style={{ marginRight: 6 }} />
);

// ── PULSE ─────────────────────────────────────────────────────────────────────
// A slow breathing dot with two staggered rings expanding outward from it —
// for moments where someone is genuinely waiting on something real (a call
// connecting, a message sending, media uploading), not a spinner that just
// tells you the app hasn't frozen. Defaults to C.warn — the same amber
// already used for "Pending"/"New" tags elsewhere, so it reads as an
// intentional part of this app rather than a borrowed effect.
//
// Usage:
//   <Pulse />                                  — bare dot, default size/color
//   <Pulse size={18} label="Connecting…" />     — with a caption alongside it
//   <Pulse color={C.money} size={12} />         — recolor for other contexts
export const Pulse = ({ size = 14, color = C.warn, label, style }) => {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const ringLoop = (val, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
    const r1 = ringLoop(ring1, 0);
    const r2 = ringLoop(ring2, 1000);
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0.55, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    r1.start(); r2.start(); b.start();
    return () => { r1.stop(); r2.stop(); b.stop(); };
  }, []);

  const ringStyle = (val) => ({
    position: 'absolute',
    width: size, height: size, borderRadius: size / 2,
    borderWidth: 1.5, borderColor: color,
    opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
  });

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: label ? 10 : 0 }, style]}>
      <View style={{ width: size * 2.4, height: size * 2.4, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={ringStyle(ring1)} />
        <Animated.View style={ringStyle(ring2)} />
        <Animated.View
          style={{
            width: size, height: size, borderRadius: size / 2, backgroundColor: color,
            opacity: breathe,
            shadowColor: color, shadowOpacity: 0.9, shadowRadius: size * 0.8, shadowOffset: { width: 0, height: 0 },
          }}
        />
      </View>
      {label && <Text style={{ fontSize: 12, color: C.dim, letterSpacing: 0.3 }}>{label}</Text>}
    </View>
  );
};

// ── DIVIDER ───────────────────────────────────────────────────────────────────
export const Hr = ({ indent = 0 }) => (
  <View style={{ height: 1, backgroundColor: C.border, marginLeft: indent }} />
);

// ── E2E BAR ───────────────────────────────────────────────────────────────────
export const E2EBar = () => {
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.2, duration: 1400, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1,   duration: 1400, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.e2eBar}>
      <Animated.View style={[styles.e2eDot, { opacity: blink }]} />
      {/* FIX: was "End-to-end encrypted · Identity in sealed escrow" — no
          encryption exists anywhere in the stack (message.body / app_user.email
          are plain columns). Reworded to what's actually true: QID-only
          discovery + email genuinely hidden from other users (see RLS fix). */}
      <Text style={styles.e2eText}>
        Private by design · Identity protected
      </Text>
    </View>
  );
};

// ── TYPING INDICATOR ──────────────────────────────────────────────────────────
export const Typing = ({ color }) => {
  const dots = [0, 0.2, 0.4].map(() => useRef(new Animated.Value(0)).current);
  useEffect(() => {
    dots.forEach((anim, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(anim, { toValue: -6, duration: 300, useNativeDriver: true }),
          Animated.timing(anim, { toValue:  0, duration: 300, useNativeDriver: true }),
        ])
      ).start();
    });
  }, []);

  return (
    <View style={[styles.typingWrap, { borderColor: C.border }]}>
      {dots.map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            styles.typingDot,
            { backgroundColor: color ?? C.sub, transform: [{ translateY: anim }] },
          ]}
        />
      ))}
    </View>
  );
};

// ── WALL NOTICE ───────────────────────────────────────────────────────────────
export const WallNotice = ({ left, walled, name }) => {
  if (left <= 0 && !walled) return null;
  return (
    <View style={styles.wallWrap}>
      <Text style={styles.wallTitle}>{walled ? 'Wall active' : 'Approaching wall'}</Text>
      <Text style={styles.wallBody}>
        {walled
          ? `${name} hasn't replied yet. The wall stays until they respond or save your QID.`
          : `${left} message${left !== 1 ? 's' : ''} left before the wall. It lifts when ${name} replies.`}
      </Text>
    </View>
  );
};

// ── TRANSFER CARD ─────────────────────────────────────────────────────────────
// FIX: was tagged "Confirmed" with "Zero fees · QID transfer" — implying a
// real payment cleared. No payment rail exists yet (see SendMoneyScreen in
// ModalsAndOverlays.js); this is a chat record of an amount, not a settled
// transfer. Worded honestly until a real payment integration exists.
export const TCard = ({ data, fromMe }) => (
  <View style={styles.tcardWrap}>
    <View style={styles.tcardHeader}>
      <Text style={styles.tcardLabel}>{fromMe ? 'SENT' : 'RECEIVED'}</Text>
      <Tag color={C.money} size={9}>Recorded</Tag>
    </View>
    <View style={styles.tcardBody}>
      <Text style={styles.tcardAmount}>{data.sym}{data.amount}</Text>
      {data.note ? <Text style={styles.tcardNote}>"{data.note}"</Text> : null}
      <Text style={styles.tcardSub}>Logged in chat · no funds transferred</Text>
    </View>
  </View>
);

// ── STYLES ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  avBase:    { alignItems: 'center', justifyContent: 'center' },
  avText:    { color: '#fff', fontWeight: '700', letterSpacing: -0.5 },
  onlineDot: {
    position: 'absolute', bottom: 1, right: 1,
    backgroundColor: C.online,
    borderWidth: 2, borderColor: C.bg,
  },

  tagWrap:  { borderWidth: 1, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  tagText:  { fontWeight: '600', letterSpacing: 0.2 },

  pbtnWrap:  { borderRadius: 16, overflow: 'hidden' },
  pbtnInner: { paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  pbtnGhostBorder: { borderWidth: 1, borderColor: C.border },
  pbtnText:  { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },

  iBtn: {
    width: 38, height: 38, borderRadius: 12,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },

  e2eBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 5, paddingHorizontal: 16,
    backgroundColor: C.money + '06',
    borderBottomWidth: 1, borderBottomColor: C.money + '10',
  },
  e2eDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: C.money, opacity: 0.7 },
  e2eText: { fontSize: 9, color: C.money + '70', letterSpacing: 0.6 },

  typingWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: C.s2, borderRadius: 18, borderWidth: 1, width: 56,
  },
  typingDot: { width: 6, height: 6, borderRadius: 3 },

  wallWrap: {
    marginHorizontal: 14, marginBottom: 12,
    padding: 11, paddingHorizontal: 16,
    backgroundColor: C.warnD,
    borderWidth: 1, borderColor: C.warn + '20',
    borderRadius: 14,
  },
  wallTitle: { fontSize: 12, fontWeight: '600', color: C.warn, marginBottom: 3 },
  wallBody:  { fontSize: 11, color: C.sub, lineHeight: 19 },

  tcardWrap: {
    borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: C.money + '28',
    backgroundColor: C.s2,
    minWidth: 200, maxWidth: 250,
  },
  tcardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.money + '18',
  },
  tcardLabel:  { fontSize: 12, fontWeight: '700', color: C.money, letterSpacing: 0.5 },
  tcardBody:   { padding: 16 },
  tcardAmount: { fontSize: 26, color: C.text, marginBottom: 3, fontWeight: '700' },
  tcardNote:   { fontSize: 12, color: C.sub, marginBottom: 6 },
  tcardSub:    { fontSize: 10, color: C.dim, letterSpacing: 0.3 },
});
