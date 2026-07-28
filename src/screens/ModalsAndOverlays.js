// QualysBridge — Modals & Overlay Screens

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  TextInput, ScrollView, Share,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, CURRENCIES, REPORT_REASONS } from '../theme';
import { Av, Tag, PBtn, IBtn, Spin, Hr } from '../components/atoms';
import { supabase } from '../lib/supabase';
import { uid, fmtQID } from '../utils';

// ── ADD CONTACT MODAL ─────────────────────────────────────────────────────────
export function AddContactModal({ myUser, onClose, onAdd }) {
  const [qid,     setQid]     = useState('');
  const [found,   setFound]   = useState(null);
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  const lookup = async () => {
    const q = qid.replace(/\s/g, '').toUpperCase();
    if (!q.match(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
      setErr('Use format XXXX-XXXX-XXXX-XXXX'); return;
    }
    if (q === myUser.qid) { setErr("That's your own QID"); return; }
    setLoading(true); setErr('');
    // app_user_public.qid is citext (case-insensitive), and the column has
    // a unique constraint in 01_qualys_family_schema.sql, so .maybeSingle()
    // is safe — there's never more than one match.
    const { data: u, error } = await supabase
      .from('app_user_public')
      .select('id, qid, display_name, color')
      .eq('qid', q)
      .maybeSingle();
    setLoading(false);
    if (error) { console.error('[AddContactModal] lookup', error); setErr('Something went wrong — try again'); return; }
    if (!u) { setErr('No user found with this QID'); return; }
    setFound({ id: u.id, name: u.display_name, color: u.color, qid: u.qid });
  };

  const add = async () => {
    if (!found) return;
    const { error } = await supabase
      .from('contact')
      .insert({ owner_id: myUser.id, contact_id: found.id });
    if (error) {
      // contact_unique violation means it's already saved — not a real
      // failure from the user's point of view, so don't show an error for it.
      if (error.code !== '23505') { console.error('[AddContactModal] add', error); setErr('Could not add contact — try again'); return; }
    }
    // FIX: also call get_or_create_conversation so the conversation row
    // exists in the DB immediately. Without this, the contact only survived
    // via the optimistic local-state push and vanished on reload/restart
    // because HomeScreen's get_conversations() only returns rows that have
    // a conversation entry. The RPC is idempotent (returns existing id if
    // the row already exists), so calling it here is always safe.
    const { error: convErr } = await supabase.rpc(
      'get_or_create_conversation',
      { other_user_id: found.id }
    );
    if (convErr) console.error('[AddContactModal] get_or_create_conversation', convErr);
    // Pass qid through so HomeScreen can include it in the contact object
    // (needed for QID search and SendMoney QID display).
    onAdd({ id: found.id, name: found.name, color: found.color, qid: found.qid,
            unread: 0, lastMsg: 'Contact added', lastTs: Date.now(), mine: true });
    onClose();
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          activeOpacity={1}
          style={[s.sheet, { paddingBottom: insets.bottom + 28 }]}
          onPress={() => {}} // swallow press
        >
          <View style={s.handle} />
          <Text style={s.sheetTitle}>Add a contact</Text>
          <Text style={s.sheetSub}>
            Enter their exact QID. There's no search — privacy by design.
          </Text>

          <TextInput
            value={qid}
            onChangeText={(v) => { setQid(fmtQID(v)); setFound(null); setErr(''); }}
            onSubmitEditing={() => !found && lookup()}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            placeholderTextColor={C.dim}
            autoCapitalize="characters"
            returnKeyType="search"
            style={[s.qidInput, err ? s.qidInputErr : null]}
          />
          {!!err && <Text style={s.errText}>{err}</Text>}

          {found && (
            <View style={s.foundCard}>
              <Av name={found.name} color={found.color} size={46} />
              <View style={{ flex: 1 }}>
                <Text style={s.foundName}>{found.name}</Text>
                <Text style={s.foundQid}>{found.qid}</Text>
              </View>
              <Tag color={C.money}>Found</Tag>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <PBtn onPress={onClose} variant="ghost">Cancel</PBtn>
            </View>
            <View style={{ flex: 2 }}>
              {found
                ? <PBtn onPress={add}>Add {found.name.split(' ')[0]} →</PBtn>
                : <PBtn onPress={lookup} variant="ghost" disabled={loading}>
                    {loading ? 'Searching…' : 'Search →'}
                  </PBtn>
              }
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── REPORT MODAL ──────────────────────────────────────────────────────────────
export function ReportModal({ contact, myUser, onClose }) {
  const [reason,  setReason]  = useState('');
  const [done,    setDone]    = useState(false);
  const [outcome, setOutcome] = useState('');
  const insets = useSafeAreaInsets();

  const submit = async () => {
    if (!reason) return;
    const { data: r, error } = await supabase.rpc('report_user', {
      p_target_id: contact.id,
      p_reason: reason,
    });
    if (error) { console.error('[ReportModal] report_user', error); return; }
    setOutcome(r); setDone(true);
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          activeOpacity={1}
          style={[s.sheet, { paddingBottom: insets.bottom + 28 }]}
          onPress={() => {}}
        >
          <View style={s.handle} />
          {done ? (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <Text style={{ fontSize: 44, marginBottom: 16 }}>
                {outcome === 'flagged' ? '⚠️' : '📋'}
              </Text>
              <Text style={s.sheetTitle}>Report submitted</Text>
              <Text style={[s.sheetSub, { textAlign: 'center', marginBottom: 24 }]}>
                {outcome === 'already'
                  ? "You've already reported this person."
                  : 'A moderator will review it. Reports from mutual contacts carry more weight.'}
              </Text>
              <PBtn onPress={onClose} variant="ghost" full>Close</PBtn>
            </View>
          ) : (
            <>
              <Text style={s.sheetTitle}>Report {contact.name}</Text>
              <Text style={s.sheetSub}>
                Reports are weighted by relationship. Mutual contacts count for more.
              </Text>
              <View style={{ gap: 8, marginBottom: 20 }}>
                {REPORT_REASONS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setReason(r)}
                    style={[
                      s.reasonBtn,
                      reason === r && s.reasonBtnActive,
                    ]}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.reasonText, reason === r && { color: C.danger, fontWeight: '600' }]}>
                      {r}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <PBtn onPress={onClose} variant="ghost">Cancel</PBtn>
                </View>
                <View style={{ flex: 2 }}>
                  <PBtn onPress={submit} disabled={!reason} variant="danger">Submit</PBtn>
                </View>
              </View>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── SEND MONEY SCREEN ─────────────────────────────────────────────────────────
export function SendMoneyScreen({ contact, myUser, onBack, onSent }) {
  const [amount, setAmount] = useState('');
  const [note,   setNote]   = useState('');
  const [curr,   setCurr]   = useState(CURRENCIES[0]);
  const [step,   setStep]   = useState('amount'); // amount | confirm | done
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const insets = useSafeAreaInsets();
  const valid = parseFloat(amount) > 0;

  // FIX: was `setStep('done'); setTimeout(() => onSent(...), 2000);` —
  // showed the "✅ Sent" success screen on a timer regardless of whether
  // the backend call ever happened or succeeded. Now it actually waits for
  // onSent's result (ChatScreen's onMoneySent → the real send_message RPC)
  // before claiming success, and shows a real error otherwise.
  const doSend = async () => {
    setSending(true);
    setSendErr('');
    const result = await onSent(amount, curr, note);
    setSending(false);
    if (result?.ok) {
      setStep('done');
    } else {
      setSendErr(
        result?.kind === 'blocked' ? `Can't send — ${contact.name} is blocked.` :
        result?.kind === 'walled'  ? `${contact.name} hasn't replied yet.` :
        'Could not send — try again.'
      );
    }
  };

  const REVIEW_ROWS = [
    { k: 'To',       v: contact.name },
    // FIX: was contact.id (raw UUID) — display the user-facing QID instead.
    { k: 'QID',      v: contact.qid ?? contact.id,  mono: true, small: true },
    { k: 'Fee',      v: '$0.00',     success: true },
    { k: 'Currency', v: curr.code },
  ];

  return (
    <View style={[s.smContainer, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.smHeader}>
        <IBtn icon="‹" onPress={onBack} />
        <Av name={contact.name} color={contact.color} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={s.smHeaderName}>Send to {contact.name}</Text>
          {/* FIX: was contact.id (raw UUID) — display the user-facing QID. */}
          <Text style={s.smHeaderQid}>{contact.qid ?? contact.id}</Text>
        </View>
        <Tag color={C.money} size={9}>Zero fees</Tag>
      </View>

      {step === 'done' && (
        <View style={s.smDone}>
          <Text style={{ fontSize: 56, marginBottom: 20 }}>✅</Text>
          <Text style={s.smDoneAmount}>{curr.sym}{amount}</Text>
          <Text style={s.smDoneNote}>{note ? `"${note}"` : 'Sent'}</Text>
        </View>
      )}

      {step === 'confirm' && (
        <ScrollView contentContainerStyle={s.smScroll}>
          <Text style={s.smConfirmLabel}>SENDING</Text>
          <Text style={s.smConfirmAmount}>{curr.sym}{amount}</Text>
          {!!note && <Text style={s.smConfirmNote}>"{note}"</Text>}

          <View style={s.reviewCard}>
            {REVIEW_ROWS.map((r, i) => (
              <View key={r.k}>
                <View style={s.reviewRow}>
                  <Text style={s.reviewKey}>{r.k}</Text>
                  <Text style={[
                    s.reviewVal,
                    r.mono  && { fontSize: 10, letterSpacing: 0.5 },
                    r.small && { fontSize: 10 },
                    r.success && { color: C.money, fontWeight: '700' },
                  ]}>{r.v}</Text>
                </View>
                {i < REVIEW_ROWS.length - 1 && <Hr />}
              </View>
            ))}
          </View>

          <PBtn onPress={doSend} variant="money" full disabled={sending}>
            {sending ? 'Sending…' : 'Confirm →'}
          </PBtn>
          {!!sendErr && <Text style={s.errText}>{sendErr}</Text>}
          <View style={{ height: 10 }} />
          <PBtn onPress={() => setStep('amount')} variant="ghost" full disabled={sending}>Edit</PBtn>
        </ScrollView>
      )}

      {step === 'amount' && (
        <View style={s.smAmountWrap}>
          {/* Currency tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.currScroll}>
            {CURRENCIES.map((cu) => (
              <TouchableOpacity
                key={cu.code}
                onPress={() => setCurr(cu)}
                style={[s.currTab, curr.code === cu.code && s.currTabActive]}
                activeOpacity={0.8}
              >
                <Text style={[s.currText, curr.code === cu.code && s.currTextActive]}>
                  {cu.code}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Big amount */}
          <View style={s.amountCenter}>
            <Text style={s.amountLabel}>AMOUNT</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
              <Text style={s.currSym}>{curr.sym}</Text>
              <TextInput
                value={amount}
                onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
                placeholder="0"
                placeholderTextColor={C.dim}
                keyboardType="decimal-pad"
                autoFocus
                style={[s.amountInput, valid && { color: C.text }]}
              />
            </View>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="What's this for? (optional)"
              placeholderTextColor={C.dim}
              style={s.noteInput}
            />
          </View>

          <View style={[s.smFooter, { paddingBottom: insets.bottom + 16 }]}>
            <PBtn onPress={() => setStep('confirm')} disabled={!valid} variant="money" full>
              Review →
            </PBtn>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.s1, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 22, borderWidth: 1, borderColor: C.borderM,
  },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 22 },
  sheetTitle: { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.5, marginBottom: 6 },
  sheetSub:   { fontSize: 12, color: C.sub, marginBottom: 20, lineHeight: 20 },
  label:      { fontSize: 10, fontWeight: '600', color: C.dim, letterSpacing: 1.5 },
  errText:    { fontSize: 11, color: C.danger, textAlign: 'center', marginBottom: 8 },

  qidInput: {
    backgroundColor: C.s2, borderWidth: 1.5, borderColor: C.border,
    borderRadius: 14, padding: 14, paddingHorizontal: 16,
    fontSize: 16, color: C.text, textAlign: 'center', letterSpacing: 2.5,
    marginBottom: 10,
  },
  qidInputErr: { borderColor: C.danger + '55' },

  demoBox:      { backgroundColor: C.s2, borderRadius: 14, padding: 10, paddingHorizontal: 14, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  demoRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 6, borderRadius: 10 },
  demoName:     { fontSize: 13, fontWeight: '500', color: C.text },
  demoBio:      { fontSize: 9, color: C.dim },
  demoQidShort: { fontSize: 9, color: C.dim },

  foundCard: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: C.s2, borderRadius: 14, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: C.money + '28',
  },
  foundName: { fontSize: 15, fontWeight: '600', color: C.text },
  foundBio:  { fontSize: 11, color: C.sub, marginTop: 2 },
  foundQid:  { fontSize: 10, color: C.dim, marginTop: 4 },

  reasonBtn:       { padding: 12, paddingHorizontal: 16, borderRadius: 12, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border },
  reasonBtnActive: { backgroundColor: C.dangerD, borderColor: C.danger + '35' },
  reasonText:      { fontSize: 13, color: C.sub },

  // Send money
  smContainer: { flex: 1, backgroundColor: C.bg },
  smHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.s1,
  },
  smHeaderName: { fontSize: 15, fontWeight: '600', color: C.text },
  smHeaderQid:  { fontSize: 10, color: C.dim },

  smDone: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  smDoneAmount: { fontSize: 36, fontWeight: '800', color: C.money, letterSpacing: -1, marginBottom: 8 },
  smDoneNote:   { fontSize: 14, color: C.sub },

  smScroll:   { padding: 22 },
  smConfirmLabel:  { fontSize: 11, color: C.dim, letterSpacing: 1.5, textAlign: 'center', marginBottom: 10 },
  smConfirmAmount: { fontSize: 52, fontWeight: '800', color: C.text, letterSpacing: -2, textAlign: 'center', marginBottom: 4 },
  smConfirmNote:   { fontSize: 14, color: C.sub, textAlign: 'center', marginBottom: 28 },

  reviewCard: { backgroundColor: C.s1, borderRadius: 18, borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginBottom: 24 },
  reviewRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 13, paddingHorizontal: 16 },
  reviewKey:  { fontSize: 13, color: C.sub },
  reviewVal:  { fontSize: 13, fontWeight: '500', color: C.text },

  smAmountWrap: { flex: 1 },
  currScroll:   { flexGrow: 0, paddingHorizontal: 22, paddingTop: 24, marginBottom: 8 },
  currTab:      { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border, marginRight: 7 },
  currTabActive: { backgroundColor: C.money, borderColor: C.money },
  currText:      { fontSize: 12, color: C.sub },
  currTextActive: { fontSize: 12, color: '#001A12', fontWeight: '700' },

  amountCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  amountLabel:  { fontSize: 11, color: C.dim, letterSpacing: 1.5, marginBottom: 16 },
  currSym:      { fontSize: 32, fontWeight: '800', color: C.sub, marginTop: 14 },
  amountInput:  { fontSize: 68, fontWeight: '800', color: C.dim, letterSpacing: -2, minWidth: 80, textAlign: 'center' },
  noteInput:    {
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 14, padding: 10, paddingHorizontal: 16,
    fontSize: 13, color: C.text, textAlign: 'center', marginTop: 14, width: 280,
  },
  smFooter: { paddingHorizontal: 22 },
});
