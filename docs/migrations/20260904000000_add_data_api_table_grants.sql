-- Explicit Data API grants. Supabase projects created after 2026-05-30 no
-- longer auto-grant table privileges in the public schema to anon,
-- authenticated, and service_role, so every PostgREST call fails with
-- 42501 "permission denied" even though the RLS policies are in place.
-- The matrix mirrors the policies: anon gets nothing (the app is login-only
-- and every policy is TO authenticated), authenticated gets the operations
-- a policy allows, service_role gets ALL for the server-side approval and
-- notification flows (BYPASSRLS does not replace GRANT). Future migrations
-- that create a table in public must add its grants here as well.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    REVOKE ALL ON public.profiles FROM anon;
    -- Profiles are written only by the signup trigger and admin RPCs, so
    -- clients only ever need to read them.
    GRANT SELECT ON public.profiles TO authenticated;
    GRANT ALL ON public.profiles TO service_role;
  END IF;

  IF to_regclass('public.persons') IS NOT NULL THEN
    REVOKE ALL ON public.persons FROM anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.persons TO authenticated;
    GRANT ALL ON public.persons TO service_role;
  END IF;

  IF to_regclass('public.person_details_private') IS NOT NULL THEN
    REVOKE ALL ON public.person_details_private FROM anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.person_details_private TO authenticated;
    GRANT ALL ON public.person_details_private TO service_role;
  END IF;

  IF to_regclass('public.relationships') IS NOT NULL THEN
    REVOKE ALL ON public.relationships FROM anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationships TO authenticated;
    GRANT ALL ON public.relationships TO service_role;
  END IF;

  IF to_regclass('public.custom_events') IS NOT NULL THEN
    REVOKE ALL ON public.custom_events FROM anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_events TO authenticated;
    GRANT ALL ON public.custom_events TO service_role;
  END IF;

  IF to_regclass('public.gallery_items') IS NOT NULL THEN
    REVOKE ALL ON public.gallery_items FROM anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.gallery_items TO authenticated;
    GRANT ALL ON public.gallery_items TO service_role;
  END IF;

  -- Server-only table: the deny-by-default RLS policy keeps clients out, but
  -- the one-time approval links read and claim rows through service_role.
  IF to_regclass('public.user_approval_requests') IS NOT NULL THEN
    REVOKE ALL ON public.user_approval_requests FROM anon, authenticated;
    GRANT ALL ON public.user_approval_requests TO service_role;
  END IF;
END;
$$;
