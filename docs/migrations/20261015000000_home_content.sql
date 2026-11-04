-- Editorial content is independent from the private family tree and its backups.
CREATE TABLE IF NOT EXISTS public.home_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('article','announcement','album')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 600),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 100000),
  category text NOT NULL DEFAULT 'news' CHECK (category IN ('history','family','activities','news')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('public','internal')),
  is_featured boolean NOT NULL DEFAULT false,
  publish_at timestamptz,
  expires_at timestamptz,
  event_start timestamptz,
  event_end timestamptz,
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 500),
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  CHECK (status <> 'published' OR publish_at IS NOT NULL),
  CHECK (status <> 'published' OR kind <> 'announcement' OR event_start IS NOT NULL),
  CHECK (expires_at IS NULL OR publish_at IS NULL OR expires_at > publish_at),
  CHECK (event_end IS NULL OR (event_start IS NOT NULL AND event_end >= event_start))
);
CREATE TABLE IF NOT EXISTS public.home_content_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid REFERENCES public.home_content(id),
  storage_path text NOT NULL UNIQUE CHECK (storage_path ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$'),
  alt text NOT NULL CHECK (length(btrim(alt)) BETWEEN 1 AND 300),
  caption text NOT NULL DEFAULT '' CHECK (length(caption) <= 1000),
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid()
);
CREATE TABLE IF NOT EXISTS public.home_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  title text NOT NULL DEFAULT 'Gia phả dòng họ' CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  subtitle text NOT NULL DEFAULT 'Gìn giữ cội nguồn, kết nối các thế hệ.' CHECK (length(subtitle) <= 600),
  origin text NOT NULL DEFAULT '' CHECK (length(origin) <= 300),
  introduction text NOT NULL DEFAULT '' CHECK (length(introduction) <= 20000),
  contact text NOT NULL DEFAULT '' CHECK (length(contact) <= 2000),
  cover_image_id uuid REFERENCES public.home_content_images(id) ON DELETE SET NULL,
  section_order text[] NOT NULL DEFAULT ARRAY['announcements','articles','albums'],
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  CHECK (cardinality(section_order) = 3 AND section_order @> ARRAY['announcements','articles','albums'])
);
INSERT INTO public.home_settings(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS home_content_feed_idx ON public.home_content(kind, publish_at DESC) WHERE deleted_at IS NULL AND status='published';
CREATE INDEX IF NOT EXISTS home_content_images_entry_idx ON public.home_content_images(entry_id,position,id);

CREATE OR REPLACE FUNCTION private.stamp_home_content()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'home_settings' THEN
    IF NEW.cover_image_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.home_content_images WHERE id=NEW.cover_image_id AND entry_id IS NULL) THEN
        RAISE EXCEPTION 'Cover must be a standalone editorial image.';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.revision := OLD.revision + 1;
    IF TG_TABLE_NAME = 'home_content' THEN
      NEW.created_at := OLD.created_at;
      -- Restoring always returns to draft, so it cannot accidentally re-publish.
      IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN NEW.status := 'draft'; END IF;
    END IF;
  ELSE
    NEW.revision := 1;
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  END IF;
  NEW.updated_by := auth.uid(); NEW.updated_at := now();
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.stamp_home_content() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS stamp_home_content ON public.home_content;
CREATE TRIGGER stamp_home_content BEFORE INSERT OR UPDATE ON public.home_content
  FOR EACH ROW EXECUTE FUNCTION private.stamp_home_content();
DROP TRIGGER IF EXISTS stamp_home_settings ON public.home_settings;
CREATE TRIGGER stamp_home_settings BEFORE UPDATE ON public.home_settings
  FOR EACH ROW EXECUTE FUNCTION private.stamp_home_content();

ALTER TABLE public.home_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_content_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.home_content, public.home_content_images, public.home_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.home_content, public.home_content_images, public.home_settings TO anon, authenticated;
GRANT INSERT ON public.home_content TO authenticated;
GRANT UPDATE (kind,title,summary,body,category,status,visibility,is_featured,publish_at,expires_at,event_start,event_end,location,deleted_at) ON public.home_content TO authenticated;
GRANT INSERT, DELETE ON public.home_content_images TO authenticated;
GRANT UPDATE (alt,caption,position) ON public.home_content_images TO authenticated;
GRANT UPDATE ON public.home_settings TO authenticated;

DROP POLICY IF EXISTS home_content_public_read ON public.home_content;
CREATE POLICY home_content_public_read ON public.home_content FOR SELECT TO anon, authenticated
USING (visibility='public' AND status='published' AND deleted_at IS NULL AND publish_at <= now() AND (expires_at IS NULL OR expires_at > now()));
DROP POLICY IF EXISTS home_content_internal_read ON public.home_content;
CREATE POLICY home_content_internal_read ON public.home_content FOR SELECT TO authenticated
USING (public.is_active_user() AND status='published' AND deleted_at IS NULL AND publish_at <= now() AND (expires_at IS NULL OR expires_at > now()));
DROP POLICY IF EXISTS home_content_editor_read ON public.home_content;
CREATE POLICY home_content_editor_read ON public.home_content FOR SELECT TO authenticated USING (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS home_content_editor_insert ON public.home_content;
CREATE POLICY home_content_editor_insert ON public.home_content FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS home_content_editor_update ON public.home_content;
CREATE POLICY home_content_editor_update ON public.home_content FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());

DROP POLICY IF EXISTS home_settings_read ON public.home_settings;
CREATE POLICY home_settings_read ON public.home_settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS home_settings_update ON public.home_settings;
CREATE POLICY home_settings_update ON public.home_settings FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());

DROP POLICY IF EXISTS home_images_read ON public.home_content_images;
CREATE POLICY home_images_read ON public.home_content_images FOR SELECT TO anon, authenticated USING (
  (entry_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.home_content c WHERE c.id=home_content_images.entry_id)) OR
  (entry_id IS NULL AND EXISTS (SELECT 1 FROM public.home_settings s WHERE s.cover_image_id=home_content_images.id))
);
DROP POLICY IF EXISTS home_images_editor ON public.home_content_images;
CREATE POLICY home_images_editor ON public.home_content_images FOR ALL TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());

-- A private bucket: only the image endpoint serves published assets after RLS.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('home-content','home-content',false,4194304,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS home_content_storage_editor ON storage.objects;
CREATE POLICY home_content_storage_editor ON storage.objects FOR ALL TO authenticated
USING (bucket_id='home-content' AND (public.is_admin() OR public.is_editor()))
WITH CHECK (bucket_id='home-content' AND (public.is_admin() OR public.is_editor()));
NOTIFY pgrst, 'reload schema';
