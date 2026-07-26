-- ════════════════════════════════════════════════════════════════════════════
--  QUALYS — FAMILY APP · SECURITY HOTFIX
--  Run this against any Supabase project where 02_qualys_family_rls.sql was
--  already applied BEFORE this fix existed. Safe to run more than once.
--  Does NOT need 03's functions touched — this only changes one policy.
--
--  Bug: app_user_select_public allowed any authenticated user to
--  `select *` on any app_user row. RLS is row-level, not column-level, so
--  excluding email from the app_user_public view did nothing to stop a
--  direct `select email from app_user` call with any signed-in user's own
--  anon key + JWT — that policy was the actual hole, regardless of what
--  the app's own screens queried. Contradicts the "Gmail in sealed escrow,
--  never visible to users" promise made on the login/settings screens.
--
--  Fix: drop that policy. app_user_select_self (unaffected, not touched
--  here) still lets a user select their own full row. Every cross-user
--  lookup already goes through app_user_public (no email column) or the
--  get_conversations()/create_profile() functions, none of which depend on
--  the dropped policy — nothing else changes behavior.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists app_user_select_public on app_user;

-- Sanity check after running — should return ONLY:
--   app_user_select_self, app_user_insert_self, app_user_update_self
-- select policyname from pg_policies where tablename = 'app_user';
