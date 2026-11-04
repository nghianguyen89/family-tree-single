-- INSERT ... RETURNING checks SELECT policies before a STABLE function can
-- see the new row through a second table lookup. Authorize editors directly.
BEGIN;
DROP POLICY IF EXISTS media_assets_read ON public.media_assets;
CREATE POLICY media_assets_read ON public.media_assets
FOR SELECT TO authenticated
USING (
  public.is_admin() OR public.is_editor() OR
  (public.is_active_user() AND public.can_read_media_asset(id))
);
NOTIFY pgrst, 'reload schema';
COMMIT;
