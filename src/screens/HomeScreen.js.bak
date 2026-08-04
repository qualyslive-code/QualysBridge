// QualysBridge — HomeScreen

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, Modal, Pressable, RefreshControl, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FlashList } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F } from '../theme';
import { Av, Tag, IBtn, Hr } from '../components/atoms';
import { AddContactModal } from './ModalsAndOverlays';
import { supabase } from '../lib/supabase';
import { ago } from '../utils';
import { useGroupCallContext } from '../lib/GroupCallContext';

export default function HomeScreen({ user, onLogout, onOpenChat, onOpenSettings, onOpenSelfNotes }) {
  const [contacts, setContacts] = useState([]);
  const [search,   setSearch]   = useState('');
  const [showAdd,  setShowAdd]  = useState(false);
  const [onlines,  setOnlines]  = useState({});
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [groupSelected,   setGroupSelected]   = useState([]);
  const [showQID, setShowQID] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { startGroupCall, MAX_PARTICIPANTS } = useGroupCallContext();
  const insets = useSafeAreaInsets();

  // Normalizes get_conversations()'s row shape into exactly what renderItem
  // below already expects (c.id, c.name, c.lastMsg, c.lastTs, c.unread,
  // c.walled, c.trust) — kept as a separate step so the JSX further down
  // didn't need to change field names throughout.
  const normalize = (row) => ({
    id: row.other_user_id,        // real UUID — matches what ChatScreen's contact.id contract requires
    qid: row.other_qid,           // for display only (QID card, search-by-QID) — never used as an id in queries
    name: row.other_display_name,
    color: row.other_color,
    avatarUrl: row.other_avatar_url,
    unread: row.unread_count,
    lastMsg: row.last_message_body ?? '',
    lastTs: row.last_message_at ? new Date(row.last_message_at).getTime() : Date.now(),
    walled: row.walled,
    trust: row.trust,
    pending: row.trust === 'pending',
  });

  const loadConversations = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_conversations');
    if (error) { console.error('[HomeScreen] get_conversations', error); return; }
    setContacts((data ?? []).map(normalize));
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // ── Online status: real presence rows for every contact currently shown ───
  useEffect(() => {
    if (contacts.length === 0) return;
    let isMounted = true;

    async function refreshPresence() {
      const ids = contacts.map((c) => c.id);
      const { data, error } = await supabase
        .from('presence')
        .select('user_id, is_online, last_seen_at')
        .in('user_id', ids);
      if (error) { console.error('[HomeScreen] presence', error); return; }
      if (!isMounted) return;
      const o = {};
      (data ?? []).forEach((row) => {
        o[row.user_id] = { on: row.is_online, last: row.last_seen_at };
      });
      setOnlines(o);
    }

    refreshPresence();
    const iv = setInterval(refreshPresence, 15000); // was 2800ms against a local Map; 15s is plenty for a real network poll
    return () => { isMounted = false; clearInterval(iv); };
  }, [contacts]);

  // ── Realtime: refresh the list when a new message arrives in ANY of the
  // caller's conversations, so unread counts / last-message preview update
  // without a manual pull-to-refresh. Filtered by sender or recipient being
  // irrelevant here — postgres_changes can't filter on "any conversation
  // I'm part of" directly, so this listens broadly on message INSERT and
  // just re-runs get_conversations(), which is cheap and already RLS-scoped.
  useEffect(() => {
    const channel = supabase
      .channel('home:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message' }, () => {
        loadConversations();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadConversations]);

  const totalUnread = useMemo(() => contacts.reduce((s, c) => s + (c.unread ?? 0), 0), [contacts]);

  const copyQID = useCallback(async () => {
    if (user?.qid) await Clipboard.setStringAsync(user.qid);
  }, [user?.qid]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConversations();
    setRefreshing(false);
  }, [loadConversations]);

  const filtered    = useMemo(() =>
    contacts.filter((c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      // FIX: was c.id (raw UUID) — search should match the user-facing QID
      // (e.g. "AB12-CD34-EF56-GH78"), which is c.qid, not the internal UUID.
      (c.qid ?? '').toLowerCase().includes(search.toLowerCase())
    ), [contacts, search]);

  const onlineCount = Object.values(onlines).filter((o) => o.on).length;

  // Splits the flat contact list into a header/row sequence for FlatList
  // (pending requests surfaced above active chats) instead of one
  // undifferentiated list \u2014 mirrors what c.trust already encodes, no new
  // data. Only groups when not searching; a search result set stays a
  // single flat "RESULTS" list.
  const listData = React.useMemo(() => {
    if (search) {
      return [
        { type: 'header', key: 'h-results', label: `RESULTS \u00b7 ${filtered.length}` },
        ...filtered.map((c) => ({ type: 'contact', key: c.id, contact: c })),
      ];
    }
    const pending = filtered.filter((c) => c.trust === 'pending');
    const active  = filtered.filter((c) => c.trust !== 'pending');
    const out = [];
    if (pending.length > 0) {
      out.push({ type: 'header', key: 'h-pending', label: `PENDING REQUESTS \u00b7 ${pending.length}`, tone: 'warn' });
      pending.forEach((c) => out.push({ type: 'contact', key: c.id, contact: c }));
    }
    out.push({ type: 'header', key: 'h-active', label: 'CONVERSATIONS' });
    active.forEach((c) => out.push({ type: 'contact', key: c.id, contact: c }));
    return out;
  }, [filtered, search]);

  const open = (c) => {
    setContacts((p) => p.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x)));
    onOpenChat(c);
  };

  const renderRow = ({ item, index }) => {
    if (item.type === 'header') {
      return (
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: item.tone === 'warn' ? C.warn : C.dim }}>
            {item.label}
          </Text>
        </View>
      );
    }
    const c = item.contact;
    const on    = onlines[c.id];
    const walled = c.walled;
    const trust  = c.trust;
    const tColor = { mutual: C.money, pending: C.warn, new: C.warn }[trust] ?? C.warn;
    const tLabel = { mutual: 'Mutual', pending: 'Pending', new: 'New' }[trust] ?? 'New';

    return (
      <View>
        <TouchableOpacity onPress={() => open(c)} style={hs.row} activeOpacity={0.7}>
          <Av name={c.name} color={c.color} avatarUrl={c.avatarUrl} size={52} online={on?.on} />
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <View style={hs.rowTop}>
              <View style={hs.nameRow}>
                <Text
                  style={[hs.name, c.unread > 0 && { fontWeight: '700' }]}
                  numberOfLines={1}
                >
                  {c.name}
                </Text>
                <Tag color={tColor} size={9}>{tLabel}</Tag>
                {walled && <Tag color={C.danger} size={9}>Walled</Tag>}
              </View>
              <Text style={hs.ts}>{ago(c.lastTs)}</Text>
            </View>
            <View style={hs.rowBottom}>
              <Text
                style={[hs.lastMsg, c.unread > 0 && { color: 'rgba(240,235,248,0.6)', fontWeight: '500' }]}
                numberOfLines={1}
              >
                {c.pending ? 'Request sent — waiting for them to save your QID' : c.lastMsg}
              </Text>
              {c.unread > 0 && (
                <View style={hs.badge}>
                  <Text style={hs.badgeText}>{c.unread}</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
        {listData[index + 1]?.type === 'contact' && <Hr indent={81} />}
      </View>
    );
  };

  return (
    <View style={[hs.container, { paddingTop: insets.top }]}>
      {/* App bar */}
      <View style={hs.appBar}>
        <View style={hs.appBarLeft}>
          <LinearGradient colors={[C.accent, C.accentL]} style={hs.logoMark}>
            <Text style={hs.logoQ}>Q</Text>
          </LinearGradient>
          <Text style={hs.appTitle}>Qualys</Text>
          {totalUnread > 0 && (
            <View style={hs.unreadBadge}>
              <Text style={hs.unreadText}>{totalUnread}</Text>
            </View>
          )}
        </View>
        <View style={hs.appBarRight}>
          <TouchableOpacity onPress={() => setShowQID(true)} style={hs.qidBtn} activeOpacity={0.8}>
            <Text style={hs.qidBtnText}>◈</Text>
          </TouchableOpacity>
          <IBtn icon="⚙️" onPress={onOpenSettings} />
          <TouchableOpacity onPress={() => setShowAdd(true)} style={hs.addBtn} activeOpacity={0.85}>
            <LinearGradient colors={[C.accent, C.accentL]} style={hs.addBtnInner}>
              <Text style={hs.addBtnText}>＋ Add</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>

      {/* Notes to Self */}
      <TouchableOpacity onPress={onOpenSelfNotes} style={hs.selfNotesRow} activeOpacity={0.7}>
        <Av name={user.displayName} color={user.color} avatarUrl={user.avatarUrl} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={hs.selfNotesTitle}>Notes to Self</Text>
          <Text style={hs.selfNotesSub}>Private — only visible to you</Text>
        </View>
      </TouchableOpacity>

      {/* Search */}
      <View style={hs.searchWrap}>
        <Text style={hs.searchIcon}>⌕</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or QID…"
          placeholderTextColor={C.dim}
          style={hs.searchInput}
        />
      </View>

      <Hr />

      {/* Section header */}
      <View style={hs.sectionHeader}>
        <Text style={hs.sectionTitle}>
          {search ? `RESULTS · ${filtered.length}` : 'CONVERSATIONS'}
        </Text>
        <Text style={hs.onlineCount}>{onlineCount} online</Text>
      </View>

      {/* Contacts list */}
      <FlashList
        data={listData}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        getItemType={(item) => item.type}
        estimatedItemSize={72}
        style={{ flex: 1 }}
        contentContainerStyle={listData.length === 0 ? hs.emptyWrap : undefined}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.sub} colors={[C.accent]} />
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', padding: 52 }}>
            <Text style={{ fontSize: 36, marginBottom: 16, opacity: 0.4 }}>💬</Text>
            <Text style={hs.emptyTitle}>
              {search ? 'No results' : 'No conversations yet'}
            </Text>
            <Text style={hs.emptyHint}>
              {search
                ? 'Try a different name or QID.'
                : 'Add a contact with their QID to get started.'}
            </Text>
          </View>
        }
      />

      {contacts.length > 0 && (
        <TouchableOpacity
          style={[hs.fab, { bottom: insets.bottom + 20 }]}
          onPress={() => { setGroupSelected([]); setShowGroupPicker(true); }}
          activeOpacity={0.85}
        >
          <LinearGradient colors={[C.accent, C.accentL]} style={hs.fabInner}>
            <Text style={hs.fabIcon}>🎥</Text>
          </LinearGradient>
        </TouchableOpacity>
      )}

      <Modal visible={showQID} transparent animationType="fade" onRequestClose={() => setShowQID(false)}>
        <Pressable style={hs.qidModalOverlay} onPress={() => setShowQID(false)}>
          <View style={hs.qidModalCard} onStartShouldSetResponder={() => true}>
            <View style={hs.qidModalHeader}>
              <Text style={hs.qidModalTitle}>Your QID</Text>
              <TouchableOpacity onPress={() => setShowQID(false)}>
                <Text style={hs.qidModalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Av name={user?.displayName || 'You'} color={user?.color || C.accentD} avatarUrl={user?.avatarUrl} size={64} />
            <Text style={hs.qidModalName}>{user?.displayName}</Text>
            <View style={hs.qidModalCode}>
              <Text style={hs.qidModalCodeText} numberOfLines={2}>{user?.qid || 'No QID set'}</Text>
            </View>
            <TouchableOpacity onPress={copyQID} style={hs.qidModalCopy} activeOpacity={0.8}>
              <Text style={hs.qidModalCopyText}>📋 Copy QID</Text>
            </TouchableOpacity>
            <Text style={hs.qidModalHint}>Share this with others to connect</Text>
          </View>
        </Pressable>
      </Modal>

      {showAdd && (
        <AddContactModal
          myUser={user}
          onClose={() => setShowAdd(false)}
          onAdd={(c) => setContacts((p) => [c, ...p])}
        />
      )}

      {showGroupPicker && (
        <View style={hs.groupPickerOverlay}>
          <View style={hs.groupPickerCard}>
            <Text style={hs.groupPickerTitle}>Start group call</Text>
            <Text style={hs.groupPickerSub}>Pick up to {MAX_PARTICIPANTS - 1} people</Text>
            <FlatList
              data={contacts}
              keyExtractor={(c) => c.id}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => {
                const selected = groupSelected.includes(item.id);
                const disabled = !selected && groupSelected.length >= MAX_PARTICIPANTS - 1;
                return (
                  <TouchableOpacity
                    disabled={disabled}
                    onPress={() => setGroupSelected((prev) =>
                      selected ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                    )}
                    style={[hs.groupPickerRow, disabled && { opacity: 0.35 }]}
                    activeOpacity={0.7}
                  >
                    <Av name={item.name} color={item.color} avatarUrl={item.avatarUrl} size={36} />
                    <Text style={hs.groupPickerName}>{item.name}</Text>
                    {selected && <Text style={hs.groupPickerCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
            />
            <View style={hs.groupPickerActions}>
              <TouchableOpacity onPress={() => setShowGroupPicker(false)} style={hs.groupPickerCancel} activeOpacity={0.8}>
                <Text style={hs.groupPickerCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={groupSelected.length === 0}
                onPress={async () => {
                  setShowGroupPicker(false);
                  await startGroupCall(groupSelected, 'video');
                }}
                style={[hs.groupPickerStart, groupSelected.length === 0 && { opacity: 0.4 }]}
                activeOpacity={0.85}
              >
                <Text style={hs.groupPickerStartText}>Start ({groupSelected.length})</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const hs = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  groupPickerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  groupPickerCard: { width: '88%', maxHeight: '70%', backgroundColor: C.s1, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  groupPickerTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  groupPickerSub: { color: C.sub, fontSize: 12, marginTop: 4, marginBottom: 12 },
  groupPickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  groupPickerName: { color: C.text, fontSize: 15, flex: 1 },
  groupPickerCheck: { color: C.money, fontSize: 18, fontWeight: '700' },
  groupPickerActions: { flexDirection: 'row', gap: 12, marginTop: 14 },
  groupPickerCancel: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: C.s2 },
  groupPickerCancelText: { color: C.sub, fontWeight: '600' },
  groupPickerStart: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: C.money },
  groupPickerStartText: { color: '#fff', fontWeight: '700' },

  appBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  appBarLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  appBarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoMark: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoQ:    { fontSize: 16, fontWeight: '800', color: '#fff' },
  appTitle: { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  unreadBadge: {
    backgroundColor: C.accent, borderRadius: 9,
    paddingHorizontal: 9, paddingVertical: 2,
  },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  addBtn:      { overflow: 'hidden', borderRadius: 19 },
  addBtnInner: { height: 38, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  addBtnText:  { color: '#fff', fontSize: 13, fontWeight: '700' },

  qidBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  qidBtnText: { fontSize: 16, color: C.accent },

  fab: {
    position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  fabInner: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 28 },
  fabIcon: { fontSize: 24 },

  qidModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  qidModalCard: {
    width: '85%', maxWidth: 360, backgroundColor: C.s1, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, padding: 20, alignItems: 'center', gap: 12,
  },
  qidModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 4 },
  qidModalTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  qidModalClose: { fontSize: 18, color: C.sub, padding: 4 },
  qidModalName: { fontSize: 16, fontWeight: '600', color: C.text },
  qidModalCode: { backgroundColor: C.s2, borderRadius: 12, padding: 12, width: '100%', borderWidth: 1, borderColor: C.border },
  qidModalCodeText: {
    fontSize: 14, color: C.text, textAlign: 'center', letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  qidModalCopy: {
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10,
    backgroundColor: C.accent + '20', borderWidth: 1, borderColor: C.accent + '30',
  },
  qidModalCopyText: { fontSize: 13, color: C.accent, fontWeight: '600' },
  qidModalHint: { fontSize: 11, color: C.dim, textAlign: 'center' },

  qidCard: {
    marginHorizontal: 16, borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: C.borderM, marginBottom: 14,
    backgroundColor: C.s1,
  },
  qidCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 12, paddingHorizontal: 16,
  },
  qidSub:    { fontSize: 9, color: 'rgba(255,255,255,0.55)', letterSpacing: 2, marginBottom: 2 },
  qidName:   { fontSize: 14, fontWeight: '600', color: '#fff' },
  copyQidBtn: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 5 },
  copyQidText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  qidBody:   { padding: 12, paddingHorizontal: 16 },
  qidValue:  { fontSize: 15, fontWeight: '600', color: C.text, letterSpacing: 2 },

  selfNotesRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginBottom: 14, padding: 12, paddingHorizontal: 14,
    backgroundColor: C.s1, borderRadius: 16, borderWidth: 1, borderColor: C.borderM,
  },
  selfNotesTitle: { fontSize: 14, fontWeight: "600", color: C.text },
  selfNotesSub: { fontSize: 11, color: C.dim, marginTop: 1 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 14, marginBottom: 10,
    padding: 10, paddingHorizontal: 14,
    backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border,
  },
  searchIcon:  { fontSize: 13, color: C.dim },
  searchInput: { flex: 1, fontSize: 13, color: C.text, padding: 0 },

  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6,
  },
  sectionTitle: { fontSize: 9, fontWeight: '600', color: C.dim, letterSpacing: 1.8 },
  onlineCount:  { fontSize: 9, color: C.dim },

  row:       { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 13, paddingHorizontal: 16 },
  rowTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  nameRow:   { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1, overflow: 'hidden' },
  name:      { fontSize: 15, fontWeight: '500', color: C.text, maxWidth: 150 },
  ts:        { fontSize: 10, color: C.dim },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lastMsg:   { fontSize: 12, color: C.dim, flex: 1 },
  badge:     { backgroundColor: C.accent, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  emptyWrap: { flex: 1 },
  emptyTitle: { fontSize: 15, color: C.text, fontWeight: '500', marginBottom: 8 },
  emptyHint:  { fontSize: 13, color: C.dim, lineHeight: 22, textAlign: 'center' },
});
