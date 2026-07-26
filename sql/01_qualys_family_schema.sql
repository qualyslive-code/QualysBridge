-- ════════════════════════════════════════════════════════════════════════════
--  QUALYS — FAMILY APP (Qualy-v4.jsx)
--  Schema only. No app code. Targets Supabase/Postgres.
--
--  Scope note: this is a SEPARATE product surface from "Qualys Live"
--  (the creator/streaming platform). Qualy-v4.jsx has no diamonds, coins,
--  gifting, live broadcast, Explore feed, or LiveKit — it is a QID-based
--  identity messenger with P2P transfers, a spam wall, and basic calls.
--  Nothing here assumes or depends on the Qualys Live schema.
--
--  Every table below traces back to a concrete shape in Qualy-v4.jsx:
--    Store: threads / unread / blocked / saved / online / reports / warnings
--    KNOWN lookup, genQID(), Profile screen, Settings screen,
--    SendMoney transfer object, voice/image/video message shapes,
--    DESTRUCT self-destruct timer, CallOverlay (UI-only, unmetered).
-- ════════════════════════════════════════════════════════════════════════════

-- ── EXTENSIONS ────────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive QID / email matching


-- ── ENUMS ─────────────────────────────────────────────────────────────────────

-- Mirrors message.type in pushMsg() callers: plain text has no `type` key,
-- explicit ones are "voice" | "image" | "video". "transfer" is its own
-- branch in onMoneySent() (a text message carrying a `transfer` object).
create type message_type as enum ('text', 'voice', 'image', 'video', 'transfer');

-- DESTRUCT = ["Off","30s","5m","1h","24h"] in source. "off" stored as NULL
-- duration instead of a sentinel string — see message.self_destruct_seconds.
create type destruct_option as enum ('30s', '5m', '1h', '24h');

-- DB.trust(): "mutual" | "pending" | "new" — derived from saved-contact sets,
-- not stored directly, but call_log / contact status needs the same vocabulary
-- for the "Pending — waiting for them to save your QID" UI state.
create type contact_status as enum ('new', 'pending', 'mutual');

-- Exact literal strings from REPORT_REASONS in src/theme/index.js (RN app).
-- The client sends these labels straight through with no transform, so the
-- enum values must be byte-identical to what's on screen — not a slugged
-- or reformatted version of them.
create type report_reason as enum (
  'Harassment or threats',
  'Spam or unsolicited messages',
  'Impersonation',
  'Inappropriate content',
  'Other'
);

-- DB.report(): returns "already" | "queued" | "flagged" (flagged at warnings >= 3).
create type report_outcome as enum ('queued', 'flagged');

-- CallOverlay phase state: "ringing" | "active" | "ended". No billing fields
-- anywhere in source — this is a UI-only call demo (auto-answers after 1.8s).
create type call_mode as enum ('voice', 'video');
create type call_status as enum ('ringing', 'active', 'ended', 'missed', 'declined');

create type transfer_status as enum ('sent', 'received', 'failed');


-- ── USERS ─────────────────────────────────────────────────────────────────────
-- Profile screen: { id, email (from Google), displayName, color, qid }.
-- Login screen explicitly states "Only your Gmail address is stored —
-- encrypted, for legal compliance only. Never visible to users." -> email
-- is stored but must never be exposed through any user-facing select/RLS path.
create table app_user (
  -- References auth.users(id). Railway calls Supabase Auth to authenticate
  -- the Google sign-in and creates the auth.users row; Railway then
  -- forwards that user's session JWT (not the service key) to Postgres for
  -- the calls in 03_qualys_family_functions.sql, so auth.uid() resolves
  -- correctly and the security definer functions + RLS policies in 02 are
  -- the real enforcement layer, not just a backstop.
  id              uuid primary key references auth.users(id) on delete cascade,

  -- genQID(): 4 groups of 4 chars from a 32-symbol alphabet (no I/O/0/1),
  -- formatted "XXXX-XXXX-XXXX-XXXX". Immutable once issued — identity anchor.
  qid             citext not null unique
                    constraint qid_format check (qid ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'),

  -- Google sign-in email. Sealed/escrow per the login + settings copy
  -- ("Identity: Gmail in sealed escrow", "Legal access: Court order only").
  -- Application layer must encrypt at rest and exclude from default RLS reads.
  email           citext not null unique,

  display_name    text not null
                    constraint display_name_length check (char_length(display_name) between 1 and 40),

  -- PALETTE swatch chosen on Profile screen, hex string e.g. "#5E4FE8".
  color           text not null
                    constraint color_format check (color ~ '^#[0-9A-Fa-f]{6}$'),

  -- Settings > Privacy > "Read receipts" toggle (readRx state, default true).
  read_receipts_enabled boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_app_user_qid on app_user (qid);


-- ── CONTACTS (the "saved" set + derived trust) ───────────────────────────────
-- DB.saved: Map<userId, Set<contactId>> — one row per directional save.
-- DB.trust(a,b): mutual iff both directions exist; pending iff only a→b exists.
-- AddModal flow (lookup by exact QID, no search) populates this on "Add".
create table contact (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references app_user(id) on delete cascade,
  contact_id      uuid not null references app_user(id) on delete cascade,
  created_at      timestamptz not null default now(),

  constraint contact_not_self check (owner_id <> contact_id),
  constraint contact_unique unique (owner_id, contact_id)
);

create index idx_contact_owner   on contact (owner_id);
create index idx_contact_target  on contact (contact_id);

-- Convenience view computing DB.trust() server-side instead of in two queries.
create view contact_trust as
select
  c.owner_id,
  c.contact_id,
  case
    when r.owner_id is not null then 'mutual'
    else 'pending'
  end::contact_status as status
from contact c
left join contact r
  on r.owner_id = c.contact_id and r.contact_id = c.owner_id;


-- ── BLOCKS ────────────────────────────────────────────────────────────────────
-- DB.blocked: Map<userId, Set<blockedId>>, directional, toggled from chat header.
create table block (
  id              uuid primary key default gen_random_uuid(),
  blocker_id      uuid not null references app_user(id) on delete cascade,
  blocked_id      uuid not null references app_user(id) on delete cascade,
  created_at      timestamptz not null default now(),

  constraint block_not_self check (blocker_id <> blocked_id),
  constraint block_unique unique (blocker_id, blocked_id)
);

create index idx_block_blocker on block (blocker_id);


-- ── REPORTS ───────────────────────────────────────────────────────────────────
-- DB.report(rId, tId, reason): one report per (reporter, target) pair
-- ("already" outcome on duplicate); each new unique report increments a
-- per-target warning counter; outcome flips to "flagged" once warnings >= 3.
create table report (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references app_user(id) on delete cascade,
  target_id       uuid not null references app_user(id) on delete cascade,
  reason          report_reason not null,
  created_at      timestamptz not null default now(),

  constraint report_not_self check (reporter_id <> target_id),
  constraint report_unique unique (reporter_id, target_id)
);

create index idx_report_target on report (target_id);

-- Denormalized counter mirroring DB.warnings Map<targetId, count>, plus the
-- flag derived at warnings >= 3 (REPORT_REASONS / report() threshold).
create table user_moderation (
  user_id         uuid primary key references app_user(id) on delete cascade,
  warning_count   integer not null default 0
                    constraint warning_count_nonnegative check (warning_count >= 0),
  flagged         boolean not null generated always as (warning_count >= 3) stored,
  updated_at      timestamptz not null default now()
);


-- ── CONVERSATIONS ─────────────────────────────────────────────────────────────
-- Source models a thread per (user, contact) pair keyed by the contact's id
-- (DB.threads: Map<contactId, Message[]>) rather than a shared conversation
-- row. To support both participants' independent unread counts, self-destruct
-- preference, and wall state cleanly under RLS, conversation is modeled as a
-- canonical pair with two participant-scoped state rows.
create table conversation (
  id              uuid primary key default gen_random_uuid(),
  user_a_id       uuid not null references app_user(id) on delete cascade,
  user_b_id       uuid not null references app_user(id) on delete cascade,
  created_at      timestamptz not null default now(),

  constraint conversation_not_self check (user_a_id <> user_b_id),
  -- canonical ordering avoids duplicate (a,b)/(b,a) rows
  constraint conversation_ordered check (user_a_id < user_b_id),
  constraint conversation_unique unique (user_a_id, user_b_id)
);

create index idx_conversation_a on conversation (user_a_id);
create index idx_conversation_b on conversation (user_b_id);

-- Per-participant state: unread count (DB.unread), self-destruct selector
-- (per-chat `destruct` state, options from DESTRUCT array minus "Off"),
-- and last-read marker for markRead()/read-receipt logic.
create table conversation_participant_state (
  conversation_id     uuid not null references conversation(id) on delete cascade,
  user_id              uuid not null references app_user(id) on delete cascade,
  unread_count         integer not null default 0
                         constraint unread_count_nonnegative check (unread_count >= 0),
  default_destruct     destruct_option,   -- null = "Off", the chat-level default
  last_read_at         timestamptz,
  updated_at           timestamptz not null default now(),

  primary key (conversation_id, user_id)
);


-- ── MESSAGES ──────────────────────────────────────────────────────────────────
-- One row per chat bubble. Source keeps every variant (text/voice/image/
-- video/transfer) as one object with optional fields; modeled the same way
-- here (sparse columns) rather than per-type tables, since the UI itself
-- treats them as one stream rendered by a single switch on `type`.
create table message (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references conversation(id) on delete cascade,
  sender_id           uuid not null references app_user(id) on delete cascade,
  type                message_type not null default 'text',

  -- Plain text body. For voice/image/video, source also sets a human label
  -- ("🎙️ Voice message" etc.) — kept here as the canonical body/caption text.
  body                text,

  read                boolean not null default false,

  -- voice: { duration (seconds), waveform: number[] }
  voice_duration_seconds  integer
                            constraint voice_duration_positive check (voice_duration_seconds is null or voice_duration_seconds > 0),
  voice_waveform          jsonb,            -- array of floats 0..1, e.g. [0.3,0.6,...]
  voice_asset_url         text,             -- not in mock (DEMO uses emoji/gradient); real upload target

  -- image: in source this is purely cosmetic (imgEmoji + imgGradient demo
  -- swap), so the real schema field is the uploaded asset URL.
  image_asset_url         text,

  -- video: vidEmoji/vidGradient demo + a display duration string ("0:12").
  video_asset_url         text,
  video_duration_label    text,

  -- transfer: { amount, currency, sym, note, status }. Mirrors SendMoney +
  -- onMoneySent() exactly. amount kept numeric for real money handling even
  -- though the UI treats it as a formatted string.
  transfer_amount         numeric(14,2)
                            constraint transfer_amount_positive check (transfer_amount is null or transfer_amount > 0),
  transfer_currency_code  text,             -- CURRENCIES: USD/KES/NGN/GBP/EUR
  transfer_note           text,
  transfer_status         transfer_status,

  -- Per-message self-destruct, set at send time from the active `destruct`
  -- selector (pushMsg: selfDestruct: destruct !== "Off" ? destruct : undefined).
  self_destruct_option    destruct_option,
  -- Computed expiry so a backend job (or RLS) can purge/hide instead of
  -- relying on a client-side setTimeout as the mock does.
  expires_at              timestamptz,

  created_at              timestamptz not null default now(),

  constraint message_type_fields_consistent check (
    (type = 'text'     ) or
    (type = 'voice'    and voice_duration_seconds is not null) or
    (type = 'image'    ) or
    (type = 'video'    ) or
    (type = 'transfer' and transfer_amount is not null and transfer_currency_code is not null and transfer_status is not null)
  )
);

create index idx_message_conversation_created on message (conversation_id, created_at);
create index idx_message_sender on message (sender_id);
-- supports a purge job for self-destructing messages
create index idx_message_expires_at on message (expires_at) where expires_at is not null;


-- ── PRESENCE ──────────────────────────────────────────────────────────────────
-- DB.online: Map<userId, {on: boolean, last: timestamp}>, polled every 3s
-- in Chat (setInterval(() => setOnline(DB.getOnline(cid)), 3000)).
create table presence (
  user_id         uuid primary key references app_user(id) on delete cascade,
  is_online       boolean not null default false,
  last_seen_at    timestamptz not null default now()
);


-- ── CALL LOG ──────────────────────────────────────────────────────────────────
-- CallOverlay is UI-only in source: no per-minute rate, no billing, no
-- recording — phase goes ringing -> active -> ended on a fixed timer. This
-- table is the minimal durable record of "a call happened", deliberately
-- without any monetary/rate columns since none exist in this app's source.
-- (Per-minute diamond billing belongs to the separate Qualys Live product.)
create table call_log (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversation(id) on delete cascade,
  caller_id       uuid not null references app_user(id) on delete cascade,
  callee_id       uuid not null references app_user(id) on delete cascade,
  mode            call_mode not null,
  status          call_status not null default 'ringing',
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  duration_seconds integer
                    constraint call_duration_nonnegative check (duration_seconds is null or duration_seconds >= 0),

  constraint call_not_self check (caller_id <> callee_id)
);

create index idx_call_log_conversation on call_log (conversation_id);
create index idx_call_log_caller on call_log (caller_id);
create index idx_call_log_callee on call_log (callee_id);


-- ── TRIGGERS ──────────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_app_user_updated_at
  before update on app_user
  for each row execute function set_updated_at();

create trigger trg_conversation_participant_state_updated_at
  before update on conversation_participant_state
  for each row execute function set_updated_at();

create trigger trg_user_moderation_updated_at
  before update on user_moderation
  for each row execute function set_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
--  End of schema. RLS policies intentionally omitted — schema only, per request.
-- ════════════════════════════════════════════════════════════════════════════
