BEGIN;

-- Only the server may approve; claim and activation share one transaction.
CREATE OR REPLACE FUNCTION public.approve_pending_user(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  request public.user_approval_requests%ROWTYPE;
  profile public.profiles%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  SELECT * INTO request FROM public.user_approval_requests
    WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF request.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'processed');
  END IF;
  IF request.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  SELECT * INTO profile FROM public.profiles WHERE id = request.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF NOT profile.is_active THEN
    UPDATE public.profiles SET is_active = true, updated_at = now()
      WHERE id = request.user_id;
  END IF;
  UPDATE public.user_approval_requests SET used_at = now() WHERE id = request.id;
  RETURN jsonb_build_object('status', 'approved', 'email', request.email);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_pending_user(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_pending_user(text) TO service_role;

COMMIT;
