-- Run manually in Supabase SQL Editor after signing up and verifying your email.
-- Replace this placeholder with your own verified account email.
DO $$
DECLARE
  admin_email text := 'replace-with-your-verified-email@example.com';
  admin_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('family_tree_bootstrap_admin'));
  IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin' AND is_active) THEN
    RAISE EXCEPTION 'An active administrator already exists.';
  END IF;
  SELECT id INTO admin_id FROM auth.users
  WHERE lower(email) = lower(admin_email) AND email_confirmed_at IS NOT NULL;
  IF admin_id IS NULL THEN
    RAISE EXCEPTION 'The selected account must exist and have a verified email.';
  END IF;
  UPDATE public.profiles SET role = 'admin', is_active = true WHERE id = admin_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
END;
$$;
