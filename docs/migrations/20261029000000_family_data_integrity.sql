-- Keep ancestry and multi-person mutations consistent across every write path.
BEGIN;

-- Updating one row per scope also makes stale repeatable-read writers fail closed.
CREATE TABLE IF NOT EXISTS private.ancestry_write_scopes (
  scope_id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0
);
REVOKE ALL ON private.ancestry_write_scopes FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.guard_ancestry_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.type NOT IN ('biological_child','adopted_child') THEN RETURN NEW; END IF;
  INSERT INTO private.ancestry_write_scopes(scope_id, revision)
  VALUES (coalesce(NEW.family_branch_id, '00000000-0000-0000-0000-000000000000'::uuid), 1)
  ON CONFLICT (scope_id) DO UPDATE SET revision = private.ancestry_write_scopes.revision + 1;
  IF NEW.person_a = NEW.person_b OR EXISTS (
    WITH RECURSIVE descendants(id) AS (
      SELECT NEW.person_b
      UNION
      SELECT r.person_b FROM public.relationships r JOIN descendants d ON r.person_a = d.id
      WHERE r.type IN ('biological_child','adopted_child')
        AND r.family_branch_id IS NOT DISTINCT FROM NEW.family_branch_id
        AND r.id IS DISTINCT FROM NEW.id
    ) SELECT 1 FROM descendants WHERE id = NEW.person_a
  ) THEN RAISE EXCEPTION 'ancestry_cycle'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_ancestry_cycle() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tr_guard_ancestry_cycle ON public.relationships;
CREATE TRIGGER tr_guard_ancestry_cycle BEFORE INSERT OR UPDATE OF
  type, person_a, person_b, family_branch_id ON public.relationships
FOR EACH ROW EXECUTE FUNCTION private.guard_ancestry_cycle();

CREATE OR REPLACE FUNCTION public.add_family_children(
  parent_id uuid, children jsonb, other_parent_id uuid DEFAULT NULL
) RETURNS uuid[] LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE child jsonb; key text; value jsonb; child_id uuid; ids uuid[] := '{}';
        parent_generation integer; child_year integer; child_month integer; child_day integer;
BEGIN
  IF NOT (public.is_admin() OR public.is_editor()) THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF jsonb_typeof(children) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid children.'; END IF;
  IF jsonb_array_length(children) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid children count.'; END IF;
  -- Match restore/descendant lock order, then hold the parent generation stable.
  LOCK TABLE public.relationships IN ROW EXCLUSIVE MODE;
  SELECT p.generation INTO parent_generation FROM public.persons p
    WHERE p.id = parent_id AND p.family_branch_id IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid parent.'; END IF;
  IF other_parent_id IS NOT NULL AND (other_parent_id = parent_id OR NOT EXISTS (
    SELECT 1 FROM public.persons p WHERE p.id = other_parent_id AND p.family_branch_id IS NULL FOR SHARE
  )) THEN RAISE EXCEPTION 'Invalid second parent.'; END IF;
  IF parent_generation IS NOT NULL AND parent_generation NOT BETWEEN 1 AND 9999
    THEN RAISE EXCEPTION 'Invalid parent generation.'; END IF;

  FOR child IN SELECT * FROM jsonb_array_elements(children) LOOP
    IF jsonb_typeof(child) IS DISTINCT FROM 'object'
      OR jsonb_typeof(child->'full_name') IS DISTINCT FROM 'string'
      OR length(btrim(child->>'full_name')) NOT BETWEEN 1 AND 200
      OR jsonb_typeof(child->'gender') IS DISTINCT FROM 'string'
      OR child->>'gender' NOT IN ('male','female','other')
      THEN RAISE EXCEPTION 'Invalid child.'; END IF;
    FOR key, value IN SELECT * FROM jsonb_each(child) LOOP
      IF key NOT IN ('full_name','gender','birth_year','birth_month','birth_day','birth_order')
        THEN RAISE EXCEPTION 'Invalid child field.'; END IF;
      IF key IN ('birth_year','birth_month','birth_day','birth_order') AND value <> 'null'::jsonb AND (
        jsonb_typeof(value) <> 'number' OR value::text !~ '^[0-9]+$'
        OR length(value::text) > 5
      ) THEN RAISE EXCEPTION 'Invalid child date or birth order.'; END IF;
    END LOOP;
    child_year := (child->>'birth_year')::integer;
    child_month := (child->>'birth_month')::integer;
    child_day := (child->>'birth_day')::integer;
    IF (child_year IS NOT NULL AND child_year NOT BETWEEN 1 AND 9999)
      OR (child_month IS NOT NULL AND child_month NOT BETWEEN 1 AND 12)
      OR (child_day IS NOT NULL AND child_day NOT BETWEEN 1 AND 31)
      OR (child->>'birth_order' IS NOT NULL AND (child->>'birth_order')::integer NOT BETWEEN 1 AND 10000)
      THEN RAISE EXCEPTION 'Invalid child date or birth order.'; END IF;
    IF child_month IS NOT NULL AND child_day IS NOT NULL THEN
      PERFORM make_date(coalesce(child_year, 2000), child_month, child_day);
    END IF;
    INSERT INTO public.persons(full_name, gender, birth_year, birth_month, birth_day,
      birth_order, generation, is_in_law)
    VALUES (btrim(child->>'full_name'), (child->>'gender')::public.gender_enum,
      child_year, child_month, child_day, (child->>'birth_order')::integer,
      parent_generation + 1, false) RETURNING id INTO child_id;
    INSERT INTO public.relationships(person_a, person_b, type)
    VALUES (parent_id, child_id, 'biological_child');
    IF other_parent_id IS NOT NULL THEN
      INSERT INTO public.relationships(person_a, person_b, type)
      VALUES (other_parent_id, child_id, 'biological_child');
    END IF;
    ids := array_append(ids, child_id);
  END LOOP;
  RETURN ids;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_lineage_updates(changes jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE change jsonb; key text; value jsonb; affected integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF jsonb_typeof(changes) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid lineage changes.'; END IF;
  IF jsonb_array_length(changes) > 10000 THEN RAISE EXCEPTION 'Too many lineage changes.'; END IF;
  FOR change IN SELECT * FROM jsonb_array_elements(changes) LOOP
    IF jsonb_typeof(change) IS DISTINCT FROM 'object'
      OR jsonb_typeof(change->'id') IS DISTINCT FROM 'string'
      OR NOT (change ?& ARRAY['id','generation','birth_order','is_in_law'])
      OR jsonb_typeof(change->'is_in_law') IS DISTINCT FROM 'boolean'
      THEN RAISE EXCEPTION 'Invalid lineage change.'; END IF;
    FOR key, value IN SELECT * FROM jsonb_each(change) LOOP
      IF key NOT IN ('id','generation','birth_order','is_in_law') THEN RAISE EXCEPTION 'Invalid lineage field.'; END IF;
      IF key IN ('generation','birth_order') AND value <> 'null'::jsonb AND (
        jsonb_typeof(value) <> 'number' OR value::text !~ '^[0-9]+$'
        OR length(value::text) > 5
      ) THEN RAISE EXCEPTION 'Invalid lineage number.'; END IF;
      IF key IN ('generation','birth_order') AND value <> 'null'::jsonb
        AND (value::text)::integer NOT BETWEEN 1 AND 10000
        THEN RAISE EXCEPTION 'Invalid lineage number.'; END IF;
    END LOOP;
  END LOOP;
  LOCK TABLE public.persons IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(changes) c GROUP BY (c->>'id')::uuid HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(changes) c WHERE NOT EXISTS (
      SELECT 1 FROM public.persons p WHERE p.id = (c->>'id')::uuid AND p.family_branch_id IS NULL
    )) THEN RAISE EXCEPTION 'Missing, auxiliary or duplicate lineage person.'; END IF;
  UPDATE public.persons p SET generation = c.generation, birth_order = c.birth_order, is_in_law = c.is_in_law
  FROM jsonb_to_recordset(changes) AS c(id uuid, generation integer, birth_order integer, is_in_law boolean)
  WHERE p.id = c.id AND p.family_branch_id IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> jsonb_array_length(changes) THEN RAISE EXCEPTION 'Incomplete lineage update.'; END IF;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_descendant_generations(person_id uuid, generation_delta integer)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE affected integer;
BEGIN
  IF NOT (public.is_admin() OR public.is_editor()) THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF generation_delta IS NULL OR generation_delta NOT BETWEEN -100 AND 100
    THEN RAISE EXCEPTION 'Invalid generation delta.'; END IF;
  LOCK TABLE public.relationships IN SHARE MODE;
  LOCK TABLE public.persons IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = person_id AND p.family_branch_id IS NULL)
    THEN RAISE EXCEPTION 'Invalid person.'; END IF;
  WITH RECURSIVE descendants(id) AS (
    SELECT r.person_b FROM public.relationships r WHERE r.person_a = person_id
      AND r.family_branch_id IS NULL AND r.type IN ('biological_child','adopted_child')
    UNION
    SELECT r.person_b FROM public.relationships r JOIN descendants d ON r.person_a = d.id
      WHERE r.family_branch_id IS NULL AND r.type IN ('biological_child','adopted_child')
  ) UPDATE public.persons p SET generation = greatest(1, p.generation + generation_delta)
    WHERE p.id IN (SELECT id FROM descendants) AND p.id <> person_id
      AND p.family_branch_id IS NULL AND p.generation IS NOT NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.add_family_children(uuid,jsonb,uuid),
  public.apply_lineage_updates(jsonb), public.update_descendant_generations(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_family_children(uuid,jsonb,uuid),
  public.apply_lineage_updates(jsonb), public.update_descendant_generations(uuid,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
