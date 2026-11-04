-- Auxiliary trees share existing profiles without changing their main-lineage fields.
BEGIN;

CREATE TABLE IF NOT EXISTS public.family_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 150),
  anchor_person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  root_person_id uuid REFERENCES public.persons(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS family_branch_id uuid;
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_family_branch_id_fkey;
ALTER TABLE public.persons ADD CONSTRAINT persons_family_branch_id_fkey
  FOREIGN KEY (family_branch_id) REFERENCES public.family_branches(id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_auxiliary_generation_check;
ALTER TABLE public.persons ADD CONSTRAINT persons_auxiliary_generation_check
  CHECK (family_branch_id IS NULL OR generation IS NULL);
ALTER TABLE public.relationships ADD COLUMN IF NOT EXISTS family_branch_id uuid;
ALTER TABLE public.relationships DROP CONSTRAINT IF EXISTS relationships_family_branch_id_fkey;
ALTER TABLE public.relationships ADD CONSTRAINT relationships_family_branch_id_fkey
  FOREIGN KEY (family_branch_id) REFERENCES public.family_branches(id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS idx_persons_family_branch ON public.persons(family_branch_id);
CREATE INDEX IF NOT EXISTS idx_relationships_family_branch ON public.relationships(family_branch_id);
ALTER TABLE public.relationships DROP CONSTRAINT IF EXISTS relationships_person_a_person_b_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS relationships_scoped_unique
  ON public.relationships(person_a, person_b, type, family_branch_id) NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS public.family_branch_members (
  branch_id uuid NOT NULL REFERENCES public.family_branches(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  generation integer CHECK (generation > 0),
  PRIMARY KEY (branch_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_family_branch_members_person ON public.family_branch_members(person_id);

CREATE OR REPLACE FUNCTION private.guard_family_branch_membership()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE anchor_id uuid; root_id uuid;
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND
    (NEW.branch_id, NEW.person_id) IS DISTINCT FROM (OLD.branch_id, OLD.person_id)) THEN
    -- Cascading removal from a deleted branch is allowed; direct removal is checked.
    SELECT anchor_person_id, root_person_id INTO anchor_id, root_id
    FROM public.family_branches WHERE id = OLD.branch_id;
    IF FOUND THEN
      IF OLD.person_id = anchor_id THEN RAISE EXCEPTION 'Cannot remove a branch anchor.'; END IF;
      IF OLD.person_id = root_id THEN RAISE EXCEPTION 'Choose another branch root first.'; END IF;
      IF EXISTS (SELECT 1 FROM public.persons p WHERE p.id = OLD.person_id AND p.family_branch_id = OLD.branch_id)
      THEN RAISE EXCEPTION 'Cannot remove a person owned by the branch.'; END IF;
      IF EXISTS (SELECT 1 FROM public.relationships r
                 WHERE r.family_branch_id = OLD.branch_id
                   AND OLD.person_id IN (r.person_a, r.person_b))
      THEN RAISE EXCEPTION 'Remove branch relationships before removing their members.'; END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_family_branch_membership ON public.family_branch_members;
CREATE TRIGGER tr_guard_family_branch_membership
BEFORE INSERT OR UPDATE OR DELETE ON public.family_branch_members
FOR EACH ROW EXECUTE FUNCTION private.guard_family_branch_membership();

CREATE OR REPLACE FUNCTION private.guard_person_branch_owner()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.family_branch_id IS DISTINCT FROM OLD.family_branch_id THEN
    RAISE EXCEPTION 'A person''s branch ownership cannot be changed.';
  END IF;
  IF OLD.is_in_law AND NOT NEW.is_in_law AND EXISTS (
    SELECT 1 FROM public.family_branches b WHERE b.anchor_person_id = OLD.id
  ) THEN RAISE EXCEPTION 'A branch anchor must remain a main-lineage in-law.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_person_branch_owner ON public.persons;
CREATE TRIGGER tr_guard_person_branch_owner BEFORE UPDATE OF family_branch_id, is_in_law ON public.persons
FOR EACH ROW EXECUTE FUNCTION private.guard_person_branch_owner();

CREATE OR REPLACE FUNCTION private.add_owned_person_to_branch()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.family_branch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.family_branches WHERE id = NEW.family_branch_id
  ) THEN
    INSERT INTO public.family_branch_members(branch_id, person_id)
    VALUES (NEW.family_branch_id, NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_add_owned_person_to_branch ON public.persons;
CREATE TRIGGER tr_add_owned_person_to_branch AFTER INSERT ON public.persons
FOR EACH ROW EXECUTE FUNCTION private.add_owned_person_to_branch();

CREATE OR REPLACE FUNCTION private.add_anchor_to_branch()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.persons
                 WHERE id = NEW.anchor_person_id AND is_in_law AND family_branch_id IS NULL)
  THEN RAISE EXCEPTION 'Anchor must be a main-lineage in-law.'; END IF;
  INSERT INTO public.family_branch_members(branch_id, person_id)
  VALUES (NEW.id, NEW.anchor_person_id) ON CONFLICT DO NOTHING;
  IF NEW.root_person_id IS NOT NULL AND NEW.root_person_id <> NEW.anchor_person_id
    AND NOT EXISTS (SELECT 1 FROM public.family_branch_members
                    WHERE branch_id = NEW.id AND person_id = NEW.root_person_id)
  THEN RAISE EXCEPTION 'Branch root must be a member.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_add_anchor_to_branch ON public.family_branches;
CREATE TRIGGER tr_add_anchor_to_branch AFTER INSERT ON public.family_branches
FOR EACH ROW EXECUTE FUNCTION private.add_anchor_to_branch();

CREATE OR REPLACE FUNCTION private.guard_family_branch_root()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.anchor_person_id IS DISTINCT FROM OLD.anchor_person_id THEN
    RAISE EXCEPTION 'A branch anchor cannot be changed.';
  END IF;
  IF NEW.root_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.family_branch_members m
    WHERE m.branch_id = NEW.id AND m.person_id = NEW.root_person_id
  ) THEN RAISE EXCEPTION 'Branch root must be a member.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_family_branch_root ON public.family_branches;
CREATE TRIGGER tr_guard_family_branch_root BEFORE UPDATE OF anchor_person_id, root_person_id
ON public.family_branches FOR EACH ROW EXECUTE FUNCTION private.guard_family_branch_root();
DROP TRIGGER IF EXISTS tr_family_branches_updated_at ON public.family_branches;
CREATE TRIGGER tr_family_branches_updated_at BEFORE UPDATE ON public.family_branches
FOR EACH ROW EXECUTE FUNCTION private.handle_updated_at();

CREATE OR REPLACE FUNCTION private.guard_branch_relationship()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.family_branch_id IS NULL AND EXISTS (
    SELECT 1 FROM public.persons p
    WHERE p.id IN (NEW.person_a, NEW.person_b) AND p.family_branch_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'Auxiliary people cannot enter the main lineage.'; END IF;
  IF NEW.family_branch_id IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM public.family_branch_members
                WHERE branch_id=NEW.family_branch_id AND person_id=NEW.person_a) OR
    NOT EXISTS (SELECT 1 FROM public.family_branch_members
                WHERE branch_id=NEW.family_branch_id AND person_id=NEW.person_b)
  ) THEN RAISE EXCEPTION 'Branch relationship endpoints must be members.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_branch_relationship ON public.relationships;
CREATE TRIGGER tr_guard_branch_relationship BEFORE INSERT OR UPDATE OF
  family_branch_id, person_a, person_b ON public.relationships
FOR EACH ROW EXECUTE FUNCTION private.guard_branch_relationship();

ALTER TABLE public.family_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_branch_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Active users can view family branches" ON public.family_branches;
CREATE POLICY "Active users can view family branches" ON public.family_branches
FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS "Editors can insert family branches" ON public.family_branches;
CREATE POLICY "Editors can insert family branches" ON public.family_branches
FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Editors can update family branches" ON public.family_branches;
CREATE POLICY "Editors can update family branches" ON public.family_branches
FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor())
WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Editors can delete family branches" ON public.family_branches;
CREATE POLICY "Editors can delete family branches" ON public.family_branches
FOR DELETE TO authenticated USING (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Active users can view family branch members" ON public.family_branch_members;
CREATE POLICY "Active users can view family branch members" ON public.family_branch_members
FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS "Editors can insert family branch members" ON public.family_branch_members;
CREATE POLICY "Editors can insert family branch members" ON public.family_branch_members
FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Editors can update family branch members" ON public.family_branch_members;
CREATE POLICY "Editors can update family branch members" ON public.family_branch_members
FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor())
WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Editors can delete family branch members" ON public.family_branch_members;
CREATE POLICY "Editors can delete family branch members" ON public.family_branch_members
FOR DELETE TO authenticated USING (public.is_admin() OR public.is_editor());
REVOKE ALL ON public.family_branches, public.family_branch_members FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_branches, public.family_branch_members TO authenticated;
GRANT ALL ON public.family_branches, public.family_branch_members TO service_role;

CREATE OR REPLACE FUNCTION public.create_family_branch(p_anchor_person_id uuid, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE branch_id uuid;
BEGIN
  IF NOT (public.is_admin() OR public.is_editor()) THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'Invalid branch name.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.persons WHERE id = p_anchor_person_id AND is_in_law AND family_branch_id IS NULL)
  THEN RAISE EXCEPTION 'Anchor must be a main-lineage in-law.'; END IF;
  INSERT INTO public.family_branches(name, anchor_person_id, root_person_id)
  VALUES (btrim(p_name), p_anchor_person_id, p_anchor_person_id) RETURNING id INTO branch_id;
  RETURN branch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_family_branch(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_family_branch(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_family_branch_person(
  p_branch_id uuid, p_payload jsonb, p_relative_id uuid DEFAULT NULL,
  p_relation text DEFAULT 'member', p_existing_person_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE data public.persons; v_person_id uuid; relationship_type public.relationship_type_enum;
        relationship_a uuid; relationship_b uuid;
BEGIN
  IF NOT (public.is_admin() OR public.is_editor()) THEN RAISE EXCEPTION 'Access denied.'; END IF;
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

-- Public intake choices must walk only the main lineage.
DROP POLICY IF EXISTS "Editors create intake links" ON public.family_intake_links;
CREATE POLICY "Editors create intake links" ON public.family_intake_links
FOR INSERT TO authenticated WITH CHECK (
  (public.is_admin() OR public.is_editor()) AND created_by = auth.uid() AND
  EXISTS (SELECT 1 FROM public.persons p
          WHERE p.id = root_person_id AND p.family_branch_id IS NULL)
);
CREATE OR REPLACE FUNCTION public.get_family_intake_options(link_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE link public.family_intake_links; people jsonb;
BEGIN
  IF link_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO link FROM public.family_intake_links
  WHERE token_hash = md5(link_token) AND is_active AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.persons
                 WHERE id = link.root_person_id AND family_branch_id IS NULL) THEN RETURN NULL; END IF;
  WITH RECURSIVE branch(id) AS (
    SELECT link.root_person_id
    UNION
    SELECT r.person_b FROM public.relationships r JOIN branch b ON r.person_a = b.id
    WHERE r.type IN ('biological_child','adopted_child') AND r.family_branch_id IS NULL
  ), choices AS (
    SELECT p.id, p.full_name, p.generation FROM public.persons p JOIN branch b ON p.id = b.id
    WHERE p.family_branch_id IS NULL
    ORDER BY (p.id = link.root_person_id) DESC, p.generation NULLS LAST, p.full_name, p.id LIMIT 500
  ) SELECT coalesce(jsonb_agg(to_jsonb(choices)), '[]'::jsonb) INTO people FROM choices;
  RETURN jsonb_build_object('title', link.title, 'root_id', link.root_person_id, 'people', people);
END;
$$;
REVOKE ALL ON FUNCTION public.get_family_intake_options(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_family_intake_options(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.guard_main_intake_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' AND (
    EXISTS (SELECT 1 FROM public.persons p WHERE p.id = (NEW.reviewed_payload->>'anchor_id')::uuid
            AND p.family_branch_id IS NOT NULL) OR
    EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(NEW.reviewed_payload->'people','[]'::jsonb)) item
            JOIN public.persons p ON p.id = (item->>'existing_person_id')::uuid
            WHERE p.family_branch_id IS NOT NULL)
  ) THEN RAISE EXCEPTION 'Auxiliary people cannot be approved into main intake.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_main_intake_approval ON public.family_intake_submissions;
CREATE TRIGGER tr_guard_main_intake_approval BEFORE UPDATE OF status ON public.family_intake_submissions
FOR EACH ROW EXECUTE FUNCTION private.guard_main_intake_approval();
REVOKE ALL ON FUNCTION private.guard_family_branch_membership(),
  private.guard_person_branch_owner(), private.add_owned_person_to_branch(),
  private.add_anchor_to_branch(), private.guard_family_branch_root(),
  private.guard_branch_relationship(), private.guard_main_intake_approval()
FROM PUBLIC, anon, authenticated;

-- Keep the existing review workflow and exclude auxiliary edges from its cycle walk.
-- Refuse an unexpected function body so a changed upstream review cannot silently leak scope.
DO $$
DECLARE definition text; needle text := 'WHERE r.type IN (''biological_child'',''adopted_child'')';
BEGIN
  SELECT pg_get_functiondef('public.review_family_intake(uuid,text,jsonb,text)'::regprocedure)
  INTO definition;
  IF position(needle || ' AND r.family_branch_id IS NULL' IN definition) = 0 THEN
    IF position(needle IN definition) = 0 THEN
      RAISE EXCEPTION 'Unexpected family intake review function body.';
    END IF;
    EXECUTE replace(definition, needle, needle || ' AND r.family_branch_id IS NULL');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.review_family_intake(uuid,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_family_intake(uuid,text,jsonb,text) TO authenticated;

-- Backup import keeps the previous required arrays and accepts optional branch arrays.
CREATE OR REPLACE FUNCTION public.import_family_backup(payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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

  LOCK TABLE public.custom_events, public.relationships, public.person_details_private,
    public.family_branch_members, public.family_branches, public.persons IN SHARE ROW EXCLUSIVE MODE;
  DELETE FROM public.custom_events;
  DELETE FROM public.relationships;
  DELETE FROM public.person_details_private;
  DELETE FROM public.family_branches;
  DELETE FROM public.persons;

  -- Owner FKs are deferred until the end of the transaction. The person trigger inserts
  -- memberships only after branches exist, so restore explicit memberships below.
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
  INSERT INTO public.person_details_private(person_id, phone_number, occupation, current_residence)
  SELECT person_id, phone_number, occupation, current_residence
  FROM jsonb_populate_recordset(NULL::public.person_details_private, payload->'person_details_private');
  INSERT INTO public.custom_events(id, name, content, event_date, location)
  SELECT id, name, content, event_date, location
  FROM jsonb_populate_recordset(NULL::public.custom_events, payload->'custom_events');
END;
$$;
REVOKE ALL ON FUNCTION public.import_family_backup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_family_backup(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
