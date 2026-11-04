-- Shared PIN sessions use a normal member identity with an immutable,
-- database-protected restriction. Authentication credentials remain in Auth.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_shared_viewer boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.profiles'::regclass
    AND conname='profiles_shared_viewer_identity') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_shared_viewer_identity
      CHECK (NOT is_shared_viewer OR (role='member' AND person_id IS NULL));
  END IF;
END; $$;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_shared_viewer
  ON public.profiles (is_shared_viewer) WHERE is_shared_viewer;

CREATE OR REPLACE FUNCTION private.is_shared_viewer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_shared_viewer);
$$;
REVOKE ALL ON FUNCTION private.is_shared_viewer() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.is_shared_viewer() TO authenticated;

CREATE OR REPLACE FUNCTION private.guard_shared_viewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.is_shared_viewer AND NOT NEW.is_shared_viewer THEN
    RAISE EXCEPTION 'A shared viewer restriction cannot be removed.';
  END IF;
  IF NEW.is_shared_viewer AND (TG_OP='INSERT' OR NOT OLD.is_shared_viewer) THEN
    IF current_setting('role',true) IN ('anon','authenticated') AND NOT private.is_admin() THEN
      RAISE EXCEPTION 'Only active administrators may designate a shared viewer.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=NEW.id
      AND lower(email)='shared-viewer@family-tree.invalid') THEN
      RAISE EXCEPTION 'Shared viewer must use its reserved Auth identity.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_shared_viewer() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS tr_guard_shared_viewer ON public.profiles;
CREATE TRIGGER tr_guard_shared_viewer BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.guard_shared_viewer();

-- Do not trust signup metadata or activate the account before admin provisioning.
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id,role,is_active,is_shared_viewer)
  VALUES (NEW.id,'member'::public.user_role_enum,false,
    coalesce(lower(NEW.email)='shared-viewer@family-tree.invalid',false));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.revoke_shared_viewer_sessions(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('family_tree_admin_accounts'));
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_user_id AND is_shared_viewer) THEN
    RAISE EXCEPTION 'Shared viewer account does not exist.';
  END IF;
  DELETE FROM auth.sessions WHERE user_id=p_user_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.revoke_shared_viewer_sessions(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.revoke_shared_viewer_sessions(p_user_id);
$$;
REVOKE ALL ON FUNCTION private.revoke_shared_viewer_sessions(uuid),
  public.revoke_shared_viewer_sessions(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.revoke_shared_viewer_sessions(uuid),
  public.revoke_shared_viewer_sessions(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.can_view_family_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_live_session() AND EXISTS (
    SELECT 1 FROM public.profiles u WHERE u.id=auth.uid() AND u.is_active AND NOT u.is_shared_viewer AND
      (u.role='admin' OR EXISTS (
        SELECT 1 FROM public.family_branches b WHERE b.id=p_branch_id AND
          (u.person_id=b.anchor_person_id OR
           (u.person_id=b.partner_person_id AND private.valid_branch_partner(b.anchor_person_id,b.partner_person_id)) OR
           u.person_id IN (
             WITH RECURSIVE descendants(id) AS (
               SELECT b.anchor_person_id
               UNION
               SELECT r.person_b FROM public.relationships r JOIN descendants d ON r.person_a=d.id
               WHERE r.family_branch_id IS NULL AND r.type IN ('biological_child','adopted_child')
             ) SELECT id FROM descendants
           ))
      ))
  );
$$;

-- Separate command policies preserve member reads and combine with the live
-- session invariant and existing permissive role/ownership policies.
DO $$ DECLARE entry record; operation text;
BEGIN
  FOR entry IN SELECT n.nspname AS schema_name,c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relrowsecurity AND c.relkind IN ('r','p')
      AND (n.nspname='public' OR (n.nspname='storage' AND c.relname='objects'))
  LOOP
    FOREACH operation IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
        'shared_viewer_no_'||lower(operation),entry.schema_name,entry.table_name);
      EXECUTE format('CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR %s TO authenticated %s',
        'shared_viewer_no_'||lower(operation),entry.schema_name,entry.table_name,operation,
        CASE operation
          WHEN 'INSERT' THEN 'WITH CHECK (NOT (SELECT private.is_shared_viewer()))'
          WHEN 'UPDATE' THEN 'USING (NOT (SELECT private.is_shared_viewer())) WITH CHECK (NOT (SELECT private.is_shared_viewer()))'
          ELSE 'USING (NOT (SELECT private.is_shared_viewer()))' END);
    END LOOP;
  END LOOP;
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
