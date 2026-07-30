// QualysBridge — ChatScreen

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, DESTRUCT } from '../theme';
import { Av, Tag, IBtn, E2EBar, Typing, WallNotice, TCard } from '../components/atoms';
import { useCallContext } from '../lib/CallContext';
import {
  VoiceNote, ImageBubble, VideoBubble, Lightbox, VideoPlayer,
} from '../components/bubbles';
import { ReportModal, SendMoneyScreen } from './ModalsAndOverlays';
import { supabase } from '../lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { encryptMessage, decryptMessage, isEncryptedPayload } from '../lib/e2e';
import { createPaypalOrder, capturePaypalOrder, getMediaUploadUrl } from '../lib/api';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { uid, ago } from '../utils';

// Currency symbol lookup — the real `message` table only stores
// transfer_currency_code (e.g. "USD"), not a symbol. DB.js's mock objects
// carried sym directly; that field never existed server-side, so it's
// resolved client-side instead, same as CURRENCIES does elsewhere in the app.
const CURRENCY_SYM = { USD: '$', KES: 'KSh', NGN: '₦', GBP: '£', EUR: '€' };

const DEMO_IMAGES = [
  { imgEmoji: '🌅', imgGradient: ['#1a1a4e', '#2d1b69'] },
  { imgEmoji: '🏙️', imgGradient: ['#0f2027', '#203a43'] },
  { imgEmoji: '🌿', imgGradient: ['#134e5e', '#71b280'] },
];
const DEMO_VIDEOS = [
  { vidEmoji: '🎵', vidGradient: ['#1a0533', '#3d0b69'], duration: '0:12' },
  { vidEmoji: '🏖️', vidGradient: ['#1a3a4e', '#0d6e8a'], duration: '0:08' },
];

// ── VOICE RECORDER BAR ────────────────────────────────────────────────────────
function VoiceRecorder({ onSend, onCancel }) {
  const [elapsed, setElapsed] = useState(0);
  const [wave,    setWave]    = useState(Array.from({ length: 32 }, () => 0.3));
  const iv = useRef(null);

  useEffect(() => {
    iv.current = setInterval(() => {
      setElapsed((e) => e + 1);
      setWave((p) => [...p.slice(1), 0.15 + Math.random() * 0.85]);
    }, 100);
    return () => clearInterval(iv.current);
  }, []);

  const dur = Math.floor(elapsed / 10);

  return (
    <View style={vs.bar}>
      <View style={vs.recDot} />
      <Text style={vs.timer}>0:{String(dur).padStart(2, '0')}</Text>
      <View style={vs.waveRow}>
        {wave.slice(-24).map((h, i) => (
          <View
            key={i}
            style={[vs.waveBar, {
              height: Math.max(3, h * 24),
              opacity: 0.3 + (i / 24) * 0.7,
            }]}
          />
        ))}
      </View>
      <TouchableOpacity onPress={onCancel} style={vs.cancelBtn} activeOpacity={0.8}>
        <Text style={{ color: C.dim, fontSize: 14 }}>✕</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onSend({ duration: Math.max(1, dur), waveform: wave.slice(-28) })}
        activeOpacity={0.85}
      >
        <LinearGradient colors={[C.accent, C.accentL]} style={vs.sendBtn}>
          <Text style={{ color: '#fff', fontSize: 16 }}>↑</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

// ── ATTACH TRAY ───────────────────────────────────────────────────────────────
function AttachTray({ onImage, onVideo, onClose }) {
  return (
    <View style={at.tray}>
      {[
        { icon: '🖼️', label: 'Image', action: onImage },
        { icon: '🎬', label: 'Video', action: onVideo },
      ].map(({ icon, label, action }) => (
        <TouchableOpacity key={label} onPress={action} style={at.btn} activeOpacity={0.8}>
          <Text style={{ fontSize: 22 }}>{icon}</Text>
          <Text style={at.label}>{label}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity onPress={onClose} style={at.closeBtn} activeOpacity={0.8}>
        <Text style={{ color: C.dim, fontSize: 16 }}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── CHAT SCREEN ───────────────────────────────────────────────────────────────
// contact.id and myUser.id are now real auth.users UUIDs (Supabase), not the
// old QID strings from KNOWN — see ProfileSetupScreen / LoginScreen for where
// that identity now comes from.
export default function ChatScreen({ contact, myUser, onBack }) {
  const cid = contact.id; // the OTHER user's id; conversationId is resolved below, not the same thing
  const [conversationId, setConversationId] = useState(null);
  const { startOutgoingCall } = useCallContext();
  const [msgs,       setMsgs]       = useState([]);
  const [input,      setInput]      = useState('');
  const [pendingAttachment, setPendingAttachment] = useState(null); // { type: 'image'|'video', asset }
  const [typing,     setTyping]     = useState(false); // no longer driven by simReply — left wired for a future real typing-indicator channel
  const [destruct,   setDestruct]   = useState('Off');
  const [blocked,    setBlocked]    = useState(false);
  const [showRep,    setShowRep]    = useState(false);
  const [showMoney,  setShowMoney]  = useState(false);
  const [online,     setOnline]     = useState({ on: false, last: null });
  const [showAttach, setShowAttach] = useState(false);
  const [recording,  setRecording]  = useState(false);
  const [lightbox,   setLightbox]   = useState(null);
  const [videoPlay,  setVideoPlay]  = useState(null);
  const [sentCount,  setSentCount]  = useState(0);
  const [theyReplied,setTheyReplied]= useState(false);
  const [trust,      setTrust]      = useState('new');
  const [sendError,  setSendError]  = useState(null);
  const [myPrivateKey, setMyPrivateKey] = useState(null);
  const [contactPublicKey, setContactPublicKey] = useState(null);
  const [decrypted, setDecrypted] = useState({});
  const flatRef = useRef(null);
  const insets  = useSafeAreaInsets();

  const walled   = !theyReplied && sentCount >= 3;
  const wallLeft = 3 - sentCount;

  // ── Load conversation + initial state ─────────────────────────────────────
  useEffect(() => {
    let isMounted = true;

    async function load() {
      // get_or_create_conversation handles the lo/hi ordering itself —
      // the client never needs to know which of us is user_a vs user_b.
      const { data: convId, error: convErr } = await supabase.rpc(
        'get_or_create_conversation',
        { other_user_id: cid }
      );
      if (convErr) { console.error('[ChatScreen] conversation', convErr); return; }
      if (!isMounted) return;
      setConversationId(convId);

      const [
        { data: messageRows, error: msgErr },
        { data: blockRow },
        { data: presenceRow },
        { data: trustRow },
      ] = await Promise.all([
        supabase.from('message').select('*').eq('conversation_id', convId).order('created_at', { ascending: true }),
        supabase.from('block').select('blocker_id').or(`and(blocker_id.eq.${myUser.id},blocked_id.eq.${cid}),and(blocker_id.eq.${cid},blocked_id.eq.${myUser.id})`).maybeSingle(),
        supabase.from('presence').select('is_online, last_seen_at').eq('user_id', cid).maybeSingle(),
        supabase.from('contact_trust').select('status').eq('owner_id', myUser.id).eq('contact_id', cid).maybeSingle(),
      ]);
      if (!isMounted) return;

      if (msgErr) console.error('[ChatScreen] messages', msgErr);
      setMsgs(messageRows ?? []);
      setSentCount((messageRows ?? []).filter((m) => m.sender_id === myUser.id).length);
      setTheyReplied((messageRows ?? []).some((m) => m.sender_id === cid));
      setBlocked(!!blockRow);
      // FIX: presenceRow.last_seen_at is an ISO string from Postgres —
      // ago() does Date.now() - ts arithmetic, which silently produces NaN
      // on a string. Convert once here instead of at every render site.
      setOnline({
        on: presenceRow?.is_online ?? false,
        last: presenceRow?.last_seen_at ? new Date(presenceRow.last_seen_at).getTime() : null,
      });
      // contact_trust returns zero rows for an unsaved contact — that's 'new',
      // not an error. mutual/pending come straight from the view's `status`.
      setTrust(trustRow?.status ?? 'new');

      const priv = await SecureStore.getItemAsync(`e2e_privkey_${myUser.id}`);
      if (isMounted) setMyPrivateKey(priv);
      const { data: contactRow } = await supabase
        .from('app_user_public').select('public_key').eq('id', cid).maybeSingle();
      if (isMounted) setContactPublicKey(contactRow?.public_key ?? null);

      // mark_conversation_read mirrors DB.markRead(cid) exactly
      await supabase.rpc('mark_conversation_read', { p_conversation_id: convId });
    }

    load();
    return () => { isMounted = false; };
  }, [cid, myUser.id]);

  // ── Realtime: new messages, presence changes ──────────────────────────────
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'message',
        filter: `conversation_id=eq.${conversationId}`,
      }, ({ new: row }) => {
        setMsgs((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        if (row.sender_id === cid) setTheyReplied(true);
        // a message arriving from them while this screen is open should be
        // marked read immediately, same as the original markRead-on-open did
        if (row.sender_id === cid) {
          supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'presence',
        filter: `user_id=eq.${cid}`,
      }, ({ new: row }) => {
        setOnline({ on: row.is_online, last: row.last_seen_at ? new Date(row.last_seen_at).getTime() : null });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, cid]);

  // ── Decrypt: lazily decrypt any encrypted messages once keys are available ─────
  useEffect(() => {
    if (!myPrivateKey || !contactPublicKey) return;
    const pending = msgs.filter(
      (m) => (m.type === 'text' || m.type === 'image' || m.type === 'video')
        && isEncryptedPayload(m.body) && decrypted[m.id] === undefined
    );
    if (!pending.length) return;
    let cancelled = false;
    (async () => {
      const updates = {};
      for (const m of pending) updates[m.id] = await decryptMessage(m.body, contactPublicKey, myPrivateKey);
      if (!cancelled) setDecrypted((prev) => ({ ...prev, ...updates }));
    })();
    return () => { cancelled = true; };
  }, [msgs, myPrivateKey, contactPublicKey]);

  // ── Presence heartbeat: tell the backend we're online while this screen is mounted ──
  useEffect(() => {
    supabase.rpc('set_presence', { p_is_online: true });
    return () => { supabase.rpc('set_presence', { p_is_online: false }); };
  }, []);

  useEffect(() => {
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 60);
  }, [msgs, typing]);

  // ── send_message wrapper ───────────────────────────────────────────────────
  // send_message RAISES (doesn't return a status) when blocked or walled —
  // that's a real behavior change from DB.push(), which silently no-op'd.
  // sendText()'s own guard below still prevents the call in the common case;
  // this catch covers the race where block/wall state changed since load.
  // FIX: now returns { ok, error } instead of nothing — onMoneySent below
  // needs this to know whether a transfer actually went through before
  // telling SendMoneyScreen it can show "done".
  const sendMessage = useCallback(async (rpcArgs) => {
    if (!conversationId) return { ok: false, error: new Error('No conversation yet') };
    setSendError(null);
    try {
      const { data: newMsg, error } = await supabase.rpc('send_message', {
        p_conversation_id: conversationId,
        ...rpcArgs,
      });
      if (error) throw error;
      setMsgs((prev) => [...prev, newMsg]);
      setSentCount((c) => c + 1);
      return { ok: true, message: newMsg };
    } catch (err) {
      console.error('[ChatScreen] send_message', err);
      const kind = err.message?.includes('walled') ? 'walled'
        : err.message?.includes('blocked') ? 'blocked'
        : 'failed';
      setSendError(kind);
      return { ok: false, error: err, kind };
    }
  }, [conversationId]);

  const sendText = async () => {
    if (pendingAttachment) {
      const { type, asset } = pendingAttachment;
      const caption = input.trim();
      setPendingAttachment(null);
      setInput('');
      await uploadAndSend({ type, asset, caption });
      return;
    }
    const t = input.trim();
    if (!t || blocked || walled) return;
    if (!myPrivateKey || !contactPublicKey) { setSendError('no_keys'); return; }
    setInput('');
    let bodyToSend;
    try {
      bodyToSend = await encryptMessage(t, contactPublicKey, myPrivateKey);
    } catch (err) {
      console.error('[ChatScreen] encrypt', err);
      setSendError('no_keys');
      return;
    }
    const result = await sendMessage({
      p_type: 'text',
      p_body: bodyToSend,
      p_self_destruct_option: destruct !== 'Off' ? destruct : null,
    });
    if (!result.ok) {
      // Restore the typed text so the user can try again without retyping.
      setInput(t);
    }
  };

  const sendVoice = async (data) => {
    setRecording(false);
    // FIX: was fire-and-forget — errors were silently swallowed.
    await sendMessage({
      p_type: 'voice',
      p_body: '🎙️ Voice message',
      p_voice_duration_seconds: data.duration,
      p_voice_waveform: data.waveform,
      p_self_destruct_option: destruct !== 'Off' ? destruct : null,
    });
    // sendError state is set inside sendMessage on failure — it's now
    // rendered in the input bar area below (same as the text-send error).
  };

  // Real picker + upload: asks the bridge for a signed Storage URL, PUTs
  // the file straight to Supabase Storage via uploadToSignedUrl, then
  // passes the returned `path` through to send_message as
  // p_image_asset_url / p_video_asset_url instead of null.
  const uploadAndSend = async ({ type, asset, caption }) => {
    const fileExt = (asset.uri.split('.').pop() || '').toLowerCase();
    const upRes = await getMediaUploadUrl({ conversationId, fileExt });
    if (!upRes.ok) {
      setSendError(upRes.message || 'Could not start upload');
      return;
    }
    const { path, token } = upRes.data;

    // storage-js's uploadToSignedUrl silently drops fileOptions.contentType
    // whenever the body is a Blob (it takes a separate FormData code path
    // that never reads that option) — every upload was landing in storage
    // as text/plain regardless of the real file. Uploading as an
    // ArrayBuffer instead forces the SDK into the branch that actually
    // sets the content-type header from our option.
    const fileBuffer = await (await fetch(asset.uri)).arrayBuffer();
    const CONTENT_TYPES = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      webp: 'image/webp', heic: 'image/heic',
      mp4: 'video/mp4', mov: 'video/quicktime', m4a: 'audio/m4a',
    };
    const contentType = CONTENT_TYPES[fileExt] || 'application/octet-stream';
    // Bucket name matches MEDIA_BUCKET's default in QualysBridge-Backend/src/config.js.
    const { error: uploadErr } = await supabase.storage
      .from('qualys-family-media')
      .uploadToSignedUrl(path, token, fileBuffer, { contentType });
    if (uploadErr) {
      setSendError(uploadErr.message || 'Upload failed');
      return;
    }

    const trimmedCaption = caption?.trim();
    let bodyToSend = type === 'image' ? '📷 Image' : '🎬 Video message';
    if (trimmedCaption) {
      if (!myPrivateKey || !contactPublicKey) { setSendError('no_keys'); return; }
      try {
        bodyToSend = await encryptMessage(trimmedCaption, contactPublicKey, myPrivateKey);
      } catch (err) {
        console.error('[ChatScreen] encrypt caption', err);
        setSendError('no_keys');
        return;
      }
    }

    if (type === 'image') {
      await sendMessage({ p_type: 'image', p_body: bodyToSend, p_image_asset_url: path });
    } else {
      const durSec = asset.duration ? Math.round(asset.duration / 1000) : 15;
      await sendMessage({
        p_type: 'video', p_body: bodyToSend,
        p_video_asset_url: path,
        p_video_duration_label: `0:${String(durSec).padStart(2, '0')}`,
      });
    }
  };

  const sendImage = async () => {
    setShowAttach(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setSendError('Photo library permission denied'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.8,
    });
    if (result.canceled) return;
    setPendingAttachment({ type: 'image', asset: result.assets[0] });
  };
  const sendVideo = async () => {
    setShowAttach(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setSendError('Photo library permission denied'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'], quality: 0.8,
    });
    if (result.canceled) return;
    setPendingAttachment({ type: 'video', asset: result.assets[0] });
  };

  // FIX: was synchronous and assumed success — closed the overlay
  // immediately regardless of whether sendMessage's RPC call actually
  // succeeded. Now awaits the real result and only closes on confirmed
  // success; SendMoneyScreen uses the returned result to show its own
  // success/error state instead of a hardcoded setTimeout.
  const onMoneySent = async (amount, curr, note) => {
    if (!conversationId) return { ok: false, kind: 'no_conversation' };

    const orderRes = await createPaypalOrder({
      conversationId,
      receiverId: cid,
      amount,
      currencyCode: curr.code,
      note,
    });
    if (!orderRes.ok || !orderRes.data?.approveUrl) {
      return { ok: false, kind: orderRes.kind || 'create_failed' };
    }

    const browserResult = await WebBrowser.openAuthSessionAsync(
      orderRes.data.approveUrl,
      'qualysbridge://paypal-return'
    );
    if (browserResult.type !== 'success') {
      return { ok: false, kind: 'cancelled' };
    }

    const captureRes = await capturePaypalOrder({ orderId: orderRes.data.orderId });
    if (!captureRes.ok) {
      return { ok: false, kind: captureRes.kind || 'capture_failed' };
    }

    if (captureRes.data?.ok) setShowMoney(false);
    return { ok: !!captureRes.data?.ok, kind: captureRes.data?.ok ? undefined : 'declined' };
  };

  const toggleBlock = async () => {
    const { data: nowBlocked, error } = await supabase.rpc('toggle_block', { p_target_id: cid });
    if (error) { console.error('[ChatScreen] toggle_block', error); return; }
    setBlocked(nowBlocked);
  };

  const trustColor = { mutual: C.money, pending: C.warn, new: C.warn }[trust] ?? C.warn;
  const trustLabel = { mutual: 'Mutual', pending: 'Pending', new: 'New' }[trust] ?? 'New';

  if (showMoney) return (
    <SendMoneyScreen contact={contact} myUser={myUser} onBack={() => setShowMoney(false)} onSent={onMoneySent} />
  );

  const renderMsg = ({ item: m, index }) => {
    const fromMe = m.sender_id === myUser.id;
    // FIX: m.created_at is what the DB actually returns (an ISO string) —
    // m.ts never existed. ago() wants epoch ms, so convert once here and
    // reuse below instead of repeating new Date(...).getTime().
    const ts = m.created_at ? new Date(m.created_at).getTime() : Date.now();
    return (
      <View style={[ms.msgRow, fromMe ? ms.msgRowMe : ms.msgRowThem]}>
        {m.transfer_amount != null && (
          <TCard
            data={{
              amount: m.transfer_amount,
              currency: m.transfer_currency_code,
              sym: CURRENCY_SYM[m.transfer_currency_code] ?? '',
              note: m.transfer_note,
              status: m.transfer_status,
            }}
            fromMe={fromMe}
          />
        )}
        {m.type === 'voice' && <VoiceNote msg={{ ...m, duration: m.voice_duration_seconds, waveform: m.voice_waveform }} fromMe={fromMe} contactColor={contact.color} />}
        {m.type === 'image' && <ImageBubble msg={m} fromMe={fromMe} onExpand={setLightbox} caption={isEncryptedPayload(m.body) ? decrypted[m.id] : null} />}
        {m.type === 'video' && <VideoBubble msg={m} fromMe={fromMe} onPlay={setVideoPlay} caption={isEncryptedPayload(m.body) ? decrypted[m.id] : null} />}
        {/* FIX: was `!m.transfer && !m.type` — the real `message` row always
            has `type` set (defaults to 'text', never null), so that
            condition was always false and this bubble never rendered for
            any message. The real signal for "plain text" is type === 'text'. */}
        {m.type === 'text' && (
          <LinearGradient
            colors={fromMe ? [C.accent, C.accentL] : [C.s2, C.s2]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={[ms.bubble, fromMe ? ms.bubbleMe : ms.bubbleThem]}
          >
            {/* FIX: was m.text — the column is `body`. */}
            <Text style={[ms.bubbleText, fromMe ? { color: '#fff' } : { color: C.text }]}>
              {isEncryptedPayload(m.body) ? (decrypted[m.id] ?? '🔒 Decrypting...') : m.body}
            </Text>
            <View style={ms.bubbleMeta}>
              <Text style={[ms.metaTime, fromMe ? { color: 'rgba(255,255,255,0.38)' } : { color: C.dim }]}>
                {ago(ts)}
              </Text>
              {fromMe && (
                <Text style={[ms.metaTick, { color: m.read ? C.accentXL : 'rgba(255,255,255,0.28)' }]}>
                  {m.read ? '✓✓' : '✓'}
                </Text>
              )}
              {/* FIX: was m.selfDestruct — the column is self_destruct_option. */}
              {m.self_destruct_option && (
                <Text style={ms.metaBomb}>💣{m.self_destruct_option}</Text>
              )}
            </View>
          </LinearGradient>
        )}
        {/* FIX: was `m.type || m.transfer` — m.type is always truthy now, so
            this used to render under every message including text ones
            (which already get their own meta row above). Now correctly
            scoped to "anything that isn't the plain-text bubble". */}
        {m.type !== 'text' && (
          <View style={[ms.mediaMeta, fromMe ? ms.mediaMetaMe : ms.mediaMetaThem]}>
            <Text style={ms.metaTime}>{ago(ts)}</Text>
            {fromMe && <Text style={{ fontSize: 9, color: m.read ? C.accentXL : C.dim }}>{m.read ? '✓✓' : '✓'}</Text>}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[cs.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={cs.header}>
        <IBtn icon="‹" onPress={onBack} />
        <Av name={contact.name} color={contact.color} avatarUrl={contact.avatarUrl} size={40} online={online.on} />
        <View style={{ flex: 1, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Text style={cs.headerName} numberOfLines={1}>{contact.name}</Text>
            <Tag color={trustColor} size={9}>{trustLabel}</Tag>
          </View>
          <Text style={[cs.headerStatus, { color: online.on ? C.online : C.sub }]}>
            {online.on ? 'Online now' : `Last seen ${ago(online.last ?? Date.now())}`}
          </Text>
        </View>
        <View style={cs.headerActions}>
          <TouchableOpacity onPress={() => setShowMoney(true)} style={cs.moneyBtn} activeOpacity={0.8}>
            <Text style={{ color: C.money, fontSize: 14 }}>💸</Text>
          </TouchableOpacity>
          <IBtn icon="📞" onPress={() => startOutgoingCall(contact.id, conversationId, 'voice', contact)} />
          <IBtn icon="📹" onPress={() => startOutgoingCall(contact.id, conversationId, 'video', contact)} />
          <IBtn
            icon={blocked ? '🔓' : '🚫'} danger={!blocked}
            onPress={toggleBlock}
          />
          <IBtn icon="🚩" danger onPress={() => setShowRep(true)} />
        </View>
      </View>

      <E2EBar />

      {!theyReplied && sentCount > 0 && (
        <WallNotice left={wallLeft} walled={walled} name={contact.name} />
      )}

      {/* Messages */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : insets.top + 64}
      >
        <FlatList
          ref={flatRef}
          data={[...msgs, ...(typing ? [{ id: '__typing', type: '__typing' }] : [])]}
          keyExtractor={(m) => m.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={ms.list}
          renderItem={({ item }) => {
            if (item.type === '__typing') {
              return (
                <View style={ms.typingRow}>
                  <Av name={contact.name} color={contact.color} avatarUrl={contact.avatarUrl} size={26} />
                  <Typing color={contact.color} />
                </View>
              );
            }
            return renderMsg({ item });
          }}
          ListEmptyComponent={
            <View style={ms.empty}>
              <Av name={contact.name} color={contact.color} avatarUrl={contact.avatarUrl} size={64} style={{ opacity: 0.7, marginBottom: 18 }} />
              <Text style={ms.emptyName}>{contact.name}</Text>
              <Text style={ms.emptyHint}>
                Your first message. Only you and {contact.name.split(' ')[0]} can read it.
              </Text>
            </View>
          }
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
        />

        {/* Destruct strip */}
        <View style={ds.strip}>
          <Text style={{ fontSize: 11, flexShrink: 0 }}>💣</Text>
          <Text style={ds.label}>AUTO-DELETE</Text>
          {DESTRUCT.map((o) => (
            <TouchableOpacity
              key={o}
              onPress={() => setDestruct(o)}
              style={[ds.opt, destruct === o && ds.optActive]}
              activeOpacity={0.8}
            >
              <Text style={[ds.optText, destruct === o && ds.optTextActive]}>{o}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {showAttach && <AttachTray onImage={sendImage} onVideo={sendVideo} onClose={() => setShowAttach(false)} />}
        {recording  && <VoiceRecorder onSend={sendVoice} onCancel={() => setRecording(false)} />}
        {pendingAttachment && (
          <View style={ib.pendingWrap}>
            <Image source={{ uri: pendingAttachment.asset.uri }} style={ib.pendingThumb} contentFit="cover" />
            <Text style={ib.pendingLabel}>
              {pendingAttachment.type === 'image' ? '📷 Photo attached — add a caption or send' : '🎬 Video attached — add a caption or send'}
            </Text>
            <TouchableOpacity onPress={() => setPendingAttachment(null)} style={ib.pendingRemove}>
              <Text style={{ color: C.sub, fontSize: 14 }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Input bar */}
        {!recording && (
          <View style={[ib.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <TouchableOpacity
              onPress={() => setShowAttach((v) => !v)}
              style={[ib.attachBtn, showAttach && ib.attachBtnActive]}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 18 }}>📎</Text>
            </TouchableOpacity>

            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={sendText}
              blurOnSubmit={false}
              placeholder={
                blocked ? "You've blocked this contact" :
                walled  ? `${contact.name} hasn't responded yet` :
                !theyReplied && wallLeft <= 2
                  ? `${wallLeft} message${wallLeft !== 1 ? 's' : ''} left before wall`
                  : `Message ${contact.name.split(' ')[0]}…`
              }
              placeholderTextColor={C.dim}
              editable={!blocked && !walled}
              maxLength={1000}
              multiline
              style={[ib.input, (blocked || walled) && { opacity: 0.3 }]}
            />

            {input.trim() ? (
              <TouchableOpacity onPress={sendText} activeOpacity={0.85}>
                <LinearGradient colors={[C.accent, C.accentL]} style={ib.sendBtn}>
                  <Text style={{ color: '#fff', fontSize: 16 }}>↑</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPressIn={() => !blocked && !walled && setRecording(true)}
                disabled={blocked || walled}
                style={[ib.micBtn, (blocked || walled) && { opacity: 0.25 }]}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 18 }}>🎙️</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {blocked && (
          <View style={cs.blockedBar}>
            <Text style={cs.blockedTitle}>{contact.name} is blocked</Text>
            <Text style={cs.blockedSub}>Tap 🔓 to unblock.</Text>
          </View>
        )}
        {/* FIX: sendError was set inside sendMessage on any failure but was
            never rendered — the user had no indication their message didn't
            send. Now shown as a dismissible banner above the input bar for
            all send types (text, voice, image, video, transfer). */}
        {!!sendError && !blocked && (
          <TouchableOpacity
            onPress={() => setSendError(null)}
            style={cs.sendErrorBar}
            activeOpacity={0.8}
          >
            <Text style={cs.sendErrorText}>
              {sendError === 'blocked' ? `Can't send — you or ${contact.name.split(' ')[0]} has blocked the other.`
                : sendError === 'no_keys' ? 'Encryption keys not ready yet — try again in a moment.'
                : sendError === 'walled' ? `${contact.name.split(' ')[0]} hasn't replied yet — message not sent.`
                : '⚠️ Message not sent — tap to dismiss, then try again.'}
            </Text>
          </TouchableOpacity>
        )}
      </KeyboardAvoidingView>

      {/* Overlays */}
      {showRep && <ReportModal contact={contact} myUser={myUser} onClose={() => setShowRep(false)} />}
      {lightbox  && <Lightbox msg={lightbox} onClose={() => setLightbox(null)} />}
      {videoPlay && <VideoPlayer msg={videoPlay} onClose={() => setVideoPlay(null)} />}
    </View>
  );
}

const cs = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.s1,
  },
  headerName:    { fontSize: 15, fontWeight: '600', color: C.text, flex: 1 },
  headerStatus:  { fontSize: 11, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 6 },
  moneyBtn: {
    height: 34, paddingHorizontal: 12, borderRadius: 17,
    backgroundColor: C.moneyD, borderWidth: 1, borderColor: C.money + '28',
    alignItems: 'center', justifyContent: 'center',
  },
  sendErrorBar: {
    marginHorizontal: 14, marginBottom: 6, padding: 10, paddingHorizontal: 14,
    backgroundColor: C.dangerD, borderWidth: 1, borderColor: C.danger + '30',
    borderRadius: 12,
  },
  sendErrorText: { fontSize: 12, color: C.danger, lineHeight: 18 },
  blockedBar: {
    margin: 14, padding: 11, paddingHorizontal: 16,
    backgroundColor: C.dangerD, borderWidth: 1, borderColor: C.danger + '25',
    borderRadius: 14, alignItems: 'center',
  },
  blockedTitle: { fontSize: 12, fontWeight: '600', color: C.danger, marginBottom: 2 },
  blockedSub:   { fontSize: 11, color: C.sub },
});

const ms = StyleSheet.create({
  list:      { padding: 14, gap: 2 },
  msgRow:    { flexDirection: 'column', marginBottom: 10 },
  msgRowMe:  { alignItems: 'flex-end' },
  msgRowThem:{ alignItems: 'flex-start' },
  bubble:    { maxWidth: '72%', padding: 10, paddingHorizontal: 14 },
  bubbleMe:  { borderRadius: 18, borderTopRightRadius: 4 },
  bubbleThem:{ borderRadius: 18, borderTopLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  bubbleText:{ fontSize: 14, lineHeight: 22 },
  bubbleMeta:{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 5, marginTop: 5 },
  metaTime:  { fontSize: 9 },
  metaTick:  { fontSize: 9 },
  metaBomb:  { fontSize: 9, color: C.warn },
  mediaMeta: { flexDirection: 'row', gap: 5, marginTop: 4 },
  mediaMetaMe:   { justifyContent: 'flex-end' },
  mediaMetaThem: { justifyContent: 'flex-start' },
  typingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 10 },
  empty:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyName: { fontSize: 15, color: C.text, fontWeight: '500', marginBottom: 6 },
  emptyHint: { fontSize: 12, color: C.dim, lineHeight: 20, textAlign: 'center' },
});

const ds = StyleSheet.create({
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 5,
    borderTopWidth: 1, borderTopColor: C.border,
    backgroundColor: C.s1,
  },
  label:       { fontSize: 8, color: C.dim, letterSpacing: 0.8, flexShrink: 0 },
  opt:         { paddingVertical: 3, paddingHorizontal: 11, borderRadius: 20, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border },
  optActive:   { backgroundColor: C.danger + '14', borderColor: C.danger + '35' },
  optText:     { fontSize: 9, color: C.dim },
  optTextActive: { color: C.danger, fontWeight: '700' },
});

const ib = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: C.s1, borderTopWidth: 1, borderTopColor: C.border,
  },
  attachBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  attachBtnActive: { backgroundColor: C.accentD, borderColor: C.borderM },
  pendingWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: C.s1, borderTopWidth: 1, borderTopColor: C.border,
  },
  pendingThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: C.s2 },
  pendingLabel: { flex: 1, fontSize: 12, color: C.sub },
  pendingRemove: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center',
  },
  input: {
    flex: 1, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 24, padding: 11, paddingHorizontal: 16,
    fontSize: 14, color: C.text, maxHeight: 100,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  micBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
});

const vs = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, paddingHorizontal: 12,
    backgroundColor: C.s1,
    borderTopWidth: 1, borderTopColor: C.danger + '28',
  },
  recDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: C.danger, flexShrink: 0 },
  timer:     { fontSize: 12, color: C.danger, fontWeight: '700', flexShrink: 0, minWidth: 30 },
  waveRow:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 1.5, height: 28 },
  waveBar:   { width: 3, borderRadius: 2, backgroundColor: C.danger },
  cancelBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' },
  sendBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});

const at = StyleSheet.create({
  tray:     { flexDirection: 'row', padding: 8, paddingHorizontal: 14, gap: 10, backgroundColor: C.s1, borderTopWidth: 1, borderTopColor: C.border },
  btn:      { flex: 1, alignItems: 'center', gap: 5, paddingVertical: 10, borderRadius: 14, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border },
  label:    { fontSize: 10, fontWeight: '600', color: C.sub, letterSpacing: 0.5 },
  closeBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
});

const co = StyleSheet.create({
  overlay:      { ...StyleSheet.absoluteFillObject, zIndex: 800, backgroundColor: C.bg, alignItems: 'center' },
  status:       { fontSize: 11, color: C.sub, letterSpacing: 1, marginTop: 60, marginBottom: 8 },
  name:         { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.5, marginBottom: 6 },
  subLabel:     { fontSize: 12, color: C.sub, marginBottom: 8 },
  videoPreview: { width: 280, height: 180, borderRadius: 20, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  pip:          { position: 'absolute', bottom: 10, right: 10, width: 72, height: 54, borderRadius: 12, backgroundColor: C.s3, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  controls:     { flexDirection: 'row', justifyContent: 'center', gap: 20, padding: 24, paddingBottom: 52, width: '100%' },
  controlItem:  { alignItems: 'center', gap: 8 },
  controlBtn:   { width: 58, height: 58, borderRadius: 29, backgroundColor: C.s2, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  controlLabel: { fontSize: 9, color: C.dim, letterSpacing: 0.5 },
});
