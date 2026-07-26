-- ════════════════════════════════════════════════════════════════════════════
--  QUALYS — FAMILY APP · ROW LEVEL SECURITY
--  Depends on 01_qualys_family_schema.sql. Run after it.
--
--  ARCHITECTURE: Railway sits in front of Supabase Auth — it handles the
--  Google sign-in flow but calls Supabase Auth to create/authenticate the
--  user, so a real auth.users row exists. For reads/writes against the
--  tables below, Railway forwards that user's Supabase session JWT (not
--  the service_role key) to Postgres, so auth.uid() resolves to the real
--  caller and the policies here are the actual enforcement layer — not a
--  backstop behind something else. Railway should only use the
--  service_role key for genuinely admin-only paths (moderation review,
--  scheduled purge jobs, account deletion), which intentionally have no
--  client-facing policy below.
--
--  Policy shape used throughout: enable RLS, then explicit per-action
--  policies for authenticated callers. No policy => no access (default-deny),
--  which is what we want — nothing here should be public.
-- ════════════════════════════════════════════════════════════════════════════

-- ── APP_USER ──────────────────────────────────────────────────────────────────
alter table app_user enable row level security;

-- A user's own row: full profile including email (app layer should still
-- avoid selecting email in normal queries, but RLS-wise self-access is fine).
create policy app_user_select_self
  on app_user for select
  using (id = auth.uid());

-- SECURITY FIX — this used to be a policy here:
--   create policy app_user_select_public on app_user for select
--     using (auth.uid() is not null);
-- RLS is row-level, not column-level. That policy let ANY authenticated
-- user run `select email from app_user where id = <anyone>` directly over
-- PostgREST with nothing but their own anon key + JWT — completely
-- bypassing the app's own code, which only ever queried the safe
-- app_user_public view (below) for other users. Excluding email from that
-- view did nothing to stop the base table from handing it out if asked
-- directly, which is exactly what was happening. Directly contradicts the
-- "Gmail in sealed escrow / never visible to users" promise made on the
-- login and settings screens.
--
-- Removed entirely. app_user_select_self above is now the only base-table
-- SELECT policy: a user can read their own full row and nothing else
-- directly. Every legitimate cross-user lookup already goes through
-- app_user_public (no email column, see below) or get_conversations() /
-- create_profile() — none of which depended on the policy that's gone.
-- If a future screen needs some OTHER public field added, add it to the
-- view's column list, not back to a table-wide policy like this one.

create policy app_user_insert_self
  on app_user for insert
  with check (id = auth.uid());

create policy app_user_update_self
  on app_user for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- No delete policy: account deletion should go through a server-side
-- function (handles cascading conversation/message cleanup deliberately),
-- not a direct client-side delete.

-- Public-safe view: what AddModal / chat headers / contact lists should
-- actually select from. Excludes email entirely so it can be exposed to
-- `authenticated` broadly without re-litigating the escrow requirement
-- inside every query.
create view app_user_public as
select id, qid, display_name, color, created_at
from app_user;

grant select on app_user_public to authenticated;


-- ── CONTACT ───────────────────────────────────────────────────────────────────
alter table contact enable row level security;

-- A user can see contact rows where they are the owner (their own saved
-- list) OR the target (needed so contact_trust can resolve "mutual" without
-- a service-role bypass — knowing someone saved you, without exposing their
-- whole contact list, is the minimum disclosure that makes trust work).
create policy contact_select_owner_or_target
  on contact for select
  using (owner_id = auth.uid() or contact_id = auth.uid());

create policy contact_insert_owner
  on contact for insert
  with check (owner_id = auth.uid());

create policy contact_delete_owner
  on contact for delete
  using (owner_id = auth.uid());

-- contact_trust view inherits the security of the underlying `contact` table
-- (Postgres views run with the privileges/RLS of the querying role by
-- default unless declared security_invoker=false), so no separate policy
-- is needed as long as it stays a plain view.


-- ── BLOCK ─────────────────────────────────────────────────────────────────────
alter table block enable row level security;

-- Blocks are intentionally one-directional and private: B should not be
-- able to discover that A blocked them (that's the whole point of a block).
-- Only the blocker can see their own block rows.
create policy block_select_blocker
  on block for select
  using (blocker_id = auth.uid());

-- No insert/delete policy: blocking goes through toggle_block() in
-- 03_qualys_family_functions.sql, which does the exists-check and
-- delete-or-insert as one atomic call instead of two client round-trips
-- (check state, then insert/delete) that could race.


-- ── REPORT ────────────────────────────────────────────────────────────────────
alter table report enable row level security;

-- Only the reporter can see their own submitted reports. Targets must never
-- see who reported them or why — that's standard moderation-integrity
-- practice and prevents retaliation. Moderators read via service role,
-- bypassing RLS entirely (not via a client-facing policy).
create policy report_select_reporter
  on report for select
  using (reporter_id = auth.uid());

-- No insert policy: reporting goes through report_user() in
-- 03_qualys_family_functions.sql, which also increments the target's
-- warning count in user_moderation and returns already/queued/flagged.
-- A raw insert here would create the report row but skip that increment.


-- ── USER_MODERATION ───────────────────────────────────────────────────────────
alter table user_moderation enable row level security;

-- Nobody should be able to read their own (or anyone's) warning count or
-- flagged status directly — that's a moderation signal, not a user-facing
-- field, and surfacing it would just teach flagged users how close they are
-- to the threshold. No select/insert/update/delete policies for any role;
-- this table is written and read exclusively via service-role/definer
-- functions (the warning-increment logic inside report_user()).


-- ── CONVERSATION ──────────────────────────────────────────────────────────────
alter table conversation enable row level security;

create policy conversation_select_participant
  on conversation for select
  using (auth.uid() in (user_a_id, user_b_id));

-- Conversations must be created via get_or_create_conversation() in
-- 03_qualys_family_functions.sql, which enforces canonical (a < b)
-- ordering and seeds participant_state atomically. No insert policy here:
-- a raw client insert could submit user_a_id/user_b_id out of order or
-- skip the participant_state seed, so insert is intentionally left to the
-- security-definer function (which runs as the function owner and is not
-- subject to this table's RLS).


-- ── CONVERSATION_PARTICIPANT_STATE ────────────────────────────────────────────
alter table conversation_participant_state enable row level security;

-- Strictly self-scoped: your unread count and destruct preference are not
-- the other participant's business, and vice versa.
create policy participant_state_select_self
  on conversation_participant_state for select
  using (user_id = auth.uid());

-- No insert/update policy: rows are seeded by get_or_create_conversation()
-- and mutated by send_message() (bumping the recipient's unread_count) and
-- mark_conversation_read() (zeroing it) — all security-definer, all in
-- 03_qualys_family_functions.sql. A direct client update could otherwise
-- zero your own unread count without having actually read anything, or
-- bump someone else's, neither of which RLS alone can distinguish from the
-- legitimate case.


-- ── MESSAGE ───────────────────────────────────────────────────────────────────
alter table message enable row level security;

-- Read access requires being a participant in the parent conversation —
-- this is the single most important policy in the file, since it's the
-- one guarding actual DM content and transfer amounts/notes.
create policy message_select_participant
  on message for select
  using (
    exists (
      select 1 from conversation c
      where c.id = conversation_id
        and auth.uid() in (c.user_a_id, c.user_b_id)
    )
  );

-- No insert policy: every message must go through send_message() in
-- 03_qualys_family_functions.sql. That function enforces the spam wall
-- (3 unanswered messages cap) and the block check before inserting — rules
-- that need to read OTHER rows (message counts, the block table) and so
-- can't be expressed in a WITH CHECK clause. A raw insert policy here,
-- even one scoped to sender_id = auth.uid(), would let a client bypass
-- both rules entirely by calling .insert() instead of the RPC.

-- No update policy either: marking messages read happens in bulk via
-- mark_conversation_read(), not a per-row client update. A real "edit my
-- own message" feature doesn't exist in the source, so no policy for it.


-- ── PRESENCE ──────────────────────────────────────────────────────────────────
alter table presence enable row level security;

-- Presence is the one thing that's intentionally broad in the source —
-- the contact list shows online dots for every saved contact, and a
-- stranger's "online now" state isn't sensitive the way message content is.
-- Any authenticated user may read; only the row owner may write their own.
create policy presence_select_any
  on presence for select
  using (auth.uid() is not null);

create policy presence_upsert_self
  on presence for insert
  with check (user_id = auth.uid());

create policy presence_update_self
  on presence for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ── CALL_LOG ──────────────────────────────────────────────────────────────────
alter table call_log enable row level security;

create policy call_log_select_participant
  on call_log for select
  using (auth.uid() in (caller_id, callee_id));

create policy call_log_insert_caller
  on call_log for insert
  with check (caller_id = auth.uid());

-- Either party can update call status (callee answers/declines, caller or
-- callee ends the call) — mirrors CallOverlay's phase transitions, which
-- either side can trigger by hanging up.
create policy call_log_update_participant
  on call_log for update
  using (auth.uid() in (caller_id, callee_id))
  with check (auth.uid() in (caller_id, callee_id));


-- ════════════════════════════════════════════════════════════════════════════
--  Tables with no client insert/update policy above (conversation, message,
--  block, report, conversation_participant_state) are written exclusively
--  through the security-definer functions in 03_qualys_family_functions.sql.
--  Run that file next — RLS alone deliberately leaves these write paths
--  closed, since the rules governing them (spam wall, block checks, warning
--  thresholds) need to read other rows and can't live in a WITH CHECK clause.
--
--  Still genuinely out of scope for any client-facing policy, by design:
--    · user_moderation — moderation signal, never exposed to users
--    · report visibility beyond the reporter — the target must not see it
--    · purge of expired self-destruct messages — scheduled job, service role
-- ════════════════════════════════════════════════════════════════════════════
