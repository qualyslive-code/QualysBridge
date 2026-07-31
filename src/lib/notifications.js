// QualysBridge — Local notification helpers (expo-notifications 56.0.22)
// Supports: one-off (exact date), daily, weekly recurrence.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission() {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

// date: JS Date for the reminder's first/only occurrence
// recurrence: null (one-off) | 'daily' | 'weekly'
export async function scheduleReminderNotification({ id, title, body, data, date, recurrence }) {
  const granted = await ensureNotificationPermission();
  if (!granted) return null;
  await ensureAndroidChannel();

  const hour = date.getHours();
  const minute = date.getMinutes();

  let trigger;
  if (recurrence === 'daily') {
    trigger = { type: 'daily', hour, minute };
  } else if (recurrence === 'weekly') {
    // Expo weekday: 1 = Sunday ... 7 = Saturday. JS getDay(): 0 = Sunday ... 6 = Saturday.
    trigger = { type: 'weekly', weekday: date.getDay() + 1, hour, minute };
  } else {
    trigger = { type: 'date', timestamp: date.getTime() };
  }

  return Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, data },
    trigger,
  });
}

export async function cancelReminderNotification(id) {
  if (!id) return;
  return Notifications.cancelScheduledNotificationAsync(id);
}
