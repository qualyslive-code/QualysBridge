# Qualys Family — Backend Wiring

This is the complete app with `src/store/DB.js` (the in-memory mock) fully
replaced by real Supabase calls. Every screen that touched `DB.` has been
patched; `DB.js` itself has been deleted.

## Setup — run in this order

1. **Run the SQL files**, in order, in the Supabase SQL editor:
   `sql/01_qualys_family_schema.sql` → `sql/02_qualys_family_rls.sql` → `sql/03_qualys_family_functions.sql`

2. **Set environment variables** (`.env`, Expo `EXPO_PUBLIC_` prefix so they
   reach the client bundle):
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```

3. **Install the new dependencies** (already added to `package.json`):
   ```
   npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill
   ```

4. **Enable Google OAuth** in Supabase Dashboard → Authentication → Providers,
   and add `qualysfamily://login-callback` as an allowed redirect URL there.

## What changed, file by file

| File | What changed |
|---|---|
| `src/store/DB.js` | **Deleted.** Nothing imports it anymore. |
| `src/lib/supabase.js` | **New.** The one shared client every screen below imports. |
| `App.js` | Real session check on launch via `onAuthStateChange` — replaces the old `step='login'` default. Returning users with an existing `app_user` row skip straight to Home. |
| `src/screens/LoginScreen.js` | Real `supabase.auth.signInWithOAuth('google')`, replacing the `setTimeout` + fake user object. |
| `src/screens/ProfileSetupScreen.js` | Calls the new `create_profile` RPC, which generates a real unique QID server-side and inserts the real `app_user` row — replacing the old client-side `uid()`/`genQID()` fakes. |
| `src/screens/HomeScreen.js` | Conversation list now comes from the new `get_conversations` RPC — replaces the 4 hardcoded `SEED_CONTACTS`. Online status reads the real `presence` table. A Realtime subscription refreshes the list when any message arrives. |
| `src/screens/ChatScreen.js` | Every `DB.` call replaced: `send_message`, `toggle_block`, `mark_conversation_read`, `report_user` RPCs; direct queries for message history, block status, and `contact_trust`. Realtime subscription for incoming messages and presence. New `set_presence` heartbeat on mount/unmount. |
| `src/screens/ModalsAndOverlays.js` | `AddContactModal`: real QID lookup against `app_user_public`, real `contact` table insert. **The "DEMO QIDs TO TRY" box has been removed** — it exposed 5 fake accounts that don't exist in the real database; keeping it would have been a real privacy problem, not a cosmetic one. `ReportModal`: calls the real `report_user` RPC. |
| `src/screens/SettingsScreen.js` | Read-receipts toggle now persists to `app_user.read_receipts_enabled`. Sign-out calls real `supabase.auth.signOut()`. |

## Known gap — Railway

The schema's own comments specify that Google sign-in should route through a
Railway service (Railway → Supabase Auth → JWT forwarded to RPCs), not the
client calling Supabase directly. No Railway service exists yet, so
`LoginScreen.js` uses Supabase's native OAuth instead, which works standalone.
If/when Railway is built, only `LoginScreen.js`'s internals need to change —
nothing downstream of it does.

## Known gap — typing indicator

`ChatScreen.js`'s `typing` state is still wired into the UI but nothing sets
it to `true` anymore (the old code faked it via `simReply()`, which only
existed to simulate a fake "them" response and has been removed entirely
now that real replies come from a real other user). A real typing indicator
would need its own Realtime broadcast channel — not built here, left inert
rather than faked.
