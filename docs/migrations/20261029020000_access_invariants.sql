-- Access tokens outlive Auth logout/restore. Every authenticated data boundary
-- must also recognize the live session, including SECURITY DEFINER RPCs.
BEGIN;

CREATE OR REPLACE FUNCTION private.has_live_session()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE session_claim text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  session_claim := auth.jwt()->>'session_id';
  IF session_claim IS NULL OR session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM auth.sessions s
    WHERE s.id=session_claim::uuid AND s.user_id=auth.uid());
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION private.has_live_session() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.has_live_session() TO authenticated;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_live_session() AND EXISTS (SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND role='admin' AND is_active);
$$;
CREATE OR REPLACE FUNCTION private.is_active_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_live_session() AND EXISTS (SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND is_active);
$$;
CREATE OR REPLACE FUNCTION private.is_editor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_live_session() AND EXISTS (SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND role='editor' AND is_active);
$$;

CREATE OR REPLACE FUNCTION private.can_edit_family_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_live_session() AND EXISTS (
    SELECT 1 FROM public.profiles u WHERE u.id = auth.uid() AND u.is_active AND
      (u.role = 'admin' OR (u.role = 'editor' AND EXISTS (
        SELECT 1 FROM public.family_branches b WHERE b.id = p_branch_id AND
          (u.person_id = b.anchor_person_id OR
           (u.person_id = b.partner_person_id AND EXISTS (
             SELECT 1 FROM public.relationships r JOIN public.persons p ON p.id = b.partner_person_id
             WHERE r.family_branch_id IS NULL AND r.type = 'marriage'
               AND p.family_branch_id IS NULL AND
               ((r.person_a=b.anchor_person_id AND r.person_b=b.partner_person_id) OR
                (r.person_b=b.anchor_person_id AND r.person_a=b.partner_person_id))
           )))
      )))
  );
$$;
CREATE OR REPLACE FUNCTION private.can_view_family_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_live_session() AND EXISTS (
    SELECT 1 FROM public.profiles u WHERE u.id=auth.uid() AND u.is_active AND
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
CREATE OR REPLACE FUNCTION private.can_view_person(p_person_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_live_session()
    AND EXISTS (SELECT 1 FROM public.profiles u WHERE u.id=auth.uid() AND u.is_active)
    AND EXISTS (SELECT 1 FROM public.persons p WHERE p.id=p_person_id AND
      (p.family_branch_id IS NULL OR private.can_view_family_branch(p.family_branch_id) OR
       EXISTS (SELECT 1 FROM public.family_branch_members m WHERE m.person_id=p.id
               AND private.can_view_family_branch(m.branch_id))));
$$;

-- The shared transaction lock precedes authorization: a waiting caller may have
-- lost admin access while another administrator's operation was committing.
CREATE OR REPLACE FUNCTION private.set_user_role(target_user_id uuid,new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,auth AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('family_tree_admin_accounts'));
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF target_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot change your own role.'; END IF;
  IF new_role::public.user_role_enum <> 'admin'::public.user_role_enum
     AND (SELECT role FROM public.profiles WHERE id=target_user_id) = 'admin'::public.user_role_enum
     AND (SELECT count(*) FROM public.profiles WHERE role='admin' AND is_active) <= 1
  THEN RAISE EXCEPTION 'Cannot remove the last active administrator.'; END IF;
  UPDATE public.profiles SET role=new_role::public.user_role_enum WHERE id=target_user_id;
END;
$$;
CREATE OR REPLACE FUNCTION private.delete_user(target_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,auth AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('family_tree_admin_accounts'));
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF auth.uid() = target_user_id THEN RAISE EXCEPTION 'Cannot delete yourself.'; END IF;
  IF (SELECT role FROM public.profiles WHERE id=target_user_id) = 'admin'::public.user_role_enum
     AND (SELECT count(*) FROM public.profiles WHERE role='admin' AND is_active) <= 1
  THEN RAISE EXCEPTION 'Cannot delete the last active administrator.'; END IF;
  DELETE FROM auth.users WHERE id=target_user_id;
END;
$$;
CREATE OR REPLACE FUNCTION private.set_user_active_status(target_user_id uuid,new_status boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,auth AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('family_tree_admin_accounts'));
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF target_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot change your own active status.'; END IF;
  IF new_status = false
     AND (SELECT role FROM public.profiles WHERE id=target_user_id) = 'admin'::public.user_role_enum
     AND (SELECT count(*) FROM public.profiles WHERE role='admin' AND is_active) <= 1
  THEN RAISE EXCEPTION 'Cannot deactivate the last active administrator.'; END IF;
  UPDATE public.profiles SET is_active=new_status WHERE id=target_user_id;
END;
$$;

-- Restrictive policies also protect own-profile reads and future permissive
-- policies. Anonymous public content/intake and privileged SQL stay available.
DO $$ DECLARE entry record;
BEGIN
  FOR entry IN SELECT n.nspname AS schema_name,c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relrowsecurity AND c.relkind IN ('r','p')
      AND (n.nspname='public' OR (n.nspname='storage' AND c.relname='objects'))
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS live_authenticated_session ON %I.%I',entry.schema_name,entry.table_name);
    EXECUTE format('CREATE POLICY live_authenticated_session ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT private.has_live_session())) WITH CHECK ((SELECT private.has_live_session()))',entry.schema_name,entry.table_name);
  END LOOP;
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
