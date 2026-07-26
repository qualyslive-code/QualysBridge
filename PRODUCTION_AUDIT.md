# Qualys Family — Production Audit Tracker

Tracks the full front-end/backend/DB audit and the fixes applied. Read this
alongside `README_BACKEND_WIRING.md` (the original mock→Supabase wiring
notes) — that one's about the wiring itself; this one's about what was wrong
with it and what's still wrong.

Severity key: 🔴 blocker (don't ship) · 🟠 real bug, lower stakes · 🟡 known
gap (intentional placeholder, documented, not hiding anything).

---

## ✅ Fixed — pass 1 (mock → Supabase wiring + blockers)

### 🔴 1. Google sign-in didn't do anything
`LoginScreen.js` called `supabase.auth.signInWithOAuth()` and discarded the
result. On React Native that call only returns a URL — nothing opens it.
**Fix:** added `expo-web-browser` + `expo-linking` deps; `go()` now calls
`WebBrowser.openAuthSessionAsync(data.url, redirectTo)` and hands the
result to a new shared helper, `src/lib/authSession.js`, which runs
`exchangeCodeForSession` on the returned `code`. Added a defensive
`Linking` listener + `getInitialURL()` in `App.js` as a fallback for the
case where the OS hands the redirect straight to the app instead of
through the WebBrowser session (mainly an Android edge case). Sign-in
errors now show on screen instead of failing silently.
**Files:** `package.json`, `src/lib/authSession.js` (new), `LoginScreen.js`, `App.js`.

### 🔴 2. Text messages didn't render
`ChatScreen.js`'s plain-text bubble condition was `!m.transfer && !m.type`
— `message.type` is never null on a real row (defaults to `'text'`), so
that was always `false` and the bubble never rendered for any message.
It also read `m.text` / `m.ts` / `m.selfDestruct`, none of which exist —
real columns are `body` / `created_at` / `self_destruct_option`.
**Fix:** condition is now `m.type === 'text'`; field names corrected;
timestamp converted from the DB's ISO string to epoch ms once per message
instead of feeding a string into `ago()`. Same string-vs-epoch bug existed
in the presence (`online.last`) state — fixed there too, same file.
**Files:** `ChatScreen.js`.

### 🔴 3. Email leaked through RLS
`app_user_select_public` granted `select *` on `app_user` to any
authenticated user — RLS is row-level, not column-level, so excluding
`email` from the `app_user_public` view did nothing to stop a direct
`select email from app_user` call with any signed-in user's own anon key +
JWT. Contradicted the "Gmail in sealed escrow, never visible to users"
copy on Login/Settings.
**Fix:** policy removed entirely. `app_user_select_self` is now the only
base-table SELECT policy — self-row only. All cross-user lookups already
went through `app_user_public` (no email column) or the RPCs, so nothing
else changes.
**Files:** `sql/02_qualys_family_rls.sql` (canonical fix) +
`sql/04_qualys_family_security_hotfix.sql` (new — run this one against any
Supabase project where the old `02` already shipped; idempotent, just the
one `drop policy`).

### 🔴 4. "Send Money" showed fake success
`SendMoneyScreen.doSend()` flipped to the "✅ Sent" screen on a 2-second
timer, then fired the actual `send_message` RPC afterward — the user saw
confirmation whether or not the backend call (or the network) actually
worked, and there was no error path at all.
**Fix:** `doSend()` now awaits the real result before showing success;
shows an honest error message (blocked / not-yet-replied / generic) if it
fails. `ChatScreen`'s `sendMessage`/`onMoneySent` now return `{ ok, kind,
error }` instead of being fire-and-forget. Also reworded the
"Confirmed"/"Zero fees · QID transfer" copy on the transfer card —
**no payment rail exists**, this still just logs an amount inside a chat
message; it doesn't move real money. Card now says "Recorded" / "Logged in
chat · no funds transferred."
**Files:** `ChatScreen.js`, `ModalsAndOverlays.js` (`SendMoneyScreen`),
`atoms.js` (`TCard`).

### 🔴 5. False encryption claims
"E2E encrypted," "E2E · AES-256-GCM," "Ciphertext only," and the call
overlay's "— E2E encrypted" were all false. No encryption exists anywhere
in the stack — `message.body` and `app_user.email` are plain Postgres
columns.
**Fix:** reworded all four to describe what's actually true (TLS in
transit, not encrypted at rest, email hidden by RLS not encryption).
**Files:** `LoginScreen.js`, `atoms.js`, `SettingsScreen.js`, `ChatScreen.js`.

---

## ✅ Fixed — pass 2 (remaining 🟠 bugs)

### 🟠 6. Plain chat sends failed silently
`sendText` / `sendVoice` / `sendImage` / `sendVideo` all called
`sendMessage()` fire-and-forget. `sendError` was set inside `sendMessage`
on failure but was never rendered anywhere in `ChatScreen.js` — the user
had zero indication their message didn't go through.
**Fix:** all four send functions now `await sendMessage()`. `sendText`
additionally restores the typed text into the input if the send fails, so
the user can retry without retyping. A dismissible error banner
(`sendErrorBar`) is now rendered above the input bar whenever `sendError`
is set — shows a context-aware message (blocked / walled / generic) and
clears on tap. The money-send path was already fixed in pass 1 (#4 above).
**Files:** `ChatScreen.js`.

### 🟠 7. QID search matched UUID, not QID
`HomeScreen.js`'s `filtered` memo compared `search` against `c.id` (the
raw `auth.users` UUID, e.g. `550e8400-e29b-41d4-a716-446655440000`) instead
of `c.qid` (the human-readable `XXXX-XXXX-XXXX-XXXX` string). The search
placeholder said "Search by name or QID" — searching an actual QID never
matched anything.
**Fix:** filter now checks `c.qid` (already present in the normalized
contact object from `get_conversations`'s `other_qid` column).
**Files:** `HomeScreen.js`.

### 🟠 8. SendMoney showed raw UUID under "QID" label
`SendMoneyScreen`'s header subtitle and the review card's "QID" row both
rendered `contact.id` (UUID) instead of `contact.qid`.
**Fix:** both now render `contact.qid ?? contact.id` — the fallback keeps
it non-crashing for any contact object that predates the `qid` field being
passed through.
**Files:** `ModalsAndOverlays.js`.

### 🟠 9. New contacts vanished on reload
`AddContactModal.add()` only inserted into `contact`; no `conversation`
row existed until the chat was opened (`get_or_create_conversation` runs on
`ChatScreen` mount). The contact only survived via the optimistic local
state push — on reload/restart `HomeScreen`'s `get_conversations()` found
no conversation row and returned nothing for that contact.
**Fix:** `add()` now also calls `get_or_create_conversation` immediately
after the `contact` insert. The RPC is idempotent (safe to call multiple
times). The optimistic `onAdd` call now also passes `qid` through so the
contact object is complete from the moment it appears in the list (needed
for QID search fix #7 and SendMoney fix #8 to work on freshly-added
contacts before a reload).
**Files:** `ModalsAndOverlays.js`.

---

## ⚠️ Remaining — not touched, still open

### 🟡 Known gaps (documented, intentional placeholders)
- **Railway OAuth proxy** not built — using Supabase's native OAuth
  directly instead. Only `LoginScreen.go()`'s internals change when/if it
  exists.
- **Typing indicator** wired but inert — nothing ever sets it true. Would
  need a dedicated Realtime broadcast channel.
- **Image/video send has no real picker/upload** — `image_asset_url` /
  `video_asset_url` are always `null`. RPCs are real; the picker isn't.
- **Self-destruct purge job doesn't exist** — `expires_at` gets computed
  and stored, nothing deletes the row. Needs a cron/service-role job.
- **No real payment rail** — `transfer_*` columns are a clean schema for a
  future real integration (mobile money, Stripe, etc.); right now they're
  just structured chat data.
- **No real encryption** — would need per-conversation key management,
  device key storage, and a migration path for existing plaintext columns.
  A separate, much larger project.

---

## What's solid (unchanged, still true)

Schema design, the RLS pattern (writes through security-definer functions
for anything needing cross-row checks), the SQL functions themselves
(`send_message`, `toggle_block`, `report_user`, `mark_conversation_read`,
`create_profile`, `get_or_create_conversation`, `get_conversations`), voice
message wiring, realtime subscription cleanup, and the Supabase client
setup were all already correct and aren't touched by either pass.
