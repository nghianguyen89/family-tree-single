-- Main-lineage descendants may read their ancestor's auxiliary branch.
-- Editing stays with active admins and the explicitly identified editor couple.
BEGIN;
CREATE OR REPLACE FUNCTION private.can_edit_family_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
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

CREATE OR REPLACE FUNCTION public.can_edit_family_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.can_edit_family_branch(p_branch_id);
$$;
CREATE OR REPLACE FUNCTION private.can_view_family_branch(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
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
-- Shared profiles remain editable through an authorized branch membership;
-- read-only ancestry access must never grant writes to their owning branch.
CREATE OR REPLACE FUNCTION private.can_edit_person(p_person_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_admin() OR (public.is_editor() AND EXISTS (
    SELECT 1 FROM public.persons p WHERE p.id=p_person_id AND
      (p.family_branch_id IS NULL OR private.can_edit_family_branch(p.family_branch_id) OR EXISTS (
        SELECT 1 FROM public.family_branch_members m WHERE m.person_id=p.id
          AND private.can_edit_family_branch(m.branch_id)
      ))
  ));
$$;
CREATE OR REPLACE FUNCTION public.can_edit_person(p_person_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.can_edit_person(p_person_id);
$$;
DROP POLICY IF EXISTS "Private branch update" ON public.family_branches;
CREATE POLICY "Private branch update" ON public.family_branches FOR UPDATE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_edit_family_branch(id)))
WITH CHECK (public.is_admin() OR (public.is_editor() AND public.can_edit_family_branch(id)));
DROP POLICY IF EXISTS "Private branch delete" ON public.family_branches;
CREATE POLICY "Private branch delete" ON public.family_branches FOR DELETE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_edit_family_branch(id)));
DROP POLICY IF EXISTS "Private branch membership insert" ON public.family_branch_members;
-- Linking a read-only ancestor into one's own editable branch must not create
-- the very shared membership that would grant edits to that ancestor.
CREATE POLICY "Private branch membership insert" ON public.family_branch_members FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR (public.is_editor() AND public.can_edit_family_branch(branch_id)
  AND public.can_edit_person(person_id)));
DROP POLICY IF EXISTS "Private branch membership update" ON public.family_branch_members;
CREATE POLICY "Private branch membership update" ON public.family_branch_members FOR UPDATE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_edit_family_branch(branch_id)))
WITH CHECK (public.is_admin() OR (public.is_editor() AND public.can_edit_family_branch(branch_id)
  AND public.can_edit_person(person_id)));
DROP POLICY IF EXISTS "Private branch membership delete" ON public.family_branch_members;
CREATE POLICY "Private branch membership delete" ON public.family_branch_members FOR DELETE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_edit_family_branch(branch_id)));
DROP POLICY IF EXISTS "Scoped person insert" ON public.persons;
CREATE POLICY "Scoped person insert" ON public.persons FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_edit_family_branch(family_branch_id))));
DROP POLICY IF EXISTS "Scoped person update" ON public.persons;
CREATE POLICY "Scoped person update" ON public.persons FOR UPDATE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_edit_person(id)))
WITH CHECK (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_edit_person(id))));
DROP POLICY IF EXISTS "Scoped person delete" ON public.persons;
CREATE POLICY "Scoped person delete" ON public.persons FOR DELETE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND public.can_edit_person(id)));
DROP POLICY IF EXISTS "Scoped relationship insert" ON public.relationships;
CREATE POLICY "Scoped relationship insert" ON public.relationships FOR INSERT TO authenticated
WITH CHECK (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_edit_family_branch(family_branch_id))
  AND public.can_view_person(person_a) AND public.can_view_person(person_b)));
DROP POLICY IF EXISTS "Scoped relationship update" ON public.relationships;
CREATE POLICY "Scoped relationship update" ON public.relationships FOR UPDATE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_edit_family_branch(family_branch_id))
  AND public.can_view_person(person_a) AND public.can_view_person(person_b)))
WITH CHECK (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_edit_family_branch(family_branch_id))
  AND public.can_view_person(person_a) AND public.can_view_person(person_b)));
DROP POLICY IF EXISTS "Scoped relationship delete" ON public.relationships;
CREATE POLICY "Scoped relationship delete" ON public.relationships FOR DELETE TO authenticated
USING (public.is_admin() OR (public.is_editor() AND
  (family_branch_id IS NULL OR public.can_edit_family_branch(family_branch_id))
  AND public.can_view_person(person_a) AND public.can_view_person(person_b)));
CREATE OR REPLACE FUNCTION public.add_family_branch_person(
  p_branch_id uuid, p_payload jsonb, p_relative_id uuid DEFAULT NULL,
  p_relation text DEFAULT 'member', p_existing_person_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE data public.persons; v_person_id uuid; relationship_type public.relationship_type_enum;
        relationship_a uuid; relationship_b uuid;
BEGIN
  IF NOT public.can_edit_family_branch(p_branch_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
  -- Serialize edits within a branch, including ancestry checks, across sessions.
  IF NOT EXISTS (SELECT 1 FROM public.family_branches WHERE id = p_branch_id FOR UPDATE)
  THEN RAISE EXCEPTION 'Branch does not exist.'; END IF;
  IF p_relation IS NULL OR p_relation NOT IN ('parent','child','spouse','member')
  THEN RAISE EXCEPTION 'Invalid branch relation.'; END IF;
  IF p_relation <> 'member' AND (p_relative_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.family_branch_members WHERE branch_id = p_branch_id AND person_id = p_relative_id
  )) THEN RAISE EXCEPTION 'Relative must belong to the branch.'; END IF;
  IF p_relation = 'member' AND p_relative_id IS NOT NULL
  THEN RAISE EXCEPTION 'Member relation cannot have a relative.'; END IF;

  IF p_existing_person_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.persons WHERE id = p_existing_person_id)
    THEN RAISE EXCEPTION 'Existing person does not exist.'; END IF;
    v_person_id := p_existing_person_id;
  ELSE
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR
       EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) AS k(key)
               WHERE key NOT IN ('full_name','gender','birth_year','birth_month','birth_day',
                 'birth_year_from','birth_year_to','death_year','death_month','death_day',
                 'death_year_from','death_year_to','death_lunar_year','death_lunar_month',
                 'death_lunar_day','is_deceased','other_names','note','memorial_day',
                 'memorial_month','memorial_calendar','memorial_is_leap_month','memorial_note'))
    THEN RAISE EXCEPTION 'Invalid branch person fields.'; END IF;
    IF length(btrim(coalesce(p_payload->>'full_name',''))) NOT BETWEEN 1 AND 200
    THEN RAISE EXCEPTION 'Invalid person name.'; END IF;
    data := jsonb_populate_record(NULL::public.persons, p_payload);
    IF data.gender IS NULL THEN RAISE EXCEPTION 'Gender is required.'; END IF;
    INSERT INTO public.persons(full_name, gender, birth_year, birth_month, birth_day,
      birth_year_from, birth_year_to, death_year, death_month, death_day,
      death_year_from, death_year_to, death_lunar_year, death_lunar_month, death_lunar_day,
      is_deceased, other_names, note, memorial_day, memorial_month, memorial_calendar,
      memorial_is_leap_month, memorial_note, family_branch_id)
    VALUES (btrim(data.full_name), data.gender, data.birth_year, data.birth_month, data.birth_day,
      data.birth_year_from, data.birth_year_to, data.death_year, data.death_month, data.death_day,
      data.death_year_from, data.death_year_to, data.death_lunar_year, data.death_lunar_month, data.death_lunar_day,
      coalesce(data.is_deceased,false), data.other_names, data.note, data.memorial_day,
      data.memorial_month, data.memorial_calendar, coalesce(data.memorial_is_leap_month,false),
      data.memorial_note, p_branch_id) RETURNING id INTO v_person_id;
  END IF;
  IF p_relative_id = v_person_id THEN RAISE EXCEPTION 'A person cannot be their own relative.'; END IF;
  INSERT INTO public.family_branch_members(branch_id, person_id)
  VALUES (p_branch_id, v_person_id) ON CONFLICT ON CONSTRAINT family_branch_members_pkey DO NOTHING;

  IF p_relation <> 'member' THEN
    relationship_type := CASE WHEN p_relation = 'spouse' THEN 'marriage' ELSE 'biological_child' END;
    relationship_a := CASE WHEN p_relation = 'parent' THEN v_person_id ELSE p_relative_id END;
    relationship_b := CASE WHEN p_relation = 'parent' THEN p_relative_id ELSE v_person_id END;
    IF p_relation IN ('parent','child') AND EXISTS (
      WITH RECURSIVE descendants(id) AS (
        SELECT relationship_b
        UNION
        SELECT r.person_b FROM public.relationships r JOIN descendants d ON r.person_a = d.id
        WHERE r.type IN ('biological_child','adopted_child')
          AND (r.family_branch_id IS NULL OR r.family_branch_id = p_branch_id)
      ) SELECT 1 FROM descendants WHERE id = relationship_a
    ) THEN RAISE EXCEPTION 'Relationship would create an ancestry cycle.'; END IF;
    IF p_relation = 'spouse' AND EXISTS (
      SELECT 1 FROM public.relationships r WHERE r.type = 'marriage' AND
        ((r.person_a = v_person_id AND r.person_b = p_relative_id) OR
         (r.person_a = p_relative_id AND r.person_b = v_person_id))
        AND (r.family_branch_id IS NULL OR r.family_branch_id = p_branch_id)
    ) THEN RAISE EXCEPTION 'Spouse relationship already exists.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.relationships r
                   WHERE r.type=relationship_type AND r.person_a=relationship_a
                     AND r.person_b=relationship_b AND r.family_branch_id IS NULL) THEN
      INSERT INTO public.relationships(type, person_a, person_b, family_branch_id)
      VALUES (relationship_type, relationship_a, relationship_b, p_branch_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN v_person_id;
END;
$$;
REVOKE ALL ON FUNCTION public.add_family_branch_person(uuid,jsonb,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_family_branch_person(uuid,jsonb,uuid,text,uuid) TO authenticated;


CREATE OR REPLACE FUNCTION private.can_edit_avatar(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_admin() OR (public.is_editor() AND CASE
    WHEN p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[_.]'
    THEN private.can_edit_person(left(p_name,36)::uuid)
    ELSE EXISTS (
      SELECT 1 FROM public.persons p WHERE private.can_edit_person(p.id)
        AND private.avatar_storage_path(p.avatar_url)=p_name
    ) AND NOT EXISTS (
      SELECT 1 FROM public.persons p WHERE NOT private.can_edit_person(p.id)
        AND private.avatar_storage_path(p.avatar_url)=p_name
    ) END);
$$;
REVOKE ALL ON FUNCTION private.can_edit_family_branch(uuid), private.can_edit_person(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_edit_family_branch(uuid), private.can_edit_person(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.can_edit_family_branch(uuid), public.can_edit_person(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_family_branch(uuid), public.can_edit_person(uuid) TO authenticated;
COMMIT;
