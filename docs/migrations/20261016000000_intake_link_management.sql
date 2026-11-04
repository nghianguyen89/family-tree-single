-- Shareable tokens are readable only through the existing editor RLS policy.
BEGIN;
ALTER TABLE public.family_intake_links
  ADD COLUMN IF NOT EXISTS share_token text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.family_intake_links DROP CONSTRAINT IF EXISTS intake_share_token_check;
ALTER TABLE public.family_intake_links ADD CONSTRAINT intake_share_token_check CHECK (
  share_token IS NULL OR (share_token ~ '^[0-9a-f]{64}$' AND md5(share_token) = token_hash)
);
ALTER TABLE public.family_intake_links DROP CONSTRAINT IF EXISTS intake_deleted_link_check;
ALTER TABLE public.family_intake_links ADD CONSTRAINT intake_deleted_link_check CHECK (
  deleted_at IS NULL OR NOT is_active
);
-- Keep submissions and quotas attached to the original link; never cascade delete.
GRANT UPDATE (is_active, share_token, token_hash, deleted_at) ON public.family_intake_links TO authenticated;
COMMIT;
