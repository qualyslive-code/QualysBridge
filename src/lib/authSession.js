// src/lib/authSession.js
// Qualys Family — shared OAuth redirect handler.
//
// FIX (was missing entirely): supabase.auth.signInWithOAuth() on React
// Native only returns a URL — it does not open anything by itself the way
// it does on web. Without code that (a) opens that URL in a browser and
// (b) turns the redirect it eventually sends back into a real session,
// "Continue with Google" does nothing. This file is step (b); LoginScreen
// does step (a) via expo-web-browser.
//
// Two call sites land here:
//   - LoginScreen: the direct return value of WebBrowser.openAuthSessionAsync
//   - App.js: a Linking 'url' event / Linking.getInitialURL(), as a
//     defensive fallback for the rarer case where the OS hands the
//     qualysfamily://login-callback redirect straight to the app instead of
//     resolving through the WebBrowser session (mainly an Android edge case).
// Both paths end up calling exchangeCodeForSession with the same `code`
// param, so the logic only needs to live once.
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

export async function createSessionFromUrl(url) {
  if (!url) return { ok: false };

  let queryParams;
  try {
    queryParams = Linking.parse(url).queryParams;
  } catch (err) {
    console.error('[authSession] could not parse redirect url', err);
    return { ok: false, error: 'Bad redirect URL' };
  }

  if (queryParams?.error) {
    const msg = queryParams.error_description ?? queryParams.error;
    console.error('[authSession] OAuth provider returned an error', msg);
    return { ok: false, error: msg };
  }

  if (!queryParams?.code) {
    // Not every URL this fires on is the OAuth callback (Linking 'url'
    // fires for any deep link into the app) — no code just means "not
    // ours", not a failure.
    return { ok: false };
  }

  const { error } = await supabase.auth.exchangeCodeForSession(queryParams.code);
  if (error) {
    console.error('[authSession] exchangeCodeForSession', error);
    return { ok: false, error: error.message };
  }

  // Session is now persisted via supabase.auth.onAuthStateChange, which
  // App.js already listens to — that's what actually drives navigation.
  return { ok: true };
}
