-- Combined security and approval hardening for existing installations.
-- Run after docs/schema.sql and the feature migrations.
-- This migration is idempotent and keeps pending users out of all data.

-- 1. Member access hardening
-- Security fix: new users must be approved before they can read family data.
-- Existing active accounts are preserved as already-approved accounts. New
-- accounts are created as inactive by the trigger below.

CREATE OR REPLACE FUNCTION public.is_admin () RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user () RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_user ()
FROM
  PUBLIC;

GRANT
EXECUTE ON FUNCTION public.is_active_user () TO authenticated;

CREATE OR REPLACE FUNCTION public.is_editor () RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'editor' AND is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_editor ()
FROM
  PUBLIC;

GRANT
EXECUTE ON FUNCTION public.is_editor () TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user () RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public,
  auth AS $$
BEGIN
  INSERT INTO public.profiles (id, role, is_active)
  VALUES (
    NEW.id,
    'member'::public.user_role_enum,
    false
  );

  RETURN NEW;
END;
$$;

ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.custom_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.persons;

DROP POLICY IF EXISTS "Active users can view persons" ON public.persons;

CREATE POLICY "Active users can view persons" ON public.persons FOR
SELECT
  TO authenticated USING (public.is_active_user ());

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.relationships;

DROP POLICY IF EXISTS "Active users can view relationships" ON public.relationships;

CREATE POLICY "Active users can view relationships" ON public.relationships FOR
SELECT
  TO authenticated USING (public.is_active_user ());

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.custom_events;

DROP POLICY IF EXISTS "Active users can view custom events" ON public.custom_events;

CREATE POLICY "Active users can view custom events" ON public.custom_events FOR
SELECT
  TO authenticated USING (public.is_active_user ());

DROP POLICY IF EXISTS "Authenticated users can insert custom events" ON public.custom_events;

DROP POLICY IF EXISTS "Active users can insert custom events" ON public.custom_events;

CREATE POLICY "Active users can insert custom events" ON public.custom_events FOR INSERT TO authenticated
WITH
  CHECK (
    public.is_active_user ()
    AND auth.uid () = created_by
  );

DROP POLICY IF EXISTS "Users can update own custom events" ON public.custom_events;

DROP POLICY IF EXISTS "Active users can update own custom events" ON public.custom_events;

CREATE POLICY "Active users can update own custom events" ON public.custom_events
FOR UPDATE
  TO authenticated USING (
    public.is_active_user ()
    AND (
      auth.uid () = created_by
      OR public.is_admin ()
    )
  )
WITH
  CHECK (
    public.is_active_user ()
    AND (
      auth.uid () = created_by
      OR public.is_admin ()
    )
  );

DROP POLICY IF EXISTS "Users can delete own custom events" ON public.custom_events;

DROP POLICY IF EXISTS "Active users can delete own custom events" ON public.custom_events;

CREATE POLICY "Active users can delete own custom events" ON public.custom_events FOR DELETE TO authenticated USING (
  public.is_active_user ()
  AND (
    auth.uid () = created_by
    OR public.is_admin ()
  )
);

DO $$
BEGIN
  IF to_regclass('public.gallery_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Enable read access for all users" ON public.gallery_items;
    DROP POLICY IF EXISTS "Active users can view gallery" ON public.gallery_items;
    DROP POLICY IF EXISTS "Admins can view gallery" ON public.gallery_items;
    CREATE POLICY "Active users can view gallery"
    ON public.gallery_items FOR SELECT TO authenticated
    USING (public.is_active_user());

    DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.gallery_items;
    DROP POLICY IF EXISTS "Active users can insert gallery" ON public.gallery_items;
    DROP POLICY IF EXISTS "Admins can insert gallery" ON public.gallery_items;
    CREATE POLICY "Admins can insert gallery"
    ON public.gallery_items FOR INSERT TO authenticated
    WITH CHECK (public.is_admin() AND auth.uid() = created_by);

    DROP POLICY IF EXISTS "Enable update for admin and owner" ON public.gallery_items;
    DROP POLICY IF EXISTS "Active users can update gallery" ON public.gallery_items;
    DROP POLICY IF EXISTS "Admins can update gallery" ON public.gallery_items;
    CREATE POLICY "Admins can update gallery"
    ON public.gallery_items FOR UPDATE TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

    DROP POLICY IF EXISTS "Enable delete for admin and owner" ON public.gallery_items;
    DROP POLICY IF EXISTS "Active users can delete gallery" ON public.gallery_items;
    DROP POLICY IF EXISTS "Admins can delete gallery" ON public.gallery_items;
    CREATE POLICY "Admins can delete gallery"
    ON public.gallery_items FOR DELETE TO authenticated
    USING (public.is_admin());
  END IF;
END;
$$;

-- Gallery objects must not remain publicly readable after the table is protected.
UPDATE storage.buckets
SET
  public = FALSE,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::TEXT[]
WHERE
  id = 'gallery';

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


-- 2. User approval workflow
-- User approval workflow: newly registered users stay pending after email confirmation.
-- New accounts remain pending after email confirmation until an admin approves them.

ALTER TABLE public.profiles
ALTER COLUMN is_active
SET DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.user_approval_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE NOT NULL UNIQUE,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  notified_at timestamptz,
  used_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_approval_requests_expires_at ON public.user_approval_requests (expires_at);

ALTER TABLE public.user_approval_requests ENABLE ROW LEVEL SECURITY;

-- Keep this table inaccessible to browser clients. The server-only service-role
-- client is used by the notification and approval routes.
DROP POLICY IF EXISTS "No client access to approval requests" ON public.user_approval_requests;

CREATE OR REPLACE FUNCTION public.handle_new_user () RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public,
  auth AS $$
BEGIN
  INSERT INTO public.profiles (id, role, is_active)
  VALUES (
    NEW.id,
    'member'::public.user_role_enum,
    false
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW
EXECUTE PROCEDURE public.handle_new_user ();


-- 3. Final security hardening
-- Security hardening for existing installations.
-- Run after docs/schema.sql and the existing feature migrations.
-- This migration is idempotent and keeps pending users out of all data.

ALTER TABLE public.profiles
ALTER COLUMN is_active
SET DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.is_admin () RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true);
$$;

CREATE OR REPLACE FUNCTION public.is_active_user () RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_active = true);
$$;

CREATE OR REPLACE FUNCTION public.is_editor () RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'editor' AND is_active = true);
$$;

REVOKE ALL ON FUNCTION public.is_admin ()
FROM
  PUBLIC;

REVOKE ALL ON FUNCTION public.is_active_user ()
FROM
  PUBLIC;

REVOKE ALL ON FUNCTION public.is_editor ()
FROM
  PUBLIC;

GRANT
EXECUTE ON FUNCTION public.is_admin () TO authenticated;

GRANT
EXECUTE ON FUNCTION public.is_active_user () TO authenticated;

GRANT
EXECUTE ON FUNCTION public.is_editor () TO authenticated;

-- Harden SECURITY DEFINER admin RPCs as well; RLS does not protect tables
-- accessed from a SECURITY DEFINER function unless the function checks the
-- caller explicitly.
CREATE OR REPLACE FUNCTION public.get_admin_users () RETURNS SETOF public.admin_user_data LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public,
  auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  RETURN QUERY SELECT au.id, au.email::text, p.role, au.created_at, p.is_active
    FROM auth.users au LEFT JOIN public.profiles p ON au.id = p.id
    ORDER BY au.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_role (target_user_id uuid, new_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public,
  auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF target_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot change your own role.'; END IF;
  IF new_role::public.user_role_enum <> 'admin'::public.user_role_enum
     AND (SELECT role FROM public.profiles WHERE id = target_user_id) = 'admin'::public.user_role_enum
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active) <= 1
  THEN RAISE EXCEPTION 'Cannot remove the last active administrator.'; END IF;
  UPDATE public.profiles SET role = new_role::public.user_role_enum WHERE id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_user (target_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public,
  auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF auth.uid() = target_user_id THEN RAISE EXCEPTION 'Cannot delete yourself.'; END IF;
  IF (SELECT role FROM public.profiles WHERE id = target_user_id) = 'admin'::public.user_role_enum
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active) <= 1
  THEN RAISE EXCEPTION 'Cannot delete the last active administrator.'; END IF;
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_user (new_email text, new_password text, new_role text, new_active boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public,
  auth,
  extensions AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF length(trim(new_email)) < 3 OR position('@' IN new_email) < 2
  THEN RAISE EXCEPTION 'Invalid email.'; END IF;
  IF length(new_password) < 8 THEN RAISE EXCEPTION 'Password must be at least 8 characters.'; END IF;
  new_id := gen_random_uuid();
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, reauthentication_token, email_change,
    phone_change, phone_change_token, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    new_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    trim(new_email), extensions.crypt(new_password, extensions.gen_salt('bf')), now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );
  INSERT INTO public.profiles (id, role, is_active, created_at, updated_at)
  VALUES (new_id, new_role::public.user_role_enum, new_active, now(), now())
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, is_active = EXCLUDED.is_active;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_active_status (target_user_id uuid, new_status boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public,
  auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF target_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot change your own active status.'; END IF;
  IF new_status = false
     AND (SELECT role FROM public.profiles WHERE id = target_user_id) = 'admin'::public.user_role_enum
     AND (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active) <= 1
  THEN RAISE EXCEPTION 'Cannot deactivate the last active administrator.'; END IF;
  UPDATE public.profiles SET is_active = new_status WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_users ()
FROM
  PUBLIC;

REVOKE ALL ON FUNCTION public.set_user_role (uuid, text)
FROM
  PUBLIC;

REVOKE ALL ON FUNCTION public.delete_user (uuid)
FROM
  PUBLIC;

REVOKE ALL ON FUNCTION public.admin_create_user (text, text, text, boolean)
FROM
  PUBLIC;

REVOKE ALL ON FUNCTION public.set_user_active_status (uuid, boolean)
FROM
  PUBLIC;

GRANT
EXECUTE ON FUNCTION public.get_admin_users () TO authenticated;

GRANT
EXECUTE ON FUNCTION public.set_user_role (uuid, text) TO authenticated;

GRANT
EXECUTE ON FUNCTION public.delete_user (uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION public.admin_create_user (text, text, text, boolean) TO authenticated;

GRANT
EXECUTE ON FUNCTION public.set_user_active_status (uuid, boolean) TO authenticated;

ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.person_details_private ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.custom_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.persons;

DROP POLICY IF EXISTS "Active users can view persons" ON public.persons;

CREATE POLICY "Active users can view persons" ON public.persons FOR
SELECT
  TO authenticated USING (public.is_active_user ());

DROP POLICY IF EXISTS "Admins can manage persons" ON public.persons;

DROP POLICY IF EXISTS "Admins can insert persons" ON public.persons;

DROP POLICY IF EXISTS "Admins can update persons" ON public.persons;

DROP POLICY IF EXISTS "Admins can delete persons" ON public.persons;

DROP POLICY IF EXISTS "Admins and Editors can insert persons" ON public.persons;

DROP POLICY IF EXISTS "Admins and Editors can update persons" ON public.persons;

DROP POLICY IF EXISTS "Admins and Editors can delete persons" ON public.persons;

CREATE POLICY "Admins and Editors can insert persons" ON public.persons FOR INSERT TO authenticated
WITH
  CHECK (
    public.is_admin ()
    OR public.is_editor ()
  );

CREATE POLICY "Admins and Editors can update persons" ON public.persons
FOR UPDATE
  TO authenticated USING (
    public.is_admin ()
    OR public.is_editor ()
  )
WITH
  CHECK (
    public.is_admin ()
    OR public.is_editor ()
  );

CREATE POLICY "Admins and Editors can delete persons" ON public.persons FOR DELETE TO authenticated USING (
  public.is_admin ()
  OR public.is_editor ()
);

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.relationships;

DROP POLICY IF EXISTS "Active users can view relationships" ON public.relationships;

CREATE POLICY "Active users can view relationships" ON public.relationships FOR
SELECT
  TO authenticated USING (public.is_active_user ());

DROP POLICY IF EXISTS "Admins can manage relationships" ON public.relationships;

DROP POLICY IF EXISTS "Admins can insert relationships" ON public.relationships;

DROP POLICY IF EXISTS "Admins can update relationships" ON public.relationships;

DROP POLICY IF EXISTS "Admins can delete relationships" ON public.relationships;

DROP POLICY IF EXISTS "Admins and Editors can insert relationships" ON public.relationships;

DROP POLICY IF EXISTS "Admins and Editors can update relationships" ON public.relationships;

DROP POLICY IF EXISTS "Admins and Editors can delete relationships" ON public.relationships;

CREATE POLICY "Admins and Editors can insert relationships" ON public.relationships FOR INSERT TO authenticated
WITH
  CHECK (
    public.is_admin ()
    OR public.is_editor ()
  );

CREATE POLICY "Admins and Editors can update relationships" ON public.relationships
FOR UPDATE
  TO authenticated USING (
    public.is_admin ()
    OR public.is_editor ()
  )
WITH
  CHECK (
    public.is_admin ()
    OR public.is_editor ()
  );

CREATE POLICY "Admins and Editors can delete relationships" ON public.relationships FOR DELETE TO authenticated USING (
  public.is_admin ()
  OR public.is_editor ()
);

DROP POLICY IF EXISTS "Admins can view private details" ON public.person_details_private;

DROP POLICY IF EXISTS "Admins can manage private details" ON public.person_details_private;

CREATE POLICY "Admins can view private details" ON public.person_details_private FOR
SELECT
  TO authenticated USING (public.is_admin ());

CREATE POLICY "Admins can manage private details" ON public.person_details_private FOR ALL TO authenticated USING (public.is_admin ())
WITH
  CHECK (public.is_admin ());

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.custom_events;

DROP POLICY IF EXISTS "Active users can view custom events" ON public.custom_events;

CREATE POLICY "Active users can view custom events" ON public.custom_events FOR
SELECT
  TO authenticated USING (public.is_active_user ());

DROP POLICY IF EXISTS "Authenticated users can insert custom events" ON public.custom_events;

DROP POLICY IF EXISTS "Active users can insert custom events" ON public.custom_events;

CREATE POLICY "Active users can insert custom events" ON public.custom_events FOR INSERT TO authenticated
WITH
  CHECK (
    public.is_active_user ()
    AND auth.uid () = created_by
  );

DROP POLICY IF EXISTS "Users can update own custom events" ON public.custom_events;

DROP POLICY IF EXISTS "Active users can update own custom events" ON public.custom_events;

CREATE POLICY "Active users can update own custom events" ON public.custom_events
FOR UPDATE
  TO authenticated USING (
    public.is_active_user ()
    AND (
      auth.uid () = created_by
      OR public.is_admin ()
    )
  )
WITH
  CHECK (
    public.is_active_user ()
    AND (
      auth.uid () = created_by
      OR public.is_admin ()
    )
  );

DROP POLICY IF EXISTS "Users can delete own custom events" ON public.custom_events;

DROP POLICY IF EXISTS "Active users can delete own custom events" ON public.custom_events;

CREATE POLICY "Active users can delete own custom events" ON public.custom_events FOR DELETE TO authenticated USING (
  public.is_active_user ()
  AND (
    auth.uid () = created_by
    OR public.is_admin ()
  )
);

-- Registration never grants administrator permissions.
CREATE OR REPLACE FUNCTION public.handle_new_user () RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public,
  auth AS $$
BEGIN
  INSERT INTO public.profiles (id, role, is_active)
  VALUES (NEW.id,
    'member'::public.user_role_enum,
    false);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_first_user_confirmation () RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = auth AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- Private avatar bucket with a strict image allow-list and 2 MB limit.
INSERT INTO
  storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'avatars',
    'avatars',
    FALSE,
    2097152,
    ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::TEXT[]
  )
ON CONFLICT (id) DO UPDATE
SET
  public = FALSE,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::TEXT[];

DROP POLICY IF EXISTS "Avatar images are publicly accessible." ON storage.objects;

DROP POLICY IF EXISTS "Active users can view avatars" ON storage.objects;

CREATE POLICY "Active users can view avatars" ON storage.objects FOR
SELECT
  TO authenticated USING (
    bucket_id = 'avatars'
    AND public.is_active_user ()
  );

DROP POLICY IF EXISTS "Users can upload avatars." ON storage.objects;

DROP POLICY IF EXISTS "Admins and editors can upload avatars" ON storage.objects;

CREATE POLICY "Admins and editors can upload avatars" ON storage.objects FOR INSERT TO authenticated
WITH
  CHECK (
    bucket_id = 'avatars'
    AND (
      public.is_admin ()
      OR public.is_editor ()
    )
  );

DROP POLICY IF EXISTS "Users can update avatars." ON storage.objects;

DROP POLICY IF EXISTS "Admins and editors can update avatars" ON storage.objects;

CREATE POLICY "Admins and editors can update avatars" ON storage.objects
FOR UPDATE
  TO authenticated USING (
    bucket_id = 'avatars'
    AND (
      public.is_admin ()
      OR public.is_editor ()
    )
  )
WITH
  CHECK (
    bucket_id = 'avatars'
    AND (
      public.is_admin ()
      OR public.is_editor ()
    )
  );

DROP POLICY IF EXISTS "Users can delete avatars." ON storage.objects;

DROP POLICY IF EXISTS "Admins and editors can delete avatars" ON storage.objects;

CREATE POLICY "Admins and editors can delete avatars" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'avatars'
  AND (
    public.is_admin ()
    OR public.is_editor ()
  )
);

-- Existing gallery deployments must also lose public access and open writes.
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

