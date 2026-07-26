// Qualys Family App — App.js (EAS-ready root)

import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { useFonts,
  Syne_700Bold, Syne_800ExtraBold,
} from '@expo-google-fonts/syne';
import { useFonts as useInterFonts,
  Inter_400Regular, Inter_500Medium,
  Inter_600SemiBold, Inter_700Bold,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { C } from './src/theme';
import { supabase } from './src/lib/supabase';
import { createSessionFromUrl } from './src/lib/authSession';

import LoginScreen          from './src/screens/LoginScreen';
import { ProfileSetupScreen, QIDRevealScreen } from './src/screens/ProfileSetupScreen';
import HomeScreen           from './src/screens/HomeScreen';
import ChatScreen           from './src/screens/ChatScreen';
import SettingsScreen       from './src/screens/SettingsScreen';

SplashScreen.preventAutoHideAsync();

// Maps a raw app_user row (snake_case, from the database) into exactly the
// shape every screen already expects (camelCase: displayName, qid, color,
// readReceiptsEnabled) — kept in one place so screens don't each need their
// own translation.
function toUserShape(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    color: row.color,
    qid: row.qid,
    readReceiptsEnabled: row.read_receipts_enabled,
  };
}

export default function App() {
  // 'checking' is new — covers the brief window where we have a Supabase
  // session but haven't yet confirmed whether an app_user row exists for
  // it. Source jumped straight to 'login', which assumed every app launch
  // was a fresh, unauthenticated user — not true once real sessions persist
  // across app restarts (lib/supabase.js's AsyncStorage-backed session).
  const [step,    setStep]    = useState('checking'); // checking|login|profile|reveal|home
  const [gUser,   setGUser]   = useState(null);
  const [user,    setUser]    = useState(null);
  const [chat,    setChat]    = useState(null);      // active contact
  const [settings, setSettings] = useState(false);

  const [fontsLoaded] = useFonts({ Syne_700Bold, Syne_800ExtraBold });
  const [interLoaded] = useInterFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  });

  const onLayoutRoot = useCallback(async () => {
    if (fontsLoaded && interLoaded) await SplashScreen.hideAsync();
  }, [fontsLoaded, interLoaded]);

  // ── Resolve auth state on mount, and stay in sync with it ──────────────────
  // Covers three real cases the mock App.js never had to handle:
  //   1. Cold start with a persisted session (AsyncStorage) → skip Login entirely
  //   2. LoginScreen's signInWithOAuth redirecting back in → this is what
  //      actually advances past 'login', not a direct onLogin(...) call
  //   3. SettingsScreen's real signOut() → bounce back to 'login' for real
  useEffect(() => {
    let isMounted = true;

    async function resolveSession(session) {
      if (!session?.user) {
        if (isMounted) { setUser(null); setGUser(null); setStep('login'); }
        return;
      }

      const { data: row, error } = await supabase
        .from('app_user')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!isMounted) return;

      if (error) {
        console.error('[App] app_user lookup', error);
        setStep('login');
        return;
      }

      if (row) {
        // Returning user — profile already exists, skip straight to home.
        setUser(toUserShape(row));
        setStep('home');
      } else {
        // First sign-in — has a real auth session but no app_user row yet.
        // gUser only needs .email/.name for ProfileSetupScreen's display-name
        // prefill; session.user.user_metadata carries Google's profile data.
        setGUser({
          email: session.user.email,
          name: session.user.user_metadata?.full_name ?? session.user.user_metadata?.name ?? '',
        });
        setStep('profile');
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => resolveSession(session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      resolveSession(session);
    });

    return () => { isMounted = false; subscription.unsubscribe(); };
  }, []);

  // FIX (part of #1 — auth flow was non-functional): defensive fallback
  // alongside LoginScreen's WebBrowser.openAuthSessionAsync result handling.
  // Covers the case where the OS hands the qualysfamily://login-callback
  // redirect straight to the app — cold start, or Android intercepting the
  // custom scheme outside the WebBrowser session — instead of resolving
  // through that promise. createSessionFromUrl no-ops harmlessly if the
  // code was already redeemed by the other path, so it's safe for both to
  // fire on the same URL.
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      createSessionFromUrl(url);
    });
    Linking.getInitialURL().then((url) => {
      if (url) createSessionFromUrl(url);
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded || !interLoaded || step === 'checking') return null;

  // Settings overlay
  if (settings && user) return (
    <SafeAreaProvider>
      <View style={s.root} onLayout={onLayoutRoot}>
        <SettingsScreen
          user={user}
          onBack={() => setSettings(false)}
          onLogout={() => { setSettings(false); }} // actual session teardown now happens in SettingsScreen.signOut(); onAuthStateChange drives step back to 'login'
        />
      </View>
    </SafeAreaProvider>
  );

  // Chat overlay
  if (chat && user) return (
    <SafeAreaProvider>
      <View style={s.root} onLayout={onLayoutRoot}>
        <ChatScreen
          contact={chat}
          myUser={user}
          onBack={() => setChat(null)}
        />
      </View>
    </SafeAreaProvider>
  );

  return (
    <SafeAreaProvider>
      <View style={s.root} onLayout={onLayoutRoot}>
        {step === 'login'   && (
          <LoginScreen />
        )}
        {step === 'profile' && (
          <ProfileSetupScreen
            gUser={gUser}
            onDone={(u) => { setUser(u); setStep('reveal'); }}
          />
        )}
        {step === 'reveal'  && user && (
          <QIDRevealScreen
            user={user}
            onEnter={() => setStep('home')}
          />
        )}
        {step === 'home'    && user && (
          <HomeScreen
            user={user}
            onOpenChat={(contact) => setChat(contact)}
            onOpenSettings={() => setSettings(true)}
            onLogout={() => {}} // unused now — sign-out flows through Settings' real signOut(); kept as a no-op so HomeScreen's existing prop contract doesn't need to change
          />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
});
