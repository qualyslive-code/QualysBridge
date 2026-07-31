// QualysBridge — ReminderSheet
// Bottom sheet for picking a reminder date/time + recurrence, shared by
// note creation (bell icon) and long-press-to-edit on existing notes.
//
// Android has no combined "datetime" mode in the native picker, so it's
// two sequential dialogs (date, then time) merged into one Date. iOS
// supports mode="datetime" as a single inline spinner.

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { C } from '../theme';

const RECURRENCE_OPTIONS = [
  { key: null,     label: 'One-time' },
  { key: 'daily',  label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
];

const nextQuarterHour = () => {
  const d = new Date(Date.now() + 15 * 60 * 1000);
  d.setSeconds(0, 0);
  return d;
};

const fmtPick = (d) =>
  `${d.toLocaleDateString('en', { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}`;

export default function ReminderSheet({ visible, initialDate, initialRecurrence, onCancel, onConfirm, onRemove }) {
  const [date, setDate] = useState(initialDate ?? nextQuarterHour());
  const [recurrence, setRecurrence] = useState(initialRecurrence ?? null);
  const hasExisting = !!initialDate;

  const openAndroidPickers = useCallback(() => {
    DateTimePickerAndroid.open({
      value: date,
      mode: 'date',
      onChange: (ev, pickedDate) => {
        if (ev.type !== 'set' || !pickedDate) return;
        const merged = new Date(date);
        merged.setFullYear(pickedDate.getFullYear(), pickedDate.getMonth(), pickedDate.getDate());
        setDate(merged);
        DateTimePickerAndroid.open({
          value: merged,
          mode: 'time',
          onChange: (ev2, pickedTime) => {
            if (ev2.type !== 'set' || !pickedTime) return;
            const merged2 = new Date(merged);
            merged2.setHours(pickedTime.getHours(), pickedTime.getMinutes(), 0, 0);
            setDate(merged2);
          },
        });
      },
    });
  }, [date]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={rs.backdrop}>
        <View style={rs.sheet}>
          <Text style={rs.title}>{hasExisting ? 'Edit Reminder' : 'Set Reminder'}</Text>

          {Platform.OS === 'ios' ? (
            <DateTimePicker
              value={date}
              mode="datetime"
              display="spinner"
              onChange={(_, picked) => picked && setDate(picked)}
              style={{ alignSelf: 'center' }}
              textColor={C.text}
            />
          ) : (
            <TouchableOpacity style={rs.dateBtn} onPress={openAndroidPickers} activeOpacity={0.8}>
              <Text style={rs.dateBtnText}>{fmtPick(date)}</Text>
            </TouchableOpacity>
          )}

          <View style={rs.recurRow}>
            {RECURRENCE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={String(opt.key)}
                style={[rs.recurChip, recurrence === opt.key && rs.recurChipActive]}
                onPress={() => setRecurrence(opt.key)}
                activeOpacity={0.8}
              >
                <Text style={[rs.recurChipText, recurrence === opt.key && rs.recurChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={rs.actions}>
            {hasExisting && (
              <TouchableOpacity style={rs.removeBtn} onPress={onRemove} activeOpacity={0.8}>
                <Text style={rs.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={rs.cancelBtn} onPress={onCancel} activeOpacity={0.8}>
              <Text style={rs.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={rs.confirmBtn} onPress={() => onConfirm({ date, recurrence })} activeOpacity={0.85}>
              <Text style={rs.confirmBtnText}>{hasExisting ? 'Update' : 'Set'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const rs = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.s1, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 32, gap: 16,
  },
  title: { fontSize: 16, fontWeight: '600', color: C.text, textAlign: 'center' },

  dateBtn: {
    backgroundColor: C.s2, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingVertical: 16, alignItems: 'center',
  },
  dateBtnText: { fontSize: 16, color: C.text, fontWeight: '500' },

  recurRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  recurChip: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
  },
  recurChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  recurChipText: { fontSize: 13, color: C.dim, fontWeight: '500' },
  recurChipTextActive: { color: '#fff' },

  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  removeBtn: { flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: 14, backgroundColor: 'rgba(255,80,80,0.12)' },
  removeBtnText: { color: '#ff5050', fontSize: 14, fontWeight: '600' },
  cancelBtn: { flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: 14, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border },
  cancelBtnText: { color: C.dim, fontSize: 14, fontWeight: '600' },
  confirmBtn: { flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: 14, backgroundColor: C.accent },
  confirmBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
