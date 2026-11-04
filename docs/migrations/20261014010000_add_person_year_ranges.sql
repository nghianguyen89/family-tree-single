-- Preserve existing exact dates; estimates have their own nullable columns.
BEGIN;
ALTER TABLE public.persons
  ADD COLUMN IF NOT EXISTS birth_year_from INT,
  ADD COLUMN IF NOT EXISTS birth_year_to INT,
  ADD COLUMN IF NOT EXISTS death_year_from INT,
  ADD COLUMN IF NOT EXISTS death_year_to INT;
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_birth_year_range_check;
ALTER TABLE public.persons ADD CONSTRAINT persons_birth_year_range_check CHECK (
  (birth_year_from IS NULL AND birth_year_to IS NULL) OR
  (birth_year_from IS NOT NULL AND birth_year_to IS NOT NULL AND
   birth_year_from BETWEEN 1 AND 9999 AND birth_year_to BETWEEN birth_year_from AND 9999 AND birth_year IS NULL AND birth_month IS NULL AND birth_day IS NULL)
);
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_death_year_range_check;
ALTER TABLE public.persons ADD CONSTRAINT persons_death_year_range_check CHECK (
  (death_year_from IS NULL AND death_year_to IS NULL) OR
  (death_year_from IS NOT NULL AND death_year_to IS NOT NULL AND
   death_year_from BETWEEN 1 AND 9999 AND death_year_to BETWEEN death_year_from AND 9999 AND death_year IS NULL AND death_month IS NULL AND death_day IS NULL AND death_lunar_year IS NULL AND death_lunar_month IS NULL AND death_lunar_day IS NULL AND is_deceased)
);
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_year_range_chronology_check;
ALTER TABLE public.persons ADD CONSTRAINT persons_year_range_chronology_check CHECK (
  (birth_year_from IS NULL AND death_year_from IS NULL) OR
  COALESCE(death_year_to, death_year) IS NULL OR COALESCE(birth_year_from, birth_year) IS NULL OR
  COALESCE(death_year_to, death_year) >= COALESCE(birth_year_from, birth_year)
);
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
    id, full_name, gender, birth_year_from, birth_year_to, death_year_from, death_year_to, birth_year, birth_month, birth_day,
    death_year, death_month, death_day, death_lunar_year,
    death_lunar_month, death_lunar_day, is_deceased, is_in_law,
    birth_order, generation, other_names, avatar_url, note
  )
  SELECT id, full_name, gender, birth_year_from, birth_year_to, death_year_from, death_year_to, birth_year, birth_month, birth_day,
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

NOTIFY pgrst, 'reload schema';
COMMIT;
