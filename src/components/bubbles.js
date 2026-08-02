// QualysBridge — Message Bubble Components

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Modal,
  ScrollView, Dimensions, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { C } from '../theme';
import { getMediaDownloadUrl } from '../lib/api';

// Re-downloads the already-signed remote URL into a temp cache file, then
// saves that local file into the device's camera roll/gallery. Media
// (like exoplayer/expo-video's own cache) isn't exposed to JS, so a
// fresh download is the simplest reliable way to get a real local file
// MediaLibrary can hand to the OS — the file was very likely already
// CDN/edge-cached from the first in-app load, so this is usually cheap.
async function saveMediaToDevice(url, filename) {
  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Allow gallery access to save this file.');
    return;
  }
  try {
    const file = await File.downloadFileAsync(url, Paths.cache);
    await MediaLibrary.saveToLibraryAsync(file.uri);
    Alert.alert('Saved', 'Saved to your gallery.');
  } catch (err) {
    Alert.alert('Save failed', err.message || 'Could not save this file.');
  }
}

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
// msg.image_asset_url is a private storage `path` (not a URL) — resolve it
// to a short-lived signed URL via the bridge before rendering. Falls back
// to the old gradient placeholder while resolving or if there's no path
// (e.g. legacy demo rows).
export const ImageBubble = ({ msg, fromMe, onExpand, caption }) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (msg.image_asset_url) {
      getMediaDownloadUrl({ path: msg.image_asset_url }).then((res) => {
        if (!cancelled && res.ok) setUrl(res.data.signedUrl);
      });
    }
    return () => { cancelled = true; };
  }, [msg.image_asset_url]);

  return (
    <TouchableOpacity
      onPress={() => onExpand(msg)}
      style={[fromMe ? styles.bubbleFromMe : styles.bubbleFromThem, styles.mediaCard]}
      activeOpacity={0.9}
    >
      {url ? (
        <Image source={{ uri: url }} style={styles.imgFrame} contentFit="cover" />
      ) : (
        <LinearGradient colors={msg.imgGradient ?? [C.s3, C.s2]} style={styles.imgFrame}>
          <Text style={{ fontSize: 48 }}>{msg.imgEmoji ?? '🖼️'}</Text>
        </LinearGradient>
      )}
      <View style={styles.mediaFooter}>
        <Text style={styles.mediaFooterIcon}>🖼️</Text>
        <Text style={styles.mediaFooterLabel}>Photo</Text>
      </View>
      {caption ? <Text style={styles.captionText}>{caption}</Text> : null}
    </TouchableOpacity>
  );
};

// ── VIDEO BUBBLE ──────────────────────────────────────────────────────────────
// Thumbnail generation is a separate future step — this still shows the
// gradient tile as a poster, but the tap now opens a real playable video
// (see VideoPlayer below) instead of a fake scrubber.
export const VideoBubble = ({ msg, fromMe, onPlay, caption }) => {
  const [thumbUrl, setThumbUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (msg.video_thumb_url) {
      getMediaDownloadUrl({ path: msg.video_thumb_url }).then((res) => {
        if (!cancelled && res.ok) setThumbUrl(res.data.signedUrl);
      });
    }
    return () => { cancelled = true; };
  }, [msg.video_thumb_url]);

  return (
    <TouchableOpacity
      onPress={() => onPlay(msg)}
      style={[fromMe ? styles.bubbleFromMe : styles.bubbleFromThem, styles.mediaCard]}
      activeOpacity={0.9}
    >
      {thumbUrl ? (
        <View style={styles.imgFrame}>
          <Image source={{ uri: thumbUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <View style={styles.playCircle}>
            <Text style={{ fontSize: 20, color: '#fff', paddingLeft: 3 }}>▶</Text>
          </View>
        </View>
      ) : (
        <LinearGradient
          colors={msg.vidGradient ?? ['#1a1a2e', '#0f0f1e']}
          style={styles.imgFrame}
        >
          <Text style={{ fontSize: 44 }}>{msg.vidEmoji ?? '🎬'}</Text>
          <View style={styles.playCircle}>
            <Text style={{ fontSize: 20, color: '#fff', paddingLeft: 3 }}>▶</Text>
          </View>
        </LinearGradient>
      )}
      <View style={styles.mediaFooter}>
        <Text style={styles.mediaFooterIcon}>▶</Text>
        <Text style={styles.mediaFooterLabel}>Video</Text>
        <Text style={styles.mediaFooterDur}>{msg.video_duration_label ?? msg.duration ?? '0:15'}</Text>
      </View>
      {caption ? <Text style={styles.captionText}>{caption}</Text> : null}
    </TouchableOpacity>
  );
};

// ── LIGHTBOX MODAL ────────────────────────────────────────────────────────────
export const Lightbox = ({ msg, onClose }) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (msg.image_asset_url) {
      getMediaDownloadUrl({ path: msg.image_asset_url }).then((res) => {
        if (!cancelled && res.ok) setUrl(res.data.signedUrl);
      });
    }
    return () => { cancelled = true; };
  }, [msg.image_asset_url]);

  return (
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
        {url && (
          <TouchableOpacity
            onPress={() => saveMediaToDevice(url, 'image.jpg')}
            style={styles.saveBtn}
            activeOpacity={0.8}
          >
            <Text style={{ color: C.sub, fontSize: 16 }}>⬇</Text>
          </TouchableOpacity>
        )}
        {url ? (
          <Image source={{ uri: url }} style={styles.lightboxFrame} contentFit="contain" />
        ) : (
          <LinearGradient
            colors={msg.imgGradient ?? [C.s3, C.s2]}
            style={styles.lightboxFrame}
          >
            <Text style={{ fontSize: 96 }}>{msg.imgEmoji ?? '🖼️'}</Text>
          </LinearGradient>
        )}
        <Text style={styles.lightboxHint}>Tap anywhere to close</Text>
      </TouchableOpacity>
    </Modal>
  );
};

// ── VIDEO PLAYER MODAL ────────────────────────────────────────────────────────
// Resolves msg.video_asset_url (a storage path) to a signed URL, then plays
// it for real via expo-video instead of the old setInterval fake scrubber.
export const VideoPlayer = ({ msg, onClose }) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (msg.video_asset_url) {
      getMediaDownloadUrl({ path: msg.video_asset_url }).then((res) => {
        if (!cancelled && res.ok) setUrl(res.data.signedUrl);
      });
    }
    return () => { cancelled = true; };
  }, [msg.video_asset_url]);

  // Every video GET has been silently rejected before it ever reaches
  // Supabase's own logs (confirmed via storage logs — zero GET entries for
  // any .mp4, ever, while images fetch fine). ExoPlayer's default request
  // headers (User-Agent in particular) look different from a normal
  // browser/app fetch and are the likely trigger for a CDN-level block in
  // front of Supabase Storage. Passing a source object with explicit
  // headers overrides that default.
  const source = url
    ? { uri: url, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' } }
    : null;
  const player = useVideoPlayer(source, (p) => { p.play(); });

  useEffect(() => {
    if (url && player) player.play();
  }, [url, player]);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.lightboxBg}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.8}>
          <Text style={{ color: C.sub, fontSize: 16 }}>✕</Text>
        </TouchableOpacity>
        {url && (
          <TouchableOpacity
            onPress={() => saveMediaToDevice(url, 'video.mp4')}
            style={styles.saveBtn}
            activeOpacity={0.8}
          >
            <Text style={{ color: C.sub, fontSize: 16 }}>⬇</Text>
          </TouchableOpacity>
        )}

        {url ? (
          <VideoView
            style={styles.videoFrame}
            player={player}
            nativeControls
            contentFit="contain"
          />
        ) : (
          <LinearGradient
            colors={msg.vidGradient ?? ['#1a1a2e', '#0f0f1e']}
            style={styles.videoFrame}
          >
            <Text style={{ fontSize: 80 }}>{msg.vidEmoji ?? '🎬'}</Text>
          </LinearGradient>
        )}
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
  mediaCard: { overflow: 'hidden', maxWidth: 240, backgroundColor: C.s2 },
  mediaBadge: {
    position: 'absolute', bottom: 8, right: 8,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  mediaBadgeText: { fontSize: 10, color: '#fff' },
  mediaFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: C.s3,
  },
  mediaFooterIcon:  { fontSize: 13, color: C.sub },
  mediaFooterLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: C.text },
  mediaFooterDur:   { fontSize: 11, color: C.dim, fontVariant: ['tabular-nums'] },
  captionText: { fontSize: 13, color: C.text, padding: 8, paddingTop: 6 },

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
  saveBtn: {
    position: 'absolute', top: 52, right: 62,
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
