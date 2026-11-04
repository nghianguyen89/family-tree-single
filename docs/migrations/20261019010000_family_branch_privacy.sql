-- Auxiliary branches are private to the explicitly identified couple and active admins.
BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS person_id uuid
  UNIQUE REFERENCES public.persons(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='family_branches' AND column_name='partner_person_id') THEN
    ALTER TABLE public.family_branches ADD COLUMN partner_person_id uuid
      REFERENCES public.persons(id) ON DELETE RESTRICT;
    PERFORM set_config('private.branch_partner_backfill','true',true);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION private.unique_branch_partner(p_anchor uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN count(DISTINCT p.id) = 1 THEN min(p.id::text)::uuid END
  FROM public.relationships r JOIN public.persons p
    ON p.id = CASE WHEN r.person_a = p_anchor THEN r.person_b ELSE r.person_a END
  WHERE r.type = 'marriage' AND r.family_branch_id IS NULL
    AND p_anchor IN (r.person_a,r.person_b) AND p.family_branch_id IS NULL;
$$;
CREATE OR REPLACE FUNCTION private.valid_branch_partner(p_anchor uuid,p_partner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.relationships r JOIN public.persons p ON p.id=p_partner
    WHERE p.family_branch_id IS NULL AND r.family_branch_id IS NULL AND r.type='marriage'
      AND ((r.person_a=p_anchor AND r.person_b=p_partner) OR
           (r.person_b=p_anchor AND r.person_a=p_partner)));
$$;

CREATE OR REPLACE FUNCTION private.can_view_family_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles u WHERE u.id = auth.uid() AND u.is_active AND
      (u.role = 'admin' OR EXISTS (
        SELECT 1 FROM public.family_branches b WHERE b.id = p_branch_id AND
          (u.person_id = b.anchor_person_id OR
           (u.person_id = b.partner_person_id AND EXISTS (
             SELECT 1 FROM public.relationships r JOIN public.persons p ON p.id = b.partner_person_id
             WHERE r.family_branch_id IS NULL AND r.type = 'marriage'
               AND p.family_branch_id IS NULL AND
               ((r.person_a=b.anchor_person_id AND r.person_b=b.partner_person_id) OR
                (r.person_b=b.anchor_person_id AND r.person_a=b.partner_person_id))
           )))
      ))
  );
$$;
CREATE OR REPLACE FUNCTION public.can_view_family_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.can_view_family_branch(p_branch_id);
$$;
CREATE OR REPLACE FUNCTION private.can_view_person(p_person_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles u WHERE u.id=auth.uid() AND u.is_active)
    AND EXISTS (SELECT 1 FROM public.persons p WHERE p.id=p_person_id AND
      (p.family_branch_id IS NULL OR private.can_view_family_branch(p.family_branch_id) OR
       EXISTS (SELECT 1 FROM public.family_branch_members m WHERE m.person_id=p.id
               AND private.can_view_family_branch(m.branch_id))));
$$;
CREATE OR REPLACE FUNCTION public.can_view_person(p_person_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.can_view_person(p_person_id);
$$;

CREATE OR REPLACE FUNCTION private.guard_profile_person()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.person_id IS DISTINCT FROM OLD.person_id
     AND current_user IN ('authenticated','anon') AND NOT public.is_admin()
  THEN RAISE EXCEPTION 'Only active admins may assign account identities.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_profile_person ON public.profiles;
CREATE TRIGGER tr_guard_profile_person BEFORE UPDATE OF person_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.guard_profile_person();
-- The anchor invariant must also see branches hidden from an unrelated editor.
ALTER FUNCTION private.guard_person_branch_owner() SECURITY DEFINER;
CREATE OR REPLACE FUNCTION private.set_user_person(p_user_id uuid,p_person_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  UPDATE public.profiles SET person_id=p_person_id WHERE id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account does not exist.'; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.set_user_person(p_user_id uuid,p_person_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.set_user_person(p_user_id,p_person_id);
$$;

CREATE OR REPLACE FUNCTION private.guard_branch_partner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE derived uuid;
BEGIN
  IF TG_OP='INSERT' THEN
    derived := private.unique_branch_partner(NEW.anchor_person_id);
    IF NOT public.is_admin() AND auth.uid() IS NOT NULL AND
       NEW.partner_person_id IS NOT NULL AND NEW.partner_person_id IS DISTINCT FROM derived
    THEN RAISE EXCEPTION 'Only admins may choose the authorized spouse.'; END IF;
    IF NEW.partner_person_id IS NULL THEN NEW.partner_person_id := derived; END IF;
  ELSIF NEW.partner_person_id IS DISTINCT FROM OLD.partner_person_id
        AND auth.uid() IS NOT NULL AND NOT public.is_admin()
        AND NOT (NEW.partner_person_id IS NULL AND
          NOT private.valid_branch_partner(OLD.anchor_person_id,OLD.partner_person_id)) THEN
    RAISE EXCEPTION 'Only admins may choose the authorized spouse.';
  END IF;
  IF NEW.partner_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.relationships r JOIN public.persons p ON p.id=NEW.partner_person_id
    WHERE p.family_branch_id IS NULL AND r.family_branch_id IS NULL AND r.type='marriage'
      AND ((r.person_a=NEW.anchor_person_id AND r.person_b=NEW.partner_person_id) OR
           (r.person_b=NEW.anchor_person_id AND r.person_a=NEW.partner_person_id))
  ) THEN RAISE EXCEPTION 'Authorized spouse must have a main-lineage marriage to the anchor.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_branch_partner ON public.family_branches;
CREATE TRIGGER tr_guard_branch_partner BEFORE INSERT OR UPDATE OF partner_person_id
ON public.family_branches FOR EACH ROW EXECUTE FUNCTION private.guard_branch_partner();
CREATE OR REPLACE FUNCTION private.clear_revoked_branch_partners()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.type='marriage' AND OLD.family_branch_id IS NULL THEN
    UPDATE public.family_branches b SET partner_person_id=NULL
    WHERE b.anchor_person_id IN (OLD.person_a,OLD.person_b)
      AND b.partner_person_id IN (OLD.person_a,OLD.person_b)
      AND NOT private.valid_branch_partner(b.anchor_person_id,b.partner_person_id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS tr_clear_revoked_branch_partners ON public.relationships;
CREATE TRIGGER tr_clear_revoked_branch_partners AFTER DELETE OR UPDATE OF type,person_a,person_b,family_branch_id
ON public.relationships FOR EACH ROW EXECUTE FUNCTION private.clear_revoked_branch_partners();
-- Idempotent backfill; ambiguity deliberately leaves the choice to an admin.
UPDATE public.family_branches SET partner_person_id=private.unique_branch_partner(anchor_person_id)
WHERE current_setting('private.branch_partner_backfill',true)='true'
  AND partner_person_id IS NULL AND private.unique_branch_partner(anchor_person_id) IS NOT NULL;

-- Drop every earlier permissive policy on these tables, including legacy names.
DO $$ DECLARE policy record;
BEGIN
  FOR policy IN SELECT schemaname,tablename,policyname FROM pg_policies
    WHERE schemaname='public' AND tablename IN
      ('family_branches','family_branch_members','persons','relationships')
  LOOP EXECUTE format('DROP POLICY %I ON %I.%I',policy.policyname,policy.schemaname,policy.tablename); END LOOP;
END; $$;

-- Intake approval bypasses RLS intentionally, so its matching and duplicate
-- checks must stay strictly in the main lineage rather than probing private rows.
DO $$ DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.review_family_intake(uuid,text,jsonb,text)'::regprocedure) INTO definition;
  definition := replace(definition,
    'WHERE id = (review_payload->>''anchor_id'')::uuid)',
    'WHERE id = (review_payload->>''anchor_id'')::uuid AND family_branch_id IS NULL)');
  definition := replace(definition,'FROM public.persons WHERE id = person_id)',
    'FROM public.persons WHERE id = person_id AND family_branch_id IS NULL)');
  definition := replace(definition,'FROM public.persons p WHERE lower(btrim(p.full_name))',
    'FROM public.persons p WHERE p.family_branch_id IS NULL AND lower(btrim(p.full_name))');
  definition := replace(definition,'FROM public.relationships WHERE type = ''marriage'' AND',
    'FROM public.relationships WHERE family_branch_id IS NULL AND type = ''marriage'' AND');
  EXECUTE definition;
END; $$;
CREATE POLICY "Private branch read" ON public.family_branches FOR SELECT TO authenticated
USING (public.can_view_family_branch(id));
CREATE POLICY "Private branch create" ON public.family_branches FOR INSERT TO authenticated
WITH CHECK (public.is_admin());
CREATE POLICY "Private branch update" ON public.family_branches FOR UPDATE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_view_family_branch(id)))
WITH CHECK (public.is_admin() OR (public.is_editor() AND public.can_view_family_branch(id)));
CREATE POLICY "Private branch delete" ON public.family_branches FOR DELETE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_view_family_branch(id)));
CREATE POLICY "Private branch membership read" ON public.family_branch_members FOR SELECT TO authenticated
USING (public.can_view_family_branch(branch_id));
CREATE POLICY "Private branch membership insert" ON public.family_branch_members FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR (public.is_editor() AND public.can_view_family_branch(branch_id)
  AND public.can_view_person(person_id)));
CREATE POLICY "Private branch membership update" ON public.family_branch_members FOR UPDATE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_view_family_branch(branch_id)))
WITH CHECK (public.is_admin() OR (public.is_editor() AND public.can_view_family_branch(branch_id)
  AND public.can_view_person(person_id)));
CREATE POLICY "Private branch membership delete" ON public.family_branch_members FOR DELETE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_view_family_branch(branch_id)));
CREATE OR REPLACE FUNCTION private.guard_private_branch_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (TG_OP='INSERT' OR NEW.person_id IS DISTINCT FROM OLD.person_id)
    AND auth.uid() IS NOT NULL AND NOT public.is_admin()
    AND NOT private.can_view_person(NEW.person_id)
  THEN RAISE EXCEPTION 'Cannot link a hidden person.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_private_branch_member ON public.family_branch_members;
CREATE TRIGGER tr_guard_private_branch_member BEFORE INSERT OR UPDATE ON public.family_branch_members
FOR EACH ROW EXECUTE FUNCTION private.guard_private_branch_member();
CREATE POLICY "Scoped person read" ON public.persons FOR SELECT TO authenticated
USING (public.is_active_user() AND (family_branch_id IS NULL OR
  public.can_view_family_branch(family_branch_id) OR public.can_view_person(id)));
CREATE POLICY "Scoped person insert" ON public.persons FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_view_family_branch(family_branch_id))));
CREATE POLICY "Scoped person update" ON public.persons FOR UPDATE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_view_person(id)))
WITH CHECK (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_view_person(id))));
CREATE POLICY "Scoped person delete" ON public.persons FOR DELETE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_view_person(id)));
CREATE POLICY "Scoped relationship read" ON public.relationships FOR SELECT TO authenticated
USING (public.is_active_user() AND (family_branch_id IS NULL OR public.can_view_family_branch(family_branch_id))
  AND public.can_view_person(person_a) AND public.can_view_person(person_b));
CREATE POLICY "Scoped relationship insert" ON public.relationships FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_view_family_branch(family_branch_id))
  AND public.can_view_person(person_a) AND public.can_view_person(person_b)));
CREATE POLICY "Scoped relationship update" ON public.relationships FOR UPDATE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_view_family_branch(family_branch_id))
  AND public.can_view_person(person_a) AND public.can_view_person(person_b)))
WITH CHECK (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_view_family_branch(family_branch_id))
  AND public.can_view_person(person_a) AND public.can_view_person(person_b)));
CREATE POLICY "Scoped relationship delete" ON public.relationships FOR DELETE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_view_family_branch(family_branch_id))
  AND public.can_view_person(person_a) AND public.can_view_person(person_b)));

-- Scope guards make guessed RPC IDs fail before any mutation.
DO $$ DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.add_family_branch_person(uuid,jsonb,uuid,text,uuid)'::regprocedure) INTO definition;
  definition := replace(definition,
    'IF NOT (public.is_admin() OR public.is_editor()) THEN',
    'IF NOT (public.is_admin() OR (public.is_editor() AND public.can_view_family_branch(p_branch_id))) THEN');
  EXECUTE definition;
END; $$;

CREATE OR REPLACE FUNCTION public.create_family_branch(p_anchor_person_id uuid,p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE branch_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'Invalid branch name.'; END IF;
  INSERT INTO public.family_branches(name,anchor_person_id,root_person_id)
  VALUES (btrim(p_name),p_anchor_person_id,p_anchor_person_id) RETURNING id INTO branch_id;
  RETURN branch_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.avatar_storage_path(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT regexp_replace(split_part(regexp_replace(p_url,
    '^https?://[^/]+/storage/v1/object/(public|sign|authenticated)/avatars/', ''),'?',1), '^avatars/', '');
$$;
CREATE OR REPLACE FUNCTION private.can_view_avatar(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_admin() OR CASE
    -- Canonical filenames bind to their owner, even if another profile stores
    -- an alias URL. This also permits INSERT RETURNING before metadata is saved.
    WHEN p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[_.]'
    THEN private.can_view_person(left(p_name,36)::uuid)
    ELSE EXISTS (
    SELECT 1 FROM public.persons p WHERE private.can_view_person(p.id) AND
      private.avatar_storage_path(p.avatar_url)=p_name
    ) AND NOT EXISTS (
      SELECT 1 FROM public.persons p WHERE NOT private.can_view_person(p.id)
        AND private.avatar_storage_path(p.avatar_url)=p_name
    ) END;
$$;
CREATE OR REPLACE FUNCTION private.can_edit_avatar(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_admin() OR (public.is_editor() AND private.can_view_avatar(p_name));
$$;
-- Prevent an editor assigning a guessed private URL to a visible person and
-- thereby manufacturing the association used by Storage read policy.
CREATE OR REPLACE FUNCTION private.guard_person_avatar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.avatar_url IS NOT NULL AND (TG_OP='INSERT' OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url)
    AND auth.uid() IS NOT NULL AND NOT public.is_admin()
    AND NOT private.can_edit_avatar(private.avatar_storage_path(NEW.avatar_url))
  THEN RAISE EXCEPTION 'Avatar does not belong to a visible person.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_person_avatar ON public.persons;
CREATE TRIGGER tr_guard_person_avatar BEFORE INSERT OR UPDATE OF avatar_url ON public.persons
FOR EACH ROW EXECUTE FUNCTION private.guard_person_avatar();
DROP POLICY IF EXISTS "Avatar images are publicly accessible." ON storage.objects;
DROP POLICY IF EXISTS "Active users can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Private avatars read" ON storage.objects;
CREATE POLICY "Private avatars read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='avatars' AND private.can_view_avatar(name));
DROP POLICY IF EXISTS "Admins and editors can update avatars" ON storage.objects;
DROP POLICY IF EXISTS "Admins and editors can upload avatars" ON storage.objects;
CREATE POLICY "Admins and editors can upload avatars" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='avatars' AND private.can_edit_avatar(name));
CREATE POLICY "Admins and editors can update avatars" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='avatars' AND private.can_edit_avatar(name))
WITH CHECK (bucket_id='avatars' AND private.can_edit_avatar(name));
DROP POLICY IF EXISTS "Admins and editors can delete avatars" ON storage.objects;
CREATE POLICY "Admins and editors can delete avatars" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='avatars' AND private.can_edit_avatar(name));

-- Private implementations have fixed paths; exposed RPCs remain invoker wrappers.
REVOKE ALL ON FUNCTION private.unique_branch_partner(uuid), private.can_view_family_branch(uuid),
  private.can_view_person(uuid), private.set_user_person(uuid,uuid), private.can_view_avatar(text),
  private.can_edit_avatar(text), private.avatar_storage_path(text), private.guard_person_avatar(),
  private.guard_profile_person(), private.guard_branch_partner(), private.guard_private_branch_member(),
  private.valid_branch_partner(uuid,uuid),private.clear_revoked_branch_partners() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_family_branch(uuid),
  private.can_view_person(uuid), private.set_user_person(uuid,uuid), private.can_view_avatar(text),
  private.can_edit_avatar(text) TO authenticated;
REVOKE ALL ON FUNCTION public.can_view_family_branch(uuid), public.can_view_person(uuid),
  public.set_user_person(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_family_branch(uuid), public.can_view_person(uuid),
  public.set_user_person(uuid,uuid) TO authenticated;

-- Restore keeps local Auth mappings outside the portable tree backup. Imported
-- spouse choices are assigned only after the main marriage rows exist.
-- Define the complete function directly: pg_get_functiondef preserves body line
-- endings/indentation, so rewriting its text is not portable across installations.
CREATE OR REPLACE FUNCTION private.import_family_backup(payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE account_links jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF jsonb_typeof(payload->'persons') IS DISTINCT FROM 'array'
     OR jsonb_typeof(payload->'relationships') IS DISTINCT FROM 'array'
     OR jsonb_typeof(payload->'person_details_private') IS DISTINCT FROM 'array'
     OR jsonb_typeof(payload->'custom_events') IS DISTINCT FROM 'array'
     OR (payload ? 'family_branches' AND jsonb_typeof(payload->'family_branches') IS DISTINCT FROM 'array')
     OR (payload ? 'family_branch_members' AND jsonb_typeof(payload->'family_branch_members') IS DISTINCT FROM 'array')
  THEN RAISE EXCEPTION 'Invalid backup arrays.'; END IF;
  IF jsonb_array_length(payload->'persons') NOT BETWEEN 1 AND 10000
     OR jsonb_array_length(payload->'relationships') > 30000
     OR jsonb_array_length(payload->'person_details_private') > 10000
     OR jsonb_array_length(payload->'custom_events') > 10000
     OR jsonb_array_length(coalesce(payload->'family_branches','[]'::jsonb)) > 10000
     OR jsonb_array_length(coalesce(payload->'family_branch_members','[]'::jsonb)) > 30000
  THEN RAISE EXCEPTION 'Backup exceeds import limits.'; END IF;

  LOCK TABLE public.profiles, public.custom_events, public.relationships, public.person_details_private,
    public.family_branch_members, public.family_branches, public.persons IN SHARE ROW EXCLUSIVE MODE;
  SELECT coalesce(jsonb_object_agg(id::text,person_id),'{}'::jsonb) INTO account_links
  FROM public.profiles WHERE person_id IS NOT NULL;
  DELETE FROM public.custom_events;
  DELETE FROM public.relationships;
  DELETE FROM public.person_details_private;
  DELETE FROM public.family_branches;
  DELETE FROM public.persons;

  INSERT INTO public.persons (
    id, full_name, gender, birth_year_from, birth_year_to, death_year_from, death_year_to,
    birth_year, birth_month, birth_day, death_year, death_month, death_day,
    death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law,
    birth_order, generation, other_names, avatar_url, note, memorial_day, memorial_month,
    memorial_calendar, memorial_is_leap_month, memorial_note, family_branch_id
  ) SELECT id, full_name, gender, birth_year_from, birth_year_to, death_year_from, death_year_to,
    birth_year, birth_month, birth_day, death_year, death_month, death_day,
    death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law,
    birth_order, generation, other_names, avatar_url, note, memorial_day, memorial_month,
    memorial_calendar, coalesce(memorial_is_leap_month,false), memorial_note, family_branch_id
  FROM jsonb_populate_recordset(NULL::public.persons, payload->'persons');

  INSERT INTO public.family_branches(id, name, anchor_person_id, root_person_id, created_at, updated_at)
  SELECT id, name, anchor_person_id, NULL, coalesce(created_at,now()), coalesce(updated_at,now())
  FROM jsonb_populate_recordset(NULL::public.family_branches,
    coalesce(payload->'family_branches','[]'::jsonb));
  INSERT INTO public.family_branch_members(branch_id, person_id, generation)
  SELECT branch_id, person_id, generation
  FROM jsonb_populate_recordset(NULL::public.family_branch_members,
    coalesce(payload->'family_branch_members','[]'::jsonb))
  ON CONFLICT (branch_id, person_id) DO UPDATE SET generation = excluded.generation;
  UPDATE public.family_branches b SET root_person_id = imported.root_person_id,
    updated_at = coalesce(imported.updated_at, b.updated_at)
  FROM jsonb_populate_recordset(NULL::public.family_branches,
    coalesce(payload->'family_branches','[]'::jsonb)) imported
  WHERE b.id = imported.id AND imported.root_person_id IS NOT NULL;
  IF EXISTS (SELECT 1 FROM public.family_branches b WHERE NOT EXISTS (
    SELECT 1 FROM public.family_branch_members m WHERE m.branch_id=b.id AND m.person_id=b.anchor_person_id
  ) OR (b.root_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.family_branch_members m WHERE m.branch_id=b.id AND m.person_id=b.root_person_id
  ))) THEN RAISE EXCEPTION 'Branch anchor and root must be members.'; END IF;
  IF EXISTS (SELECT 1 FROM public.persons p WHERE p.family_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.family_branch_members m WHERE m.branch_id=p.family_branch_id AND m.person_id=p.id
  )) THEN RAISE EXCEPTION 'Owned person must be a branch member.'; END IF;

  INSERT INTO public.relationships(type, person_a, person_b, note, family_branch_id)
  SELECT type, person_a, person_b, note, family_branch_id
  FROM jsonb_populate_recordset(NULL::public.relationships, payload->'relationships');
  -- Restore spouse access only after marriage rows exist; revoked choices stay null.
  UPDATE public.family_branches b SET partner_person_id=CASE
    WHEN private.valid_branch_partner(b.anchor_person_id,(imported.value->>'partner_person_id')::uuid)
      THEN (imported.value->>'partner_person_id')::uuid
    WHEN NOT (imported.value ? 'partner_person_id') THEN private.unique_branch_partner(b.anchor_person_id)
    ELSE NULL END
  FROM jsonb_array_elements(coalesce(payload->'family_branches','[]'::jsonb)) imported(value)
  WHERE b.id=(imported.value->>'id')::uuid;
  UPDATE public.profiles u SET person_id=(account_links->>u.id::text)::uuid
  WHERE account_links ? u.id::text AND EXISTS (
    SELECT 1 FROM public.persons p WHERE p.id=(account_links->>u.id::text)::uuid
  );
  INSERT INTO public.person_details_private(person_id, phone_number, occupation, current_residence)
  SELECT person_id, phone_number, occupation, current_residence
  FROM jsonb_populate_recordset(NULL::public.person_details_private, payload->'person_details_private');
  INSERT INTO public.custom_events(id, name, content, event_date, location)
  SELECT id, name, content, event_date, location
  FROM jsonb_populate_recordset(NULL::public.custom_events, payload->'custom_events');
END;
$$;
REVOKE ALL ON FUNCTION private.import_family_backup(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.import_family_backup(jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.import_family_backup(payload jsonb)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.import_family_backup(payload);
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
