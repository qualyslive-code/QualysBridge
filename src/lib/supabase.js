// src/lib/supabase.js
// Single Supabase client for QualysBridge. Anon key only — this ships
// inside the app bundle, so it must never carry a service_role key.
// (Same pattern as Qualys Live's lib/supabase.js — these are separate
// Supabase projects for separate products, not the same backend.)
//
// Env vars (Expo convention — EXPO_PUBLIC_ prefix exposes them to the
// client bundle):
//   EXPO_PUBLIC_SUPABASE_URL
//   EXPO_PUBLIC_SUPABASE_ANON_KEY

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Check your .env file.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
