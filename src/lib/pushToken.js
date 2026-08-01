// src/lib/pushToken.js
// Registers this device for Expo push notifications and saves the token
// to app_user.expo_push_token, so the backend can reach a killed/socket-
// dead app with an incoming-call notification (see calls.js call-start
// handler's push fallback).
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { supabase } from './supabase';

export async function registerPushToken(userId) {
  if (!Device.isDevice) return; // push tokens don't work on simulators

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return; // user declined — silent no-op

  let token;
  try {
    const result = await Notifications.getExpoPushTokenAsync();
    token = result.data;
  } catch (err) {
    console.error('[pushToken] getExpoPushTokenAsync failed', err);
    return;
  }
  if (!token) return;

  const { error } = await supabase
    .from('app_user')
    .update({ expo_push_token: token })
    .eq('id', userId);

  if (error) console.error('[pushToken] failed to save token', error);
}
