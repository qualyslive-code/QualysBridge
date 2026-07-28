// src/lib/authSession.js
// QualysBridge — shared OAuth redirect handler.
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
//     qualysbridge://login-callback redirect straight to the app instead of
//     resolving through the WebBrowser session (mainly an Android edge case).
//
// FIX (silent failure, no diagnostics): the redirect can come back in two
// shapes depending on Supabase's flow — PKCE sends `?code=...` in the query
// string, but some configs/paths send tokens directly as a `#access_token=
// ...&refresh_token=...` URL fragment instead. expo-linking's Linking.parse()
// only reads the query string, never the fragment — so if Supabase used the
// fragment shape, queryParams.code was always undefined and this silently
// returned { ok: false } with no error message at all, which is exactly why
// "Sign-in failed" carried no useful detail. Now handles both shapes.
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

export async function createSessionFromUrl(url) {
  if (!url) return { ok: false, error: 'No redirect URL received' };

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

  // PKCE flow: ?code=... in the query string.
  if (queryParams?.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(queryParams.code);
    if (error) {
      console.error('[authSession] exchangeCodeForSession', error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  // Implicit flow fallback: tokens in the #fragment, which Linking.parse()
  // never populates into queryParams since it only reads the query string.
  // Parse the fragment manually.
  const hashIndex = url.indexOf('#');
  if (hashIndex !== -1) {
    const fragment = url.slice(hashIndex + 1);
    const fragParams = Object.fromEntries(new URLSearchParams(fragment));
    if (fragParams.access_token && fragParams.refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token: fragParams.access_token,
        refresh_token: fragParams.refresh_token,
      });
      if (error) {
        console.error('[authSession] setSession (fragment tokens)', error);
        return { ok: false, error: error.message };
      }
      return { ok: true };
    }
    if (fragParams.error) {
      const msg = fragParams.error_description ?? fragParams.error;
      console.error('[authSession] OAuth provider returned an error (fragment)', msg);
      return { ok: false, error: msg };
    }
  }

  // Not every URL this fires on is the OAuth callback (Linking 'url' fires
  // for any deep link into the app) — no code/tokens just means "not ours".
  console.warn('[authSession] redirect had neither code nor tokens', url);
  return { ok: false, error: 'No auth code or tokens in redirect' };
}
