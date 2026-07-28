-- ════════════════════════════════════════════════════════════════════════════
--  QUALYS FAMILY — E2E ENCRYPTION KEYS
--
--  Adds public_key to app_user and exposes it through app_user_public so
--  other participants in a conversation can encrypt to a user's public key.
--  The private key never touches the database — it's generated client-side
--  and stored only in expo-secure-store, keyed by app_user.id.
-- ════════════════════════════════════════════════════════════════════════════

alter table app_user
  add column if not exists public_key text;

create or replace view app_user_public as
  select id,
         qid,
         display_name,
         color,
         created_at,
         public_key
    from app_user;

grant select on app_user_public to authenticated;
