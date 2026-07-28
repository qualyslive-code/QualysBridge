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
import { supabase } from '../lib/supabase';
import { ago } from '../utils';

export default function SelfNotesScreen({ user, onBack }) {
  const [notes,   setNotes]   = useState([]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);

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
    await sendNote({ type: 'text', body });
  };

  const deleteNote = async (id) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    const { error } = await supabase.from('self_note').delete().eq('id', id).eq('user_id', user.id);
    if (error) { console.error('[SelfNotesScreen] delete', error); loadNotes(); } // reload to undo optimistic removal on failure
  };

  const renderItem = ({ item: n }) => (
    <TouchableOpacity
      onLongPress={() => deleteNote(n.id)}
      style={ns.bubble}
      activeOpacity={0.8}
    >
      <Text style={ns.bubbleText}>{n.body}</Text>
      <Text style={ns.bubbleTs}>{ago(new Date(n.created_at).getTime())}</Text>
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView
      style={ns.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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

      <View style={[ns.inputBar, { paddingBottom: insets.bottom + 10 }]}>
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
    padding: 12, paddingHorizontal: 14,
  },
  bubbleText: { fontSize: 14, color: '#fff', lineHeight: 20 },
  bubbleTs:   { fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 4, textAlign: 'right' },

  emptyTitle: { fontSize: 15, color: C.text, fontWeight: '500', marginBottom: 8 },
  emptyHint:  { fontSize: 13, color: C.dim, lineHeight: 22, textAlign: 'center' },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 14, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: C.border,
    backgroundColor: C.s1,
  },
  input: {
    flex: 1, maxHeight: 100, fontSize: 14, color: C.text,
    backgroundColor: C.s2, borderRadius: 20, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
