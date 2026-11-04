-- One asset per stored file; editorial images are references, not copies.
CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_bucket text NOT NULL CHECK (storage_bucket IN ('gallery','home-content','media-library')),
  storage_path text NOT NULL CHECK (length(storage_path) BETWEEN 1 AND 512 AND storage_path !~ '(^/|\.\.|:|\\)'),
  content_hash text UNIQUE CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  event_date date,
  width integer CHECK (width BETWEEN 1 AND 40000),
  height integer CHECK (height BETWEEN 1 AND 40000),
  library_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  UNIQUE(storage_bucket,storage_path)
);
ALTER TABLE public.home_content_images ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.media_assets(id) ON DELETE RESTRICT;
ALTER TABLE public.home_content_images DROP CONSTRAINT IF EXISTS home_content_images_storage_path_key;
ALTER TABLE public.home_content_images DROP CONSTRAINT IF EXISTS home_content_images_storage_path_check;

-- Preserve original paths/buckets and IDs. No storage file is moved or deleted.
INSERT INTO public.media_assets(id,storage_bucket,storage_path,title,description,event_date,library_visible,created_at,created_by)
SELECT id,'gallery',
  CASE WHEN image_url ~ '^https?://' THEN regexp_replace(image_url,'^https?://[^/]+/storage/v1/object/(public|sign|authenticated)/gallery/([^?]+).*$','\2') ELSE ltrim(image_url,'/') END,
  left(coalesce(nullif(btrim(title),''),'Image'),300),coalesce(left(description,4000),''),event_date,true,created_at,created_by
FROM public.gallery_items
WHERE image_url !~ '\.\.' AND (
  image_url ~ '^https?://[^/]+/storage/v1/object/(public|sign|authenticated)/gallery/[^?]+' OR
  (length(image_url)<=512 AND image_url ~ '^[a-zA-Z0-9][a-zA-Z0-9._/-]*$')
)
ON CONFLICT DO NOTHING;
INSERT INTO public.media_assets(id,storage_bucket,storage_path,title,description,created_at,created_by)
SELECT md5('home-content:' || id::text)::uuid,'home-content',storage_path,alt,caption,created_at,created_by
FROM public.home_content_images WHERE asset_id IS NULL ON CONFLICT DO NOTHING;
UPDATE public.home_content_images i SET asset_id=a.id
FROM public.media_assets a WHERE i.asset_id IS NULL AND a.storage_bucket='home-content' AND a.storage_path=i.storage_path;

-- Compatibility with prior clients: a legacy image insert registers its file.
CREATE OR REPLACE FUNCTION private.link_editorial_asset()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.media_assets;
BEGIN
  IF NEW.asset_id IS NULL THEN
    INSERT INTO public.media_assets(storage_bucket,storage_path,title,description,created_by)
    VALUES ('home-content',NEW.storage_path,NEW.alt,NEW.caption,auth.uid())
    ON CONFLICT(storage_bucket,storage_path) DO NOTHING;
    SELECT * INTO a FROM public.media_assets WHERE storage_bucket='home-content' AND storage_path=NEW.storage_path;
    NEW.asset_id := a.id;
  ELSE
    SELECT * INTO a FROM public.media_assets WHERE id=NEW.asset_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown media asset.'; END IF;
    NEW.storage_path := a.storage_path;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.link_editorial_asset() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS link_editorial_asset ON public.home_content_images;
CREATE TRIGGER link_editorial_asset BEFORE INSERT ON public.home_content_images FOR EACH ROW EXECUTE FUNCTION private.link_editorial_asset();
CREATE UNIQUE INDEX IF NOT EXISTS home_image_asset_entry_unique ON public.home_content_images(entry_id,asset_id) WHERE entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS home_image_asset_standalone_unique ON public.home_content_images(asset_id) WHERE entry_id IS NULL;
CREATE INDEX IF NOT EXISTS home_image_asset_idx ON public.home_content_images(asset_id);
CREATE INDEX IF NOT EXISTS media_assets_date_idx ON public.media_assets(created_at DESC,id);

-- Read permission for bytes, without exposing asset metadata to anonymous REST.
CREATE OR REPLACE FUNCTION public.can_read_media_asset(asset uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM public.media_assets a WHERE a.id=asset AND (
    public.is_admin() OR public.is_editor() OR
    (public.is_active_user() AND a.library_visible) OR
    EXISTS (SELECT 1 FROM public.home_content_images i JOIN public.home_content c ON c.id=i.entry_id
      WHERE i.asset_id=a.id AND c.deleted_at IS NULL AND c.status='published' AND c.publish_at<=now()
      AND (c.expires_at IS NULL OR c.expires_at>now()) AND (c.visibility='public' OR public.is_active_user())) OR
    EXISTS (SELECT 1 FROM public.home_settings s JOIN public.home_content_images i ON i.id=s.cover_image_id WHERE i.asset_id=a.id)
  ));
$$;
REVOKE ALL ON FUNCTION public.can_read_media_asset(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_media_asset(uuid) TO anon,authenticated;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_assets FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.media_assets TO authenticated;
GRANT ALL ON public.media_assets TO service_role;
GRANT UPDATE(title,description,event_date,library_visible) ON public.media_assets TO authenticated;
DROP POLICY IF EXISTS media_assets_read ON public.media_assets;
CREATE POLICY media_assets_read ON public.media_assets FOR SELECT TO authenticated USING (
  public.is_admin() OR public.is_editor() OR
  (public.is_active_user() AND public.can_read_media_asset(id))
);
DROP POLICY IF EXISTS media_assets_insert ON public.media_assets;
CREATE POLICY media_assets_insert ON public.media_assets FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS media_assets_update ON public.media_assets;
CREATE POLICY media_assets_update ON public.media_assets FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());

-- Deletion cannot race an attachment or remove a file used by another album.
CREATE OR REPLACE FUNCTION public.remove_media_asset(asset uuid)
RETURNS TABLE(storage_bucket text,storage_path text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.media_assets;
BEGIN
  IF NOT (public.is_admin() OR public.is_editor()) THEN RAISE EXCEPTION 'Access denied.'; END IF;
  SELECT * INTO a FROM public.media_assets WHERE id=asset FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.home_content_images i WHERE i.asset_id=a.id AND
    (i.entry_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.home_settings s WHERE s.cover_image_id=i.id))) THEN
    RAISE EXCEPTION 'Media is in use.' USING ERRCODE='23503';
  END IF;
  DELETE FROM public.home_content_images WHERE asset_id=a.id;
  DELETE FROM public.gallery_items WHERE id=a.id;
  DELETE FROM public.media_assets WHERE id=a.id;
  RETURN QUERY SELECT a.storage_bucket,a.storage_path;
END; $$;
REVOKE ALL ON FUNCTION public.remove_media_asset(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_media_asset(uuid) TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('media-library','media-library',false,4194304,ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS shared_media_editor ON storage.objects;
CREATE POLICY shared_media_editor ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='media-library' AND (public.is_admin() OR public.is_editor()));
DROP POLICY IF EXISTS shared_media_upload ON storage.objects;
CREATE POLICY shared_media_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='media-library' AND (public.is_admin() OR public.is_editor()));
DROP POLICY IF EXISTS shared_media_cleanup ON storage.objects;
CREATE POLICY shared_media_cleanup ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='media-library' AND (public.is_admin() OR public.is_editor()) AND NOT EXISTS(
  SELECT 1 FROM public.media_assets a WHERE a.storage_bucket=storage.objects.bucket_id AND a.storage_path=storage.objects.name
));
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.attach_media_asset(asset uuid,entry uuid DEFAULT NULL)
RETURNS public.home_content_images LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.media_assets; i public.home_content_images; next_position integer;
BEGIN
  IF NOT (public.is_admin() OR public.is_editor()) THEN RAISE EXCEPTION 'Access denied.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(coalesce(entry::text,'homepage-media')));
  SELECT * INTO a FROM public.media_assets WHERE id=asset FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown asset.'; END IF;
  IF entry IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.home_content WHERE id=entry AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Unknown content.'; END IF;
  SELECT * INTO i FROM public.home_content_images WHERE asset_id=asset AND entry_id IS NOT DISTINCT FROM entry;
  IF FOUND THEN RETURN i; END IF;
  IF (SELECT count(*) FROM public.home_content_images WHERE entry_id IS NOT DISTINCT FROM entry)>=100 THEN RAISE EXCEPTION 'Image limit reached.'; END IF;
  SELECT least(10000,coalesce(max(position),0)+10) INTO next_position FROM public.home_content_images WHERE entry_id IS NOT DISTINCT FROM entry;
  INSERT INTO public.home_content_images(entry_id,asset_id,storage_path,alt,caption,position,created_by)
  VALUES(entry,a.id,a.storage_path,a.title,left(a.description,1000),next_position,auth.uid()) RETURNING * INTO i;
  RETURN i;
END; $$;
REVOKE ALL ON FUNCTION public.attach_media_asset(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_media_asset(uuid,uuid) TO authenticated;
