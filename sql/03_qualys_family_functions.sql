-- ════════════════════════════════════════════════════════════════════════════
--  QUALYS — FAMILY APP · FUNCTIONS / RPCs
--  Depends on 01_qualys_family_schema.sql and 02_qualys_family_rls.sql.
--  Run after both.
--
--  ARCHITECTURE: Railway calls Supabase Auth to authenticate the Google
--  sign-in, then forwards that user's session JWT (not the service_role
--  key) when calling these functions. auth.uid() therefore resolves to the
--  real caller, exactly as it would for a client talking to Supabase
--  directly — Railway is just relaying the request, not impersonating the
--  user with an admin key. That's why every function below still reads
--  auth.uid() rather than taking a p_user_id parameter: trusting a
--  caller-supplied user id would only be safe if the connection itself
--  were already privileged (service_role), which it isn't for these calls.
--
--  Why this file exists at all: RLS policies can only check the row being
--  written against static conditions (auth.uid(), a join to one parent
--  row). The business rules below all require reading OTHER rows first —
--  counting prior messages for the spam wall, checking the block table,
--  incrementing a warning counter across reports — so they have to live
--  in security definer functions, called via supabase.rpc(...) (proxied
--  through Railway) instead of a raw table insert/update.
--
--  All five map directly to a method on the in-memory `Store` class in
--  Qualy-v4.jsx:
--    get_or_create_conversation  ←→ implicit thread creation on first open
--    send_message                ←→ Store.push() + WALL/isBlocked checks
--    mark_conversation_read      ←→ Store.markRead()
--    toggle_block                ←→ Store.block() / Store.unblock()
--    report_user                 ←→ Store.report()
--
--  Every id parameter and return value is uuid, matching the schema (no
--  int/serial anywhere) and matching auth.uid()'s type.
-- ════════════════════════════════════════════════════════════════════════════


-- ── GET_OR_CREATE_CONVERSATION ───────────────────────────────────────────────
-- Source has no explicit "create conversation" step — opening a contact's
-- thread (Chat component) just keys into DB.threads by contact id, creating
-- an empty array implicitly on first read. This function is the equivalent
-- for a real schema with a canonical conversation row: find it if it
-- exists, create it (in canonical user_a_id < user_b_id order) if not.
create or replace function get_or_create_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  conv_id uuid;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  if other_user_id = me then
    raise exception 'Cannot create a conversation with yourself';
  end if;

  -- enforce the same ordering as the conversation_ordered check constraint
  if me < other_user_id then
    lo := me; hi := other_user_id;
  else
    lo := other_user_id; hi := me;
  end if;

  select id into conv_id
  from conversation
  where user_a_id = lo and user_b_id = hi;

  if conv_id is null then
    insert into conversation (user_a_id, user_b_id)
    values (lo, hi)
    returning id into conv_id;

    -- seed per-participant state rows so unread/destruct columns are never
    -- missing on first message (avoids a null-check on every read)
    insert into conversation_participant_state (conversation_id, user_id)
    values (conv_id, lo), (conv_id, hi)
    on conflict (conversation_id, user_id) do nothing;
  end if;

  return conv_id;
end;
$$;

grant execute on function get_or_create_conversation(uuid) to authenticated;


-- ── SEND_MESSAGE ──────────────────────────────────────────────────────────────
-- Mirrors pushMsg() plus the guards in sendText():
--   if (!t || blocked || walled) return;
-- WALL = 3: a "new" contact (they haven't replied yet) gets at most 3
-- outbound messages from you before being walled. DB.theyReplied()/
-- DB.sentCount()/DB.walled() are reproduced here as a single query instead
-- of three Map scans. Block check covers either direction, since either
-- party blocking the other should stop the send.
--
-- Type-specific fields are passed through as individual parameters, so one
-- function covers text/voice/image/video/transfer the same way pushMsg()
-- covers all five with one call shape in the source.
create or replace function send_message(
  p_conversation_id uuid,
  p_type message_type,
  p_body text default null,
  p_voice_duration_seconds integer default null,
  p_voice_waveform jsonb default null,
  p_voice_asset_url text default null,
  p_image_asset_url text default null,
  p_video_asset_url text default null,
  p_video_duration_label text default null,
  p_transfer_amount numeric default null,
  p_transfer_currency_code text default null,
  p_transfer_note text default null,
  p_transfer_status transfer_status default null,
  p_self_destruct_option destruct_option default null
)
returns message
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv conversation;
  other_user_id uuid;
  sent_count integer;
  they_replied boolean;
  walled boolean;
  v_expires_at timestamptz;
  new_msg message;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  select * into conv from conversation where id = p_conversation_id;
  if conv is null then
    raise exception 'Conversation not found';
  end if;
  if me not in (conv.user_a_id, conv.user_b_id) then
    raise exception 'Not a participant in this conversation';
  end if;

  other_user_id := case when conv.user_a_id = me then conv.user_b_id else conv.user_a_id end;

  -- block check, either direction — mirrors DB.isBlocked(myUser.id, cid)
  -- in Chat plus the symmetric case of the other side having blocked you
  if exists (
    select 1 from block
    where (blocker_id = me and blocked_id = other_user_id)
       or (blocker_id = other_user_id and blocked_id = me)
  ) then
    raise exception 'Cannot send message: blocked';
  end if;

  -- spam wall — DB.sentCount/theyReplied/walled reproduced as one query
  select count(*) filter (where sender_id = me),
         count(*) filter (where sender_id = other_user_id) > 0
    into sent_count, they_replied
  from message
  where conversation_id = p_conversation_id;

  walled := (not they_replied) and sent_count >= 3;
  if walled then
    raise exception 'Conversation is walled: recipient has not replied yet';
  end if;

  if p_self_destruct_option is not null then
    v_expires_at := now() + (case p_self_destruct_option
      when '30s' then interval '30 seconds'
      when '5m'  then interval '5 minutes'
      when '1h'  then interval '1 hour'
      when '24h' then interval '24 hours'
    end);
  end if;

  insert into message (
    conversation_id, sender_id, type, body,
    voice_duration_seconds, voice_waveform, voice_asset_url,
    image_asset_url,
    video_asset_url, video_duration_label,
    transfer_amount, transfer_currency_code, transfer_note, transfer_status,
    self_destruct_option, expires_at
  ) values (
    p_conversation_id, me, p_type, p_body,
    p_voice_duration_seconds, p_voice_waveform, p_voice_asset_url,
    p_image_asset_url,
    p_video_asset_url, p_video_duration_label,
    p_transfer_amount, p_transfer_currency_code, p_transfer_note, p_transfer_status,
    p_self_destruct_option, v_expires_at
  )
  returning * into new_msg;

  -- bump the recipient's unread count — DB.unread.set(cid, ...) equivalent
  insert into conversation_participant_state (conversation_id, user_id, unread_count)
  values (p_conversation_id, other_user_id, 1)
  on conflict (conversation_id, user_id)
  do update set unread_count = conversation_participant_state.unread_count + 1,
                updated_at = now();

  return new_msg;
end;
$$;

grant execute on function send_message(
  uuid, message_type, text, integer, jsonb, text, text, text, text,
  numeric, text, text, transfer_status, destruct_option
) to authenticated;


-- ── MARK_CONVERSATION_READ ────────────────────────────────────────────────────
-- Mirrors DB.markRead(cid): flips read=true on every message in the thread
-- and zeroes the caller's unread counter. Source applies this to ALL
-- messages regardless of sender; kept identical here rather than narrowing
-- to "messages not sent by me", since that's what the original does
-- (DB.threads.set(cid, msgs.map(m => ({...m, read:true})))).
create or replace function mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from conversation
    where id = p_conversation_id and me in (user_a_id, user_b_id)
  ) then
    raise exception 'Not a participant in this conversation';
  end if;

  update message
  set read = true
  where conversation_id = p_conversation_id
    and read = false;

  insert into conversation_participant_state (conversation_id, user_id, unread_count, last_read_at)
  values (p_conversation_id, me, 0, now())
  on conflict (conversation_id, user_id)
  do update set unread_count = 0,
                last_read_at = now(),
                updated_at = now();
end;
$$;

grant execute on function mark_conversation_read(uuid) to authenticated;


-- ── TOGGLE_BLOCK ──────────────────────────────────────────────────────────────
-- Mirrors the chat-header block button in source:
--   blocked ? DB.unblock(myUser.id, cid) : DB.block(myUser.id, cid)
-- One call does delete-if-exists / insert-if-not, so the client doesn't
-- need to know current state first or make two separate RPCs.
create or replace function toggle_block(p_target_id uuid)
returns boolean -- true if now blocked, false if now unblocked
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  was_blocked boolean;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;
  if p_target_id = me then
    raise exception 'Cannot block yourself';
  end if;

  select exists (
    select 1 from block where blocker_id = me and blocked_id = p_target_id
  ) into was_blocked;

  if was_blocked then
    delete from block where blocker_id = me and blocked_id = p_target_id;
    return false;
  else
    insert into block (blocker_id, blocked_id) values (me, p_target_id);
    return true;
  end if;
end;
$$;

grant execute on function toggle_block(uuid) to authenticated;


-- ── REPORT_USER ───────────────────────────────────────────────────────────────
-- Mirrors DB.report(rId, tId, reason) exactly:
--   if already reported by this reporter → return "already"
--   else insert report, increment per-target warning counter,
--        return "flagged" if warnings >= 3, else "queued"
create or replace function report_user(p_target_id uuid, p_reason report_reason)
returns text -- 'already' | 'queued' | 'flagged'
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  new_warning_count integer;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;
  if p_target_id = me then
    raise exception 'Cannot report yourself';
  end if;

  if exists (select 1 from report where reporter_id = me and target_id = p_target_id) then
    return 'already';
  end if;

  insert into report (reporter_id, target_id, reason)
  values (me, p_target_id, p_reason);

  insert into user_moderation (user_id, warning_count)
  values (p_target_id, 1)
  on conflict (user_id)
  do update set warning_count = user_moderation.warning_count + 1,
                updated_at = now()
  returning warning_count into new_warning_count;

  if new_warning_count >= 3 then
    return 'flagged';
  else
    return 'queued';
  end if;
end;
$$;

grant execute on function report_user(uuid, report_reason) to authenticated;


-- ── SET_PRESENCE ──────────────────────────────────────────────────────────────
-- Mirrors DB.getOnline(id) → { on, last } from the source, but for the write
-- side: the original mock just flipped a Map entry locally and never
-- propagated it anywhere. Here, each client calls this on app foreground /
-- background (and ideally a heartbeat every ~30-60s while foregrounded) to
-- keep its own presence row current.
--
-- Read side is NOT an RPC — it's the existing `presence` table directly,
-- since presence_select_any (02_qualys_family_rls.sql) already lets any
-- authenticated user read any row. The client just does:
--   select is_online, last_seen_at from presence where user_id = $cid
-- which is the direct equivalent of DB.getOnline(cid).
--
-- security definer isn't actually needed here (presence_upsert_self /
-- presence_update_self already allow a user to write their own row), but
-- it's kept consistent with the other functions in this file, and it means
-- the upsert logic lives in one place instead of being duplicated as a
-- raw .upsert() call scattered across every screen that needs to set it.
create or replace function set_presence(p_is_online boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  insert into presence (user_id, is_online, last_seen_at)
  values (me, p_is_online, now())
  on conflict (user_id)
  do update set is_online    = p_is_online,
                last_seen_at = now();
end;
$$;

grant execute on function set_presence(boolean) to authenticated;


-- ── GET_CONVERSATIONS ──────────────────────────────────────────────────────────
-- HomeScreen's conversation list. Source used SEED_CONTACTS (4 hardcoded
-- fake rows) — this returns the real thing: every conversation the caller
-- is a participant in, joined with the OTHER participant's public profile
-- (app_user_public — NOT app_user directly, since that view deliberately
-- excludes email per the schema's sealed-escrow design; no reason for a
-- conversation list to ever see it), the most recent message as a preview,
-- the caller's own unread_count, and walled/trust status.
--
-- walled and trust are computed here (not left for the client to call
-- DB.walled()/DB.trust() per-row, which would mean two extra round trips
-- PER CONTACT on a list screen) using the same logic send_message already
-- applies internally and the same join contact_trust already expresses.
--
-- last_message_body mirrors how HomeScreen renders c.lastMsg: transfer
-- messages show "Sent {amount}" same as ChatScreen's onMoneySent body,
-- voice/image/video show their emoji label, text shows the body itself.
-- That formatting is already baked into message.body at send_message time
-- (see 03's send_message — p_body is exactly what gets stored and is
-- exactly what the original UI displayed), so this function can just
-- return body directly with no extra type-switch logic duplicated here.
create or replace function get_conversations()
returns table (
  conversation_id    uuid,
  other_user_id      uuid,
  other_display_name text,
  other_color        text,
  other_qid          citext,
  last_message_body  text,
  last_message_at    timestamptz,
  unread_count       integer,
  walled             boolean,
  trust              contact_status
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    c.id as conversation_id,
    other.id as other_user_id,
    other.display_name as other_display_name,
    other.color as other_color,
    other.qid as other_qid,
    lm.body as last_message_body,
    lm.created_at as last_message_at,
    coalesce(cps.unread_count, 0) as unread_count,
    (
      not exists (select 1 from message where conversation_id = c.id and sender_id = other.id)
      and (select count(*) from message where conversation_id = c.id and sender_id = auth.uid()) >= 3
    ) as walled,
    coalesce(ct.status, 'new'::contact_status) as trust
  from conversation c
  join app_user_public other
    on other.id = case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end
  left join conversation_participant_state cps
    on cps.conversation_id = c.id and cps.user_id = auth.uid()
  left join contact_trust ct
    on ct.owner_id = auth.uid() and ct.contact_id = other.id
  left join lateral (
    select body, created_at
    from message
    where conversation_id = c.id
    order by created_at desc
    limit 1
  ) lm on true
  where auth.uid() in (c.user_a_id, c.user_b_id)
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- security invoker (not definer): this function does no writes and no
-- privileged lookups beyond what the caller's own RLS already permits —
-- conversation_select_participant (02) already restricts conversation
-- rows to participants, app_user_public is grant-select to all authenticated,
-- message has its own participant-only read policy, and contact_trust
-- inherits the read policy of the underlying contact table. Running as
-- invoker means RLS is enforced exactly as if the client had run the
-- joined query itself; there's no reason to elevate here.
grant execute on function get_conversations() to authenticated;


-- ── CREATE_PROFILE ────────────────────────────────────────────────────────────
-- Mirrors ProfileSetupScreen's go(): the source called local uid() for id
-- and local genQID() for qid, then handed a fully-fake object to onDone().
-- Neither can be client-generated for real — id must be the authenticated
-- user's actual auth.users.id (the app_user.id FK requires it exactly), and
-- qid uniqueness can only be safely guaranteed by retrying INSIDE a
-- transaction against the real unique constraint, not by hoping a
-- client-side random 16-char string never collides.
--
-- The alphabet below is copied verbatim from genQID() in src/utils/index.js
-- (ABCDEFGHJKLMNPQRSTUVWXYZ23456789 — deliberately excludes I/O/0/1) so
-- generated QIDs look identical in shape to what the UI already expects;
-- only WHERE they're generated changes, not the format.
create or replace function create_profile(
  p_display_name text,
  p_color text
)
returns app_user
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate_qid text;
  new_row app_user;
  i integer;
  attempt integer := 0;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from app_user where id = me) then
    raise exception 'Profile already exists for this user';
  end if;

  loop
    attempt := attempt + 1;
    if attempt > 20 then
      raise exception 'Could not generate a unique QID after 20 attempts';
    end if;

    candidate_qid := '';
    for i in 1..16 loop
      candidate_qid := candidate_qid || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      if i in (4, 8, 12) then
        candidate_qid := candidate_qid || '-';
      end if;
    end loop;

    -- citext + the unique constraint means this exists-check and the
    -- insert below are the real collision guard; the loop just retries
    -- on the rare case two attempts land on the same string.
    if not exists (select 1 from app_user where qid = candidate_qid) then
      exit;
    end if;
  end loop;

  insert into app_user (id, qid, email, display_name, color)
  values (
    me,
    candidate_qid,
    (select email from auth.users where id = me),
    p_display_name,
    p_color
  )
  returning * into new_row;

  return new_row;
end;
$$;

grant execute on function create_profile(text, text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
--  With this file, every stateful rule from Qualy-v4.jsx's Store class has
--  a server-side equivalent: schema (01) defines the shape, RLS (02) gates
--  raw table access, functions (03) implement the rules that need to read
--  other rows before deciding. Railway should call these via the user's
--  forwarded session JWT, not the service_role key — the service key
--  should be reserved for genuinely admin-only paths with no policy above
--  (moderation review, scheduled purges, account deletion).
--
--  DB.trust() has no dedicated function — contact_trust (01, the view) is
--  queried directly for 'mutual'/'pending'; zero rows returned means 'new',
--  which the client interprets itself rather than the view emitting it.
-- ════════════════════════════════════════════════════════════════════════════
