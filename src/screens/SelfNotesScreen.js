// QualysBridge — SelfNotesScreen
//
// "Notes to Self" — a private space to message yourself. Deliberately NOT
// built on top of `conversation`/`message` (those enforce
// conversation_not_self: CHECK (user_a_id <> user_b_id) at the DB level —
// a real safety net catching bugs where a contact lookup accidentally
// resolves to yourself, so we keep that constraint intact rather than
// weakening it). Instead this uses its own `self_note` table, scoped
// entirely by user_id with simple owner-only RLS — no participant checks,
// no blocking, no wall, no transfers (self-transfer is meaningless, and
// the table's own CHECK (type <> 'transfer') enforces that at the DB
// level too).
//
// Reminders: self_note carries reminder_at / reminder_recurrence /
// reminder_notification_id. The note's own `id` doubles as the local
// notification identifier — one row, one scheduled notification, no
// separate join table. Bell icon on the input bar sets a reminder for
// the note about to be sent; long-press on an existing bubble edits or
// clears its reminder. Delete moved to an explicit × on each bubble
// (long-press is reminder-editing territory now).
//
// Matches ChatScreen's actual current completeness level: text is fully
// real; image/video capture UI exists but — same as ChatScreen — doesn't
// yet upload to real storage (asset URLs are null placeholders). Not a
// regression, just consistent with where the rest of the app already is.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { Av, IBtn } from '../components/atoms';
import ReminderSheet from '../components/ReminderSheet';
import { supabase } from '../lib/supabase';
import { fmtDateTime } from '../utils';
import { scheduleReminderNotification, cancelReminderNotification } from '../lib/notifications';

const fmtReminderChip = (iso, recurrence) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  if (recurrence === 'daily')  return `Daily · ${time}`;
  if (recurrence === 'weekly') return `Weekly · ${d.toLocaleDateString('en', { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ` · ${time}`;
};

export default function SelfNotesScreen({ user, onBack }) {
  const [notes,   setNotes]   = useState([]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);

  // Reminder sheet state. `editingNote === 'new'` means we're attaching a
  // reminder to the note about to be sent (pendingReminder holds it until
  // send). `editingNote === <note object>` means we're editing/clearing
  // that existing note's reminder directly.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [pendingReminder, setPendingReminder] = useState(null); // { date, recurrence } | null

  const loadNotes = useCallback(async () => {
    const { data, error } = await supabase
      .from('self_note')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (error) { console.error('[SelfNotesScreen] load', error); setLoading(false); return; }
    setNotes(data ?? []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  // Realtime: new notes land immediately (matters if the same account is
  // ever open on two devices at once).
  useEffect(() => {
    const channel = supabase
      .channel(`self_note:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'self_note',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        setNotes((prev) => (prev.some((n) => n.id === payload.new.id) ? prev : [...prev, payload.new]));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.id]);

  const sendNote = async (fields) => {
    const { data, error } = await supabase
      .from('self_note')
      .insert({ user_id: user.id, ...fields })
      .select('*')
      .single();
    if (error) { console.error('[SelfNotesScreen] send', error); return { ok: false, error }; }
    // Own realtime INSERT event will also arrive — the .some() de-dupe
    // above handles the double-add harmlessly, but add it locally now too
    // so it appears instantly rather than waiting on the round-trip.
    setNotes((prev) => (prev.some((n) => n.id === data.id) ? prev : [...prev, data]));
    return { ok: true, data };
  };

  const sendText = async () => {
    const body = input.trim();
    if (!body) return;
    setInput('');
    const reminder = pendingReminder;
    setPendingReminder(null);

    const { ok, data } = await sendNote({
      type: 'text',
      body,
      reminder_at: reminder?.date?.toISOString() ?? null,
      reminder_recurrence: reminder?.recurrence ?? null,
    });
    if (!ok || !reminder) return;

    // Note's own id doubles as the notification identifier — schedule
    // after insert since we need that id.
    await scheduleReminderNotification({
      id: data.id,
      title: 'Note reminder',
      body: body.length > 80 ? body.slice(0, 77) + '…' : body,
      data: { noteId: data.id },
      date: reminder.date,
      recurrence: reminder.recurrence,
    });
    const { error } = await supabase
      .from('self_note')
      .update({ reminder_notification_id: data.id })
      .eq('id', data.id);
    if (error) console.error('[SelfNotesScreen] set reminder_notification_id', error);
    else setNotes((prev) => prev.map((n) => (n.id === data.id ? { ...n, reminder_notification_id: data.id } : n)));
  };

  const deleteNote = async (n) => {
    setNotes((prev) => prev.filter((note) => note.id !== n.id));
    if (n.reminder_notification_id) await cancelReminderNotification(n.reminder_notification_id);
    const { error } = await supabase.from('self_note').delete().eq('id', n.id).eq('user_id', user.id);
    if (error) { console.error('[SelfNotesScreen] delete', error); loadNotes(); } // reload to undo optimistic removal on failure
  };

  const openReminderForNew = () => { setEditingNote('new'); setSheetOpen(true); };
  const openReminderForNote = (n) => { setEditingNote(n); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditingNote(null); };

  const confirmReminder = async ({ date, recurrence }) => {
    if (editingNote === 'new') {
      setPendingReminder({ date, recurrence });
      closeSheet();
      return;
    }

    const n = editingNote;
    if (n.reminder_notification_id) await cancelReminderNotification(n.reminder_notification_id);
    await scheduleReminderNotification({
      id: n.id,
      title: 'Note reminder',
      body: n.body?.length > 80 ? n.body.slice(0, 77) + '…' : (n.body ?? ''),
      data: { noteId: n.id },
      date, recurrence,
    });
    const { error } = await supabase
      .from('self_note')
      .update({ reminder_at: date.toISOString(), reminder_recurrence: recurrence, reminder_notification_id: n.id })
      .eq('id', n.id);
    if (error) { console.error('[SelfNotesScreen] update reminder', error); closeSheet(); return; }
    setNotes((prev) => prev.map((note) =>
      note.id === n.id ? { ...note, reminder_at: date.toISOString(), reminder_recurrence: recurrence, reminder_notification_id: n.id } : note
    ));
    closeSheet();
  };

  const removeReminder = async () => {
    if (editingNote === 'new') {
      setPendingReminder(null);
      closeSheet();
      return;
    }

    const n = editingNote;
    if (n.reminder_notification_id) await cancelReminderNotification(n.reminder_notification_id);
    const { error } = await supabase
      .from('self_note')
      .update({ reminder_at: null, reminder_recurrence: null, reminder_notification_id: null })
      .eq('id', n.id);
    if (error) { console.error('[SelfNotesScreen] remove reminder', error); closeSheet(); return; }
    setNotes((prev) => prev.map((note) =>
      note.id === n.id ? { ...note, reminder_at: null, reminder_recurrence: null, reminder_notification_id: null } : note
    ));
    closeSheet();
  };

  const renderItem = ({ item: n }) => (
    <TouchableOpacity
      onLongPress={() => openReminderForNote(n)}
      style={ns.bubble}
      activeOpacity={0.85}
    >
      <TouchableOpacity style={ns.closeBtn} onPress={() => deleteNote(n)} hitSlop={8}>
        <Text style={ns.closeBtnText}>×</Text>
      </TouchableOpacity>
      <Text style={ns.bubbleText}>{n.body}</Text>
      {n.reminder_at && (
        <Text style={ns.reminderChip}>🔔 {fmtReminderChip(n.reminder_at, n.reminder_recurrence)}</Text>
      )}
      <Text style={ns.bubbleTs}>{fmtDateTime(new Date(n.created_at).getTime())}</Text>
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView
      style={ns.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : insets.top + 64}
    >
      <View style={[ns.header, { paddingTop: insets.top + 10 }]}>
        <IBtn icon="‹" onPress={onBack} />
        <Av name={user.displayName} color={user.color} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={ns.headerName}>Notes to Self</Text>
          <Text style={ns.headerSub}>Only visible to you</Text>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={notes}
        keyExtractor={(n) => n.id}
        renderItem={renderItem}
        contentContainerStyle={ns.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          !loading && (
            <View style={{ alignItems: 'center', padding: 52 }}>
              <Text style={{ fontSize: 36, marginBottom: 16, opacity: 0.4 }}>📝</Text>
              <Text style={ns.emptyTitle}>No notes yet</Text>
              <Text style={ns.emptyHint}>Jot something down — only you can see it.</Text>
            </View>
          )
        }
      />

      {pendingReminder && (
        <View style={ns.pendingBar}>
          <Text style={ns.pendingBarText}>🔔 Reminder set for {fmtReminderChip(pendingReminder.date.toISOString(), pendingReminder.recurrence)}</Text>
          <TouchableOpacity onPress={() => setPendingReminder(null)} hitSlop={8}>
            <Text style={ns.pendingBarClear}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[ns.inputBar, { paddingBottom: insets.bottom + 10 }]}>
        <TouchableOpacity onPress={openReminderForNew} activeOpacity={0.8} style={ns.bellBtn}>
          <Text style={{ fontSize: 18, opacity: pendingReminder ? 1 : 0.5 }}>🔔</Text>
        </TouchableOpacity>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Write a note…"
          placeholderTextColor={C.dim}
          style={ns.input}
          multiline
        />
        {input.trim() ? (
          <TouchableOpacity onPress={sendText} activeOpacity={0.85}>
            <LinearGradient colors={[C.accent, C.accentL]} style={ns.sendBtn}>
              <Text style={{ color: '#fff', fontSize: 16 }}>↑</Text>
            </LinearGradient>
          </TouchableOpacity>
        ) : null}
      </View>

      <ReminderSheet
        visible={sheetOpen}
        initialDate={
          editingNote === 'new'
            ? pendingReminder?.date ?? null
            : (editingNote?.reminder_at ? new Date(editingNote.reminder_at) : null)
        }
        initialRecurrence={
          editingNote === 'new' ? pendingReminder?.recurrence ?? null : editingNote?.reminder_recurrence ?? null
        }
        onCancel={closeSheet}
        onConfirm={confirmReminder}
        onRemove={removeReminder}
      />
    </KeyboardAvoidingView>
  );
}

const ns = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.s1,
  },
  headerName: { fontSize: 15, fontWeight: '600', color: C.text },
  headerSub:  { fontSize: 11, color: C.dim, marginTop: 1 },

  list: { padding: 14, gap: 8, flexGrow: 1 },
  bubble: {
    alignSelf: 'flex-end', maxWidth: '80%',
    backgroundColor: C.accent, borderRadius: 16, borderBottomRightRadius: 4,
    padding: 12, paddingHorizontal: 14, paddingTop: 16,
  },
  closeBtn: {
    position: 'absolute', top: -8, right: -8, width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  closeBtnText: { color: C.dim, fontSize: 14, lineHeight: 16, fontWeight: '600' },
  bubbleText: { fontSize: 14, color: '#fff', lineHeight: 20 },
  reminderChip: { fontSize: 10, color: 'rgba(255,255,255,0.85)', marginTop: 6 },
  bubbleTs:   { fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 4, textAlign: 'right' },

  emptyTitle: { fontSize: 15, color: C.text, fontWeight: '500', marginBottom: 8 },
  emptyHint:  { fontSize: 13, color: C.dim, lineHeight: 22, textAlign: 'center' },

  pendingBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: C.s2, borderTopWidth: 1, borderTopColor: C.border,
  },
  pendingBarText: { fontSize: 12, color: C.text, flex: 1 },
  pendingBarClear: { fontSize: 12, color: C.accent, fontWeight: '600', marginLeft: 10 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 14, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: C.border,
    backgroundColor: C.s1,
  },
  bellBtn: { paddingBottom: 10 },
  input: {
    flex: 1, maxHeight: 100, fontSize: 14, color: C.text,
    backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
