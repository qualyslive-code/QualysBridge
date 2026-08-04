// QualysBridge — App.js (EAS-ready root)

import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { useFonts,
  Syne_700Bold, Syne_800ExtraBold,
} from '@expo-google-fonts/syne';
import { useFonts as useInterFonts,
  Inter_400Regular, Inter_500Medium,
  Inter_600SemiBold, Inter_700Bold,
} from '@expo-google-fonts/inter';
import { useFonts as useOutfitFonts,
  Outfit_800ExtraBold,
} from '@expo-google-fonts/outfit';
import * as SplashScreen from 'expo-splash-screen';
import { C } from './src/theme';
import { supabase } from './src/lib/supabase';
import { createSessionFromUrl } from './src/lib/authSession';
import { retryEnsureKeyPair } from './src/lib/e2e';
import { registerPushToken } from './src/lib/pushToken';
import { CallProvider } from './src/lib/CallContext';
import { GroupCallProvider } from './src/lib/GroupCallContext';

import LoginScreen           from './src/screens/LoginScreen';
import { ProfileSetupScreen, QIDRevealScreen } from './src/screens/ProfileSetupScreen';
import HomeScreen            from './src/screens/HomeScreen';
import ChatScreen            from './src/screens/ChatScreen';
import SettingsScreen        from './src/screens/SettingsScreen';
import GroupCallInviteOverlay from './src/screens/GroupCallInviteOverlay';
import IncomingCallOverlay   from './src/screens/IncomingCallOverlay';
import CallScreen            from './src/screens/CallScreen';
import SelfNotesScreen       from './src/screens/SelfNotesScreen';
import BrandSplashScreen     from './src/screens/BrandSplashScreen';

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
    avatarUrl: row.avatar_url,
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
  const [selfNotes, setSelfNotes] = useState(false);
  const [showBrandSplash, setShowBrandSplash] = useState(false);
  const [fontsLoaded] = useFonts({ Syne_700Bold, Syne_800ExtraBold });
  const [interLoaded] = useInterFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  });
  const [outfitLoaded] = useOutfitFonts({ Outfit_800ExtraBold });

  useEffect(() => {
    if (step === 'home') {
      setShowBrandSplash(true);
      const t = setTimeout(() => setShowBrandSplash(false), 1400);
      return () => clearTimeout(t);
    }
  }, [step]);

  const onLayoutRoot = useCallback(async () => {
    if (fontsLoaded && interLoaded && outfitLoaded) await SplashScreen.hideAsync();
  }, [fontsLoaded, interLoaded, outfitLoaded]);

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
        retryEnsureKeyPair(session.user.id)
          .then((result) => {
            if (result?.historyLost) {
              Alert.alert(
                'Encryption keys reset',
                "Your device's secure keys were out of sync and have been regenerated. Older messages you sent from this device can no longer be decrypted here."
              );
            }
          })
          .catch((e) => console.error('[App] ensureKeyPair', e));
        registerPushToken(session.user.id).catch((e) =>
          console.error('[App] registerPushToken', e)
        );
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
  // Covers the case where the OS hands the qualysbridge://login-callback
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

  if (!fontsLoaded || !interLoaded || !outfitLoaded || step === 'checking') return null;

  // Single render path now, so CallProvider + the two call overlays only
  // ever mount once per app session regardless of which screen (settings,
  // chat, or the main login/profile/reveal/home stack) is showing —
  // previously these were three separate early-return branches, which
  // would have meant three separate CallProvider mounts (and three
  // separate /calls/signal sockets) if each had been wrapped individually.
  let content;
  if (settings && user) {
    content = (
      <SettingsScreen
        onAvatarUpdated={(avatarUrl) => setUser((prev) => ({ ...prev, avatarUrl }))}
        user={user}
        onBack={() => setSettings(false)}
        onLogout={() => { setSettings(false); }} // actual session teardown now happens in SettingsScreen.signOut(); onAuthStateChange drives step back to 'login'
      />
    );
  } else if (selfNotes && user) {
    content = (
      <SelfNotesScreen
        user={user}
        onBack={() => setSelfNotes(false)}
      />
    );
  } else if (chat && user) {
    content = (
      <ChatScreen
        contact={chat}
        myUser={user}
        onBack={() => setChat(null)}
      />
    );
  } else {
    content = (
      <>
        {step === 'login'   && (
          <LoginScreen />
        )}
        {step === 'profile' && (
          <ProfileSetupScreen
            gUser={gUser}
            onDone={(u) => { setUser(u); setStep('reveal'); }}
            onNeedLogin={() => setStep('login')}
          />
        )}
        {step === 'reveal'  && user && (
          <QIDRevealScreen
            user={user}
            onEnter={() => setStep('home')}
          />
        )}
        {step === 'home'    && user && showBrandSplash && (
          <BrandSplashScreen />
        )}
        {step === 'home'    && user && !showBrandSplash && (
          <HomeScreen
            user={user}
            onOpenChat={(contact) => setChat(contact)}
            onOpenSettings={() => setSettings(true)}
            onOpenSelfNotes={() => setSelfNotes(true)}
            onLogout={() => {}} // unused now — sign-out flows through Settings' real signOut(); kept as a no-op so HomeScreen's existing prop contract doesn't need to change
          />
        )}
      </>
    );
  }

  return (
    <SafeAreaProvider>
      <CallProvider myUser={user}>
        <GroupCallProvider myUser={user}>
          <View style={s.root} onLayout={onLayoutRoot}>
            {content}
          </View>
          <IncomingCallOverlay />
          <GroupCallInviteOverlay />
          <CallScreen />
        </GroupCallProvider>
      </CallProvider>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
});
