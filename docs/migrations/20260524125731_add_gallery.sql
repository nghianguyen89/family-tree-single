-- Gallery module. Requires the base schema helpers public.is_admin() and
-- public.is_active_user(). This module is private-by-default.

CREATE TABLE IF NOT EXISTS public.gallery_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  image_url text NOT NULL,
  event_date date,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid REFERENCES auth.users (id)
);

ALTER TABLE public.gallery_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.gallery_items;

DROP POLICY IF EXISTS "Active users can view gallery" ON public.gallery_items;

CREATE POLICY "Active users can view gallery" ON public.gallery_items FOR
SELECT
  TO authenticated USING (public.is_active_user ());

DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.gallery_items;

DROP POLICY IF EXISTS "Active users can insert gallery" ON public.gallery_items;

DROP POLICY IF EXISTS "Admins can insert gallery" ON public.gallery_items;

CREATE POLICY "Admins can insert gallery" ON public.gallery_items FOR INSERT TO authenticated
WITH
  CHECK (
    public.is_admin ()
    AND auth.uid () = created_by
  );

DROP POLICY IF EXISTS "Enable update for admin and owner" ON public.gallery_items;

DROP POLICY IF EXISTS "Active users can update gallery" ON public.gallery_items;

DROP POLICY IF EXISTS "Admins can update gallery" ON public.gallery_items;

CREATE POLICY "Admins can update gallery" ON public.gallery_items
FOR UPDATE
  TO authenticated USING (public.is_admin ())
WITH
  CHECK (public.is_admin ());

DROP POLICY IF EXISTS "Enable delete for admin and owner" ON public.gallery_items;

DROP POLICY IF EXISTS "Active users can delete gallery" ON public.gallery_items;

DROP POLICY IF EXISTS "Admins can delete gallery" ON public.gallery_items;

CREATE POLICY "Admins can delete gallery" ON public.gallery_items FOR DELETE TO authenticated USING (public.is_admin ());

INSERT INTO
  storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'gallery',
    'gallery',
    FALSE,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::TEXT[]
  )
ON CONFLICT (id) DO UPDATE
SET
  public = FALSE,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::TEXT[];

DROP POLICY IF EXISTS "Public Access" ON storage.objects;

DROP POLICY IF EXISTS "Active users can view gallery files" ON storage.objects;

DROP POLICY IF EXISTS "Admins can view gallery files" ON storage.objects;

CREATE POLICY "Active users can view gallery files" ON storage.objects FOR
SELECT
  TO authenticated USING (
    bucket_id = 'gallery'
    AND public.is_active_user ()
  );

DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;

DROP POLICY IF EXISTS "Active users can upload gallery files" ON storage.objects;

DROP POLICY IF EXISTS "Admins can upload gallery files" ON storage.objects;

CREATE POLICY "Admins can upload gallery files" ON storage.objects FOR INSERT TO authenticated
WITH
  CHECK (
    bucket_id = 'gallery'
    AND public.is_admin ()
  );

DROP POLICY IF EXISTS "Admin and owner can update" ON storage.objects;

DROP POLICY IF EXISTS "Active users can update gallery files" ON storage.objects;

DROP POLICY IF EXISTS "Admins can update gallery files" ON storage.objects;

CREATE POLICY "Admins can update gallery files" ON storage.objects
FOR UPDATE
  TO authenticated USING (
    bucket_id = 'gallery'
    AND public.is_admin ()
  )
WITH
  CHECK (
    bucket_id = 'gallery'
    AND public.is_admin ()
  );

DROP POLICY IF EXISTS "Admin and owner can delete" ON storage.objects;

DROP POLICY IF EXISTS "Active users can delete gallery files" ON storage.objects;

DROP POLICY IF EXISTS "Admins can delete gallery files" ON storage.objects;

CREATE POLICY "Admins can delete gallery files" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'gallery'
  AND public.is_admin ()
);
