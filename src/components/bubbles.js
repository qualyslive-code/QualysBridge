// Qualys Family App — Message Bubble Components

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Modal,
  ScrollView, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';

const { width: SW } = Dimensions.get('window');

// ── VOICE NOTE ────────────────────────────────────────────────────────────────
export const VoiceNote = ({ msg, fromMe, contactColor }) => {
  const [playing,  setPlaying]  = useState(false);
  const [progress, setProgress] = useState(0);
  const iv  = useRef(null);
  const dur  = msg.duration ?? 12;
  const wave = msg.waveform ?? Array.from({ length: 28 }, () => 0.2 + Math.random() * 0.8);
  const filled  = Math.floor((progress / 100) * wave.length);
  const barColor = fromMe ? 'rgba(255,255,255,0.9)' : contactColor;
  const dimColor = fromMe ? 'rgba(255,255,255,0.25)' : C.s3;

  const toggle = () => {
    if (playing) {
      clearInterval(iv.current);
      setPlaying(false);
    } else {
      setPlaying(true);
      iv.current = setInterval(() => {
        setProgress((p) => {
          if (p >= 100) { clearInterval(iv.current); setPlaying(false); return 0; }
          return p + 100 / (dur * 10);
        });
      }, 100);
    }
  };
  useEffect(() => () => clearInterval(iv.current), []);

  const timeLeft = playing
    ? `0:${String(Math.max(0, Math.floor(dur * (1 - progress / 100)))).padStart(2, '0')}`
    : `0:${String(dur).padStart(2, '0')}`;

  return (
    <LinearGradient
      colors={fromMe ? [C.accent, C.accentL] : [C.s2, C.s2]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[
        styles.voiceWrap,
        fromMe ? styles.bubbleFromMe : styles.bubbleFromThem,
      ]}
    >
      <TouchableOpacity onPress={toggle} style={[
        styles.playBtn,
        { backgroundColor: fromMe ? 'rgba(255,255,255,0.18)' : contactColor + '22' },
      ]}>
        <Text style={{ color: fromMe ? '#fff' : contactColor, fontSize: 12 }}>
          {playing ? '⏸' : '▶'}
        </Text>
      </TouchableOpacity>

      <View style={styles.waveRow}>
        {wave.map((h, i) => (
          <View
            key={i}
            style={[
              styles.waveBar,
              {
                height: Math.max(4, h * 24),
                backgroundColor: i < filled ? barColor : dimColor,
              },
            ]}
          />
        ))}
      </View>

      <Text style={[styles.voiceDur, { color: fromMe ? 'rgba(255,255,255,0.55)' : C.dim }]}>
        {timeLeft}
      </Text>
    </LinearGradient>
  );
};

// ── IMAGE BUBBLE ──────────────────────────────────────────────────────────────
export const ImageBubble = ({ msg, fromMe, onExpand }) => (
  <TouchableOpacity
    onPress={() => onExpand(msg)}
    style={[fromMe ? styles.bubbleFromMe : styles.bubbleFromThem, { overflow: 'hidden', maxWidth: 220 }]}
    activeOpacity={0.9}
  >
    <LinearGradient
      colors={msg.imgGradient ?? [C.s3, C.s2]}
      style={styles.imgFrame}
    >
      <Text style={{ fontSize: 48 }}>{msg.imgEmoji ?? '🖼️'}</Text>
    </LinearGradient>
    <View style={styles.mediaBadge}>
      <Text style={styles.mediaBadgeText}>⤢ Tap</Text>
    </View>
  </TouchableOpacity>
);

// ── VIDEO BUBBLE ──────────────────────────────────────────────────────────────
export const VideoBubble = ({ msg, fromMe, onPlay }) => (
  <TouchableOpacity
    onPress={() => onPlay(msg)}
    style={[fromMe ? styles.bubbleFromMe : styles.bubbleFromThem, { overflow: 'hidden', maxWidth: 220 }]}
    activeOpacity={0.9}
  >
    <LinearGradient
      colors={msg.vidGradient ?? ['#1a1a2e', '#0f0f1e']}
      style={styles.imgFrame}
    >
      <Text style={{ fontSize: 44 }}>{msg.vidEmoji ?? '🎬'}</Text>
      <View style={styles.playCircle}>
        <Text style={{ fontSize: 20, color: '#fff', paddingLeft: 3 }}>▶</Text>
      </View>
      <View style={styles.mediaBadge}>
        <Text style={styles.mediaBadgeText}>{msg.duration ?? '0:15'}</Text>
      </View>
    </LinearGradient>
  </TouchableOpacity>
);

// ── LIGHTBOX MODAL ────────────────────────────────────────────────────────────
export const Lightbox = ({ msg, onClose }) => (
  <Modal transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity
      style={styles.lightboxBg}
      activeOpacity={1}
      onPress={onClose}
    >
      <TouchableOpacity
        onPress={onClose}
        style={styles.closeBtn}
        activeOpacity={0.8}
      >
        <Text style={{ color: C.sub, fontSize: 16 }}>✕</Text>
      </TouchableOpacity>
      <LinearGradient
        colors={msg.imgGradient ?? [C.s3, C.s2]}
        style={styles.lightboxFrame}
      >
        <Text style={{ fontSize: 96 }}>{msg.imgEmoji ?? '🖼️'}</Text>
      </LinearGradient>
      <Text style={styles.lightboxHint}>Tap anywhere to close</Text>
    </TouchableOpacity>
  </Modal>
);

// ── VIDEO PLAYER MODAL ────────────────────────────────────────────────────────
export const VideoPlayer = ({ msg, onClose }) => {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const maxSec = 15;
  const iv = useRef(null);

  const toggle = () => {
    if (playing) {
      clearInterval(iv.current);
      setPlaying(false);
    } else {
      setPlaying(true);
      iv.current = setInterval(() => {
        setElapsed((e) => {
          if (e >= maxSec) { clearInterval(iv.current); setPlaying(false); return 0; }
          return e + 0.1;
        });
      }, 100);
    }
  };
  useEffect(() => () => clearInterval(iv.current), []);
  const pct = (elapsed / maxSec) * 100;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.lightboxBg}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.8}>
          <Text style={{ color: C.sub, fontSize: 16 }}>✕</Text>
        </TouchableOpacity>

        <LinearGradient
          colors={msg.vidGradient ?? ['#1a1a2e', '#0f0f1e']}
          style={styles.videoFrame}
        >
          <Text style={{ fontSize: 80 }}>{msg.vidEmoji ?? '🎬'}</Text>
          {playing && (
            <View style={styles.videoPlayingOverlay}>
              <Text style={{ fontSize: 60, opacity: 0.3 }}>⏸</Text>
            </View>
          )}
        </LinearGradient>

        <View style={styles.scrubberWrap}>
          <View style={styles.scrubberTrack}>
            <View style={[styles.scrubberFill, { width: `${pct}%` }]} />
          </View>
          <View style={styles.scrubberLabels}>
            <Text style={styles.scrubLabel}>
              {String(Math.floor(elapsed)).padStart(2, '0')}s
            </Text>
            <Text style={styles.scrubLabel}>{maxSec}s</Text>
          </View>
        </View>

        <TouchableOpacity onPress={toggle} style={styles.videoPlayBtn} activeOpacity={0.85}>
          <LinearGradient
            colors={[C.accent, C.accentL]}
            style={styles.videoPlayBtnInner}
          >
            <Text style={{ fontSize: 22, color: '#fff', paddingLeft: playing ? 0 : 3 }}>
              {playing ? '⏸' : '▶'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

// ── STYLES ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  bubbleFromMe:   { borderRadius: 18, borderTopRightRadius: 4 },
  bubbleFromThem: { borderRadius: 18, borderTopLeftRadius: 4 },

  voiceWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, paddingHorizontal: 14,
    minWidth: 210, maxWidth: 260,
  },
  playBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  waveRow:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 1.5, height: 28 },
  waveBar:   { width: 2.5, borderRadius: 2 },
  voiceDur:  { fontSize: 10, flexShrink: 0, fontVariant: ['tabular-nums'] },

  imgFrame: {
    width: 220, height: 165,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  playCircle: {
    position: 'absolute',
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(94,79,232,0.88)',
    alignItems: 'center', justifyContent: 'center',
  },
  mediaBadge: {
    position: 'absolute', bottom: 8, right: 8,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  mediaBadgeText: { fontSize: 10, color: '#fff' },

  lightboxBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.97)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute', top: 52, right: 16,
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  lightboxFrame: {
    width: 320, height: 320, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  lightboxHint: { marginTop: 16, fontSize: 11, color: C.dim, letterSpacing: 0.3 },

  videoFrame: {
    width: 320, height: 220, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  videoPlayingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  scrubberWrap: { width: 280, marginTop: 16 },
  scrubberTrack: { height: 3, backgroundColor: C.s3, borderRadius: 2, overflow: 'hidden' },
  scrubberFill:  { height: '100%', backgroundColor: C.accent },
  scrubberLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  scrubLabel:    { fontSize: 9, color: C.dim },
  videoPlayBtn:  { marginTop: 20 },
  videoPlayBtnInner: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
  },
});
