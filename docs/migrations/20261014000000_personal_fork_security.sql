-- New accounts never bootstrap themselves into administrators.
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, is_active)
  VALUES (NEW.id, 'member'::public.user_role_enum, false);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.handle_first_user_confirmation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$ BEGIN RETURN NEW; END; $$;

REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.handle_first_user_confirmation() FROM PUBLIC, anon, authenticated;

-- Members read images through /api/gallery. A Storage SELECT grant would also
-- allow them to mint bearer signed URLs that bypass later session checks.
DROP POLICY IF EXISTS "Active users can view gallery files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view gallery files" ON storage.objects;
CREATE POLICY "Admins can view gallery files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'gallery' AND public.is_admin());

-- One RPC call is one PostgreSQL transaction. Never catch insertion errors:
-- a bad row must roll back every preceding deletion and insertion.
CREATE OR REPLACE FUNCTION public.import_family_backup(payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;
  IF jsonb_typeof(payload->'persons') IS DISTINCT FROM 'array'
     OR jsonb_typeof(payload->'relationships') IS DISTINCT FROM 'array'
     OR jsonb_typeof(payload->'person_details_private') IS DISTINCT FROM 'array'
     OR jsonb_typeof(payload->'custom_events') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid backup arrays.';
  END IF;
  IF jsonb_array_length(payload->'persons') NOT BETWEEN 1 AND 10000
     OR jsonb_array_length(payload->'relationships') > 30000
     OR jsonb_array_length(payload->'person_details_private') > 10000
     OR jsonb_array_length(payload->'custom_events') > 10000 THEN
    RAISE EXCEPTION 'Backup exceeds import limits.';
  END IF;
  -- Serialize imports and block concurrent edits during the replacement.
  LOCK TABLE public.custom_events, public.relationships,
    public.person_details_private, public.persons IN SHARE ROW EXCLUSIVE MODE;
  DELETE FROM public.custom_events;
  DELETE FROM public.relationships;
  DELETE FROM public.person_details_private;
  DELETE FROM public.persons;

  INSERT INTO public.persons (
    id, full_name, gender, birth_year, birth_month, birth_day,
    death_year, death_month, death_day, death_lunar_year,
    death_lunar_month, death_lunar_day, is_deceased, is_in_law,
    birth_order, generation, other_names, avatar_url, note
  )
  SELECT id, full_name, gender, birth_year, birth_month, birth_day,
    death_year, death_month, death_day, death_lunar_year,
    death_lunar_month, death_lunar_day, is_deceased, is_in_law,
    birth_order, generation, other_names, avatar_url, note
  FROM jsonb_populate_recordset(NULL::public.persons, payload->'persons');

  INSERT INTO public.relationships (type, person_a, person_b, note)
  SELECT type, person_a, person_b, note
  FROM jsonb_populate_recordset(NULL::public.relationships, payload->'relationships');

  INSERT INTO public.person_details_private
    (person_id, phone_number, occupation, current_residence)
  SELECT person_id, phone_number, occupation, current_residence
  FROM jsonb_populate_recordset(NULL::public.person_details_private,
    payload->'person_details_private');

  INSERT INTO public.custom_events (id, name, content, event_date, location)
  SELECT id, name, content, event_date, location
  FROM jsonb_populate_recordset(NULL::public.custom_events, payload->'custom_events');
END;
$$;
REVOKE ALL ON FUNCTION public.import_family_backup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_family_backup(jsonb) TO authenticated;
