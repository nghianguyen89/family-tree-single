-- Public intake is staged. Only an active admin/editor can publish a family.
BEGIN;
ALTER TABLE public.persons
  ADD COLUMN IF NOT EXISTS memorial_day int,
  ADD COLUMN IF NOT EXISTS memorial_month int,
  ADD COLUMN IF NOT EXISTS memorial_calendar text,
  ADD COLUMN IF NOT EXISTS memorial_is_leap_month boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS memorial_note text;
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_memorial_check;
ALTER TABLE public.persons ADD CONSTRAINT persons_memorial_check CHECK (
  (memorial_day IS NULL AND memorial_month IS NULL AND memorial_calendar IS NULL AND NOT memorial_is_leap_month AND memorial_note IS NULL) OR
  (is_deceased AND memorial_day IS NOT NULL AND memorial_month IS NOT NULL AND memorial_calendar IS NOT NULL
   AND memorial_month BETWEEN 1 AND 12 AND memorial_day >= 1 AND length(COALESCE(memorial_note, '')) <= 1000
   AND ((memorial_calendar = 'lunar' AND memorial_day <= 30) OR
        (memorial_calendar = 'solar' AND NOT memorial_is_leap_month AND
         memorial_day <= CASE memorial_month WHEN 2 THEN 29 WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END)))
);

CREATE TABLE IF NOT EXISTS public.family_intake_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{32}$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  -- Do not cascade-delete collection history during full backup replacement.
  -- Creation checks existence; a deleted root makes public lookup unavailable.
  root_person_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.family_intake_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.family_intake_links(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  reviewed_payload jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'needs_info', 'approved', 'rejected')),
  reviewer_note text CHECK (length(reviewer_note) <= 2000),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  approved_person_ids uuid[],
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_family_intake_submissions_queue ON public.family_intake_submissions(status, created_at DESC);
ALTER TABLE public.family_intake_submissions ADD COLUMN IF NOT EXISTS reviewed_payload jsonb;
CREATE INDEX IF NOT EXISTS idx_family_intake_submissions_limit ON public.family_intake_submissions(link_id, created_at);
ALTER TABLE public.family_intake_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_intake_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Editors manage intake links" ON public.family_intake_links;
DROP POLICY IF EXISTS "Editors read intake links" ON public.family_intake_links;
CREATE POLICY "Editors read intake links" ON public.family_intake_links FOR SELECT TO authenticated USING (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Editors create intake links" ON public.family_intake_links;
CREATE POLICY "Editors create intake links" ON public.family_intake_links FOR INSERT TO authenticated
  WITH CHECK ((public.is_admin() OR public.is_editor()) AND created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.persons p WHERE p.id = root_person_id));
DROP POLICY IF EXISTS "Editors disable intake links" ON public.family_intake_links;
CREATE POLICY "Editors disable intake links" ON public.family_intake_links FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_editor()) WITH CHECK (public.is_admin() OR public.is_editor());
DROP POLICY IF EXISTS "Editors read intake submissions" ON public.family_intake_submissions;
CREATE POLICY "Editors read intake submissions" ON public.family_intake_submissions FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_editor());
REVOKE ALL ON public.family_intake_links, public.family_intake_submissions FROM anon, authenticated;
GRANT SELECT, INSERT ON public.family_intake_links TO authenticated;
GRANT UPDATE (is_active) ON public.family_intake_links TO authenticated;
GRANT SELECT ON public.family_intake_submissions TO authenticated;
GRANT ALL ON public.family_intake_links, public.family_intake_submissions TO service_role;

CREATE OR REPLACE FUNCTION private.validate_family_intake(payload jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  item jsonb; data jsonb; value jsonb; seen text[] := ARRAY['anchor'];
  prefix text; field text; y int; m int; d int; lo int; hi int;
  person public.persons;
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text) > 65536
     OR COALESCE(payload->>'anchor_id', '') !~ '^[0-9a-fA-F-]{36}$'
     OR jsonb_typeof(payload->'sender_name') IS DISTINCT FROM 'string'
     OR length(btrim(payload->>'sender_name')) NOT BETWEEN 1 AND 200
     OR jsonb_typeof(payload->'sender_contact') IS DISTINCT FROM 'string'
     OR length(btrim(payload->>'sender_contact')) NOT BETWEEN 1 AND 200
     OR jsonb_typeof(payload->'note') IS DISTINCT FROM 'string' OR length(payload->>'note') > 2000
     OR jsonb_typeof(payload->'people') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid family submission.';
  END IF;
  PERFORM (payload->>'anchor_id')::uuid;
  IF jsonb_array_length(payload->'people') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'A family must contain 1 to 30 people.'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(payload->'people') LOOP
    IF COALESCE(item->>'client_id', '') !~ '^[0-9a-fA-F-]{36}$' OR item->>'client_id' = ANY(seen)
       OR COALESCE(item->>'relation', '') NOT IN ('child', 'spouse', 'self')
       OR NOT COALESCE(item->>'relative_to' = ANY(seen), false) THEN RAISE EXCEPTION 'Invalid family relationship.'; END IF;
    PERFORM (item->>'client_id')::uuid;
    IF item->>'generation' IS NOT NULL AND (jsonb_typeof(item->'generation') <> 'number' OR (item->>'generation') !~ '^[0-9]{1,5}$' OR (item->>'generation')::int NOT BETWEEN 1 AND 10000) THEN RAISE EXCEPTION 'Invalid reviewed generation.'; END IF;
    IF item->>'relation' = 'self' AND (item->>'relative_to' <> 'anchor' OR item->>'other_parent_ref' IS NOT NULL) THEN RAISE EXCEPTION 'Invalid existing person relationship.'; END IF;
    IF item->>'other_parent_ref' IS NOT NULL AND
       (item->>'relation' <> 'child' OR NOT (item->>'other_parent_ref' = ANY(seen)) OR item->>'other_parent_ref' = item->>'relative_to') THEN RAISE EXCEPTION 'Invalid second parent.'; END IF;
    data := item->'data';
    IF jsonb_typeof(data) IS DISTINCT FROM 'object' OR jsonb_typeof(data->'full_name') IS DISTINCT FROM 'string'
       OR length(btrim(data->>'full_name')) NOT BETWEEN 1 AND 200
       OR COALESCE(data->>'gender', '') NOT IN ('male', 'female', 'other')
       OR jsonb_typeof(data->'is_deceased') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid person details.'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(data) k WHERE k NOT IN (
      'full_name','gender','birth_year','birth_month','birth_day','birth_year_from','birth_year_to',
      'death_year','death_month','death_day','death_year_from','death_year_to',
      'death_lunar_year','death_lunar_month','death_lunar_day','is_deceased','other_names','note',
      'memorial_day','memorial_month','memorial_calendar','memorial_is_leap_month','memorial_note'
    )) THEN RAISE EXCEPTION 'Unsupported person field.'; END IF;
    FOREACH field IN ARRAY ARRAY['other_names','note','memorial_note'] LOOP
      IF data->>field IS NOT NULL AND (jsonb_typeof(data->field) <> 'string' OR length(data->>field) > CASE WHEN field = 'memorial_note' THEN 1000 ELSE 2000 END) THEN RAISE EXCEPTION 'Invalid note.'; END IF;
    END LOOP;
    FOREACH prefix IN ARRAY ARRAY['birth', 'death', 'death_lunar'] LOOP
      FOREACH field IN ARRAY ARRAY[prefix||'_year', prefix||'_month', prefix||'_day'] LOOP
        value := data->field;
        IF value IS NOT NULL AND value <> 'null'::jsonb AND (jsonb_typeof(value) <> 'number' OR value::text !~ '^[0-9]{1,4}$' OR (value::text)::int < 1) THEN RAISE EXCEPTION 'Invalid date component.'; END IF;
      END LOOP;
      y := (data->>(prefix||'_year'))::int; m := (data->>(prefix||'_month'))::int; d := (data->>(prefix||'_day'))::int;
      IF m NOT BETWEEN 1 AND 12 OR d NOT BETWEEN 1 AND (CASE WHEN prefix = 'death_lunar' THEN 30 ELSE 31 END) THEN RAISE EXCEPTION 'Invalid date.'; END IF;
      IF prefix <> 'death_lunar' AND m IS NOT NULL AND d IS NOT NULL THEN PERFORM make_date(COALESCE(y, 2000), m, d); END IF;
    END LOOP;
    FOREACH prefix IN ARRAY ARRAY['birth','death'] LOOP
      FOREACH field IN ARRAY ARRAY[prefix||'_year_from', prefix||'_year_to'] LOOP
        value := data->field;
        IF value IS NOT NULL AND value <> 'null'::jsonb AND (jsonb_typeof(value) <> 'number' OR value::text !~ '^[0-9]{1,4}$') THEN RAISE EXCEPTION 'Invalid year range.'; END IF;
      END LOOP;
      lo := (data->>(prefix||'_year_from'))::int; hi := (data->>(prefix||'_year_to'))::int;
      IF lo IS NOT NULL OR hi IS NOT NULL THEN
        IF lo IS NULL OR hi IS NULL OR lo < 1 OR hi < lo OR hi > 9999 OR
          data->>(prefix||'_year') IS NOT NULL OR data->>(prefix||'_month') IS NOT NULL OR data->>(prefix||'_day') IS NOT NULL OR
          (prefix = 'death' AND (data->>'death_lunar_year' IS NOT NULL OR data->>'death_lunar_month' IS NOT NULL OR data->>'death_lunar_day' IS NOT NULL)) THEN RAISE EXCEPTION 'Invalid year range.'; END IF;
      END IF;
    END LOOP;
    FOREACH field IN ARRAY ARRAY['memorial_day', 'memorial_month'] LOOP
      value := data->field;
      IF value IS NOT NULL AND value <> 'null'::jsonb AND (jsonb_typeof(value) <> 'number' OR value::text !~ '^[0-9]{1,2}$') THEN RAISE EXCEPTION 'Invalid memorial date component.'; END IF;
    END LOOP;
    person := jsonb_populate_record(NULL::public.persons, data);
    IF NOT person.is_deceased AND EXISTS (SELECT 1 FROM jsonb_each(data) v WHERE v.key LIKE 'death_%' AND v.value <> 'null'::jsonb) THEN RAISE EXCEPTION 'Living person has death information.'; END IF;
    IF COALESCE(person.death_year_to, person.death_year) < COALESCE(person.birth_year_from, person.birth_year) THEN RAISE EXCEPTION 'Death precedes birth.'; END IF;
    IF data->>'memorial_is_leap_month' IS NOT NULL AND jsonb_typeof(data->'memorial_is_leap_month') <> 'boolean' THEN RAISE EXCEPTION 'Invalid leap month flag.'; END IF;
    IF person.memorial_day IS NOT NULL OR person.memorial_month IS NOT NULL OR person.memorial_calendar IS NOT NULL THEN
      IF NOT person.is_deceased OR person.memorial_day IS NULL OR person.memorial_month IS NULL OR
         COALESCE(person.memorial_calendar, '') NOT IN ('solar','lunar') OR person.memorial_month NOT BETWEEN 1 AND 12 OR person.memorial_day < 1 THEN RAISE EXCEPTION 'Invalid memorial date.'; END IF;
      IF person.memorial_calendar = 'lunar' THEN
        IF person.memorial_day > 30 THEN RAISE EXCEPTION 'Invalid lunar memorial date.'; END IF;
      ELSE
        IF COALESCE(person.memorial_is_leap_month, false) THEN RAISE EXCEPTION 'Solar memorial cannot use a leap month.'; END IF;
        PERFORM make_date(2000, person.memorial_month, person.memorial_day);
      END IF;
    ELSIF COALESCE(person.memorial_is_leap_month, false) OR person.memorial_note IS NOT NULL THEN RAISE EXCEPTION 'Memorial date is missing.';
    END IF;
    seen := array_append(seen, item->>'client_id');
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_family_intake(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_family_intake_options(link_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE link public.family_intake_links; people jsonb;
BEGIN
  IF link_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO link FROM public.family_intake_links WHERE token_hash = md5(link_token) AND is_active AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.persons WHERE id = link.root_person_id) THEN RETURN NULL; END IF;
  WITH RECURSIVE branch(id) AS (
    SELECT link.root_person_id
    UNION
    SELECT r.person_b FROM public.relationships r JOIN branch b ON r.person_a = b.id WHERE r.type IN ('biological_child','adopted_child')
  ), choices AS (
    SELECT p.id, p.full_name, p.generation FROM public.persons p JOIN branch b ON p.id = b.id
    ORDER BY (p.id = link.root_person_id) DESC, p.generation NULLS LAST, p.full_name, p.id LIMIT 500
  ) SELECT COALESCE(jsonb_agg(to_jsonb(choices)), '[]'::jsonb) INTO people FROM choices;
  RETURN jsonb_build_object('title', link.title, 'root_id', link.root_person_id, 'people', people);
END;
$$;
REVOKE ALL ON FUNCTION public.get_family_intake_options(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_family_intake_options(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_family_intake(link_token text, submission jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE link public.family_intake_links; receipt uuid; clean jsonb; row jsonb; members jsonb := '[]';
BEGIN
  IF link_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid or expired collection link.'; END IF;
  SELECT * INTO link FROM public.family_intake_links WHERE token_hash = md5(link_token) AND is_active AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired collection link.'; END IF;
  PERFORM private.validate_family_intake(submission);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_family_intake_options(link_token)->'people') p WHERE p->>'id' = submission->>'anchor_id') THEN RAISE EXCEPTION 'Selected person is outside this branch.'; END IF;
  -- Link lock serializes the quota and insert across processes, including direct RPC calls.
  IF (SELECT count(*) FROM public.family_intake_submissions WHERE link_id = link.id AND created_at > now() - interval '1 hour') >= 30
     OR (SELECT count(*) FROM public.family_intake_submissions WHERE link_id = link.id AND created_at > now() - interval '1 day') >= 100
     OR (SELECT count(*) FROM public.family_intake_submissions WHERE link_id = link.id) >= 1000 THEN RAISE EXCEPTION 'Collection limit reached. Please contact the family administrator.'; END IF;
  FOR row IN SELECT * FROM jsonb_array_elements(submission->'people') LOOP
    members := members || jsonb_build_array(jsonb_build_object('client_id', row->'client_id', 'relation', row->'relation', 'relative_to', row->'relative_to', 'other_parent_ref', row->'other_parent_ref', 'data', row->'data'));
  END LOOP;
  clean := jsonb_build_object('anchor_id', submission->'anchor_id', 'sender_name', btrim(submission->>'sender_name'), 'sender_contact', btrim(submission->>'sender_contact'), 'note', submission->'note', 'people', members);
  INSERT INTO public.family_intake_submissions(link_id, payload) VALUES (link.id, clean) RETURNING id INTO receipt;
  RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_family_intake(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_family_intake(text,jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.review_family_intake(submission_id uuid, decision text, review_payload jsonb, review_note text DEFAULT '')
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  queued public.family_intake_submissions; item jsonb; data public.persons;
  ids jsonb; person_id uuid; relative_id uuid; other_parent uuid; parent_generation int; new_generation int;
  mapped uuid[] := ARRAY[]::uuid[]; updated uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT (public.is_admin() OR public.is_editor()) THEN RAISE EXCEPTION 'Access denied.'; END IF;
  IF COALESCE(decision, '') NOT IN ('approved','rejected','needs_info') OR length(COALESCE(review_note, '')) > 2000 THEN RAISE EXCEPTION 'Invalid review decision.'; END IF;
  IF decision <> 'approved' AND length(btrim(COALESCE(review_note, ''))) = 0 THEN RAISE EXCEPTION 'Please explain the review decision.'; END IF;
  SELECT * INTO queued FROM public.family_intake_submissions WHERE id = submission_id FOR UPDATE;
  IF NOT FOUND OR queued.status NOT IN ('pending','needs_info') THEN RAISE EXCEPTION 'Submission is missing or already reviewed.'; END IF;
  IF decision = 'approved' THEN
    PERFORM private.validate_family_intake(review_payload);
    -- Serialize publishing against concurrent approvals/edits and backup replacement.
    LOCK TABLE public.relationships, public.persons IN SHARE ROW EXCLUSIVE MODE;
    IF NOT EXISTS (SELECT 1 FROM public.persons WHERE id = (review_payload->>'anchor_id')::uuid) THEN RAISE EXCEPTION 'Anchor person no longer exists.'; END IF;
    ids := jsonb_build_object('anchor', review_payload->>'anchor_id');
    FOR item IN SELECT * FROM jsonb_array_elements(review_payload->'people') LOOP
      relative_id := (ids->>(item->>'relative_to'))::uuid;
      SELECT generation INTO parent_generation FROM public.persons WHERE id = relative_id;
      data := jsonb_populate_record(NULL::public.persons, item->'data');
      person_id := (item->>'existing_person_id')::uuid;
      IF item->>'relation' = 'self' THEN
        IF person_id IS NOT NULL AND person_id <> relative_id THEN RAISE EXCEPTION 'Existing person must match the selected anchor.'; END IF;
        person_id := relative_id;
      END IF;
      IF person_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.persons WHERE id = person_id) THEN RAISE EXCEPTION 'Matched person no longer exists.'; END IF;
        IF (item->>'update_existing')::boolean IS TRUE THEN
          IF person_id = ANY(updated) THEN RAISE EXCEPTION 'The same existing person cannot be updated twice.'; END IF;
          UPDATE public.persons SET full_name = btrim(data.full_name), gender = data.gender,
            birth_year = data.birth_year, birth_month = data.birth_month, birth_day = data.birth_day,
            birth_year_from = data.birth_year_from, birth_year_to = data.birth_year_to,
            death_year = data.death_year, death_month = data.death_month, death_day = data.death_day,
            death_year_from = data.death_year_from, death_year_to = data.death_year_to,
            death_lunar_year = data.death_lunar_year, death_lunar_month = data.death_lunar_month, death_lunar_day = data.death_lunar_day,
            is_deceased = data.is_deceased, other_names = data.other_names, note = data.note,
            memorial_day = data.memorial_day, memorial_month = data.memorial_month, memorial_calendar = data.memorial_calendar,
            memorial_is_leap_month = COALESCE(data.memorial_is_leap_month, false), memorial_note = data.memorial_note
          WHERE id = person_id;
          updated := array_append(updated, person_id);
        END IF;
      ELSE
        new_generation := CASE WHEN item->>'relation' = 'child' THEN parent_generation + 1 ELSE parent_generation END;
        IF item->>'generation' IS NOT NULL THEN
          IF new_generation IS NOT NULL AND new_generation <> (item->>'generation')::int THEN RAISE EXCEPTION 'Reviewed generation conflicts with the selected parent or spouse.'; END IF;
          new_generation := (item->>'generation')::int;
        END IF;
        IF new_generation IS NULL THEN RAISE EXCEPTION 'Set the reviewed generation because the selected relative has no generation.'; END IF;
        IF new_generation NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid reviewed generation.'; END IF;
        IF (item->>'confirm_new')::boolean IS NOT TRUE AND EXISTS (SELECT 1 FROM public.persons p WHERE lower(btrim(p.full_name)) = lower(btrim(data.full_name))) THEN RAISE EXCEPTION 'Possible duplicate. Match an existing person or confirm a new person.'; END IF;
        INSERT INTO public.persons(full_name, gender, birth_year, birth_month, birth_day, birth_year_from, birth_year_to,
          death_year, death_month, death_day, death_year_from, death_year_to, death_lunar_year, death_lunar_month, death_lunar_day,
          is_deceased, other_names, note, generation, is_in_law, memorial_day, memorial_month, memorial_calendar, memorial_is_leap_month, memorial_note)
        VALUES (btrim(data.full_name), data.gender, data.birth_year, data.birth_month, data.birth_day, data.birth_year_from, data.birth_year_to,
          data.death_year, data.death_month, data.death_day, data.death_year_from, data.death_year_to, data.death_lunar_year, data.death_lunar_month, data.death_lunar_day,
          data.is_deceased, data.other_names, data.note, new_generation,
          item->>'relation' = 'spouse', data.memorial_day, data.memorial_month, data.memorial_calendar, COALESCE(data.memorial_is_leap_month, false), data.memorial_note)
        RETURNING id INTO person_id;
      END IF;
      IF item->>'relation' <> 'self' THEN
        IF person_id = relative_id THEN RAISE EXCEPTION 'A person cannot be their own relative.'; END IF;
        IF item->>'relation' = 'child' THEN
          other_parent := (ids->>(item->>'other_parent_ref'))::uuid;
          IF person_id = other_parent OR other_parent = relative_id THEN RAISE EXCEPTION 'Invalid second parent.'; END IF;
          -- Prevent adding an ancestor as a child, including paths added earlier in this transaction.
          IF EXISTS (WITH RECURSIVE descendants(id) AS (
            SELECT person_id UNION SELECT r.person_b FROM public.relationships r JOIN descendants d ON r.person_a = d.id WHERE r.type IN ('biological_child','adopted_child')
          ) SELECT 1 FROM descendants WHERE id = relative_id OR id = other_parent) THEN RAISE EXCEPTION 'Relationship would create an ancestry cycle.'; END IF;
          INSERT INTO public.relationships(type,person_a,person_b) VALUES ('biological_child',relative_id,person_id) ON CONFLICT DO NOTHING;
          IF other_parent IS NOT NULL THEN INSERT INTO public.relationships(type,person_a,person_b) VALUES ('biological_child',other_parent,person_id) ON CONFLICT DO NOTHING; END IF;
        ELSIF NOT EXISTS (SELECT 1 FROM public.relationships WHERE type = 'marriage' AND ((person_a=relative_id AND person_b=person_id) OR (person_a=person_id AND person_b=relative_id))) THEN
          INSERT INTO public.relationships(type,person_a,person_b) VALUES ('marriage',relative_id,person_id) ON CONFLICT DO NOTHING;
        END IF;
      END IF;
      ids := ids || jsonb_build_object(item->>'client_id', person_id);
      mapped := array_append(mapped, person_id);
    END LOOP;
  END IF;
  UPDATE public.family_intake_submissions SET status = decision, reviewed_payload = CASE WHEN decision = 'approved' THEN review_payload ELSE reviewed_payload END,
    reviewer_note = NULLIF(btrim(review_note), ''), reviewed_by = auth.uid(), reviewed_at = now(),
    approved_person_ids = CASE WHEN decision = 'approved' THEN mapped ELSE NULL END WHERE id = queued.id;
  RETURN mapped;
END;
$$;
REVOKE ALL ON FUNCTION public.review_family_intake(uuid,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_family_intake(uuid,text,jsonb,text) TO authenticated;
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
    birth_order, generation, other_names, avatar_url, note, memorial_day, memorial_month, memorial_calendar, memorial_is_leap_month, memorial_note
  )
  SELECT id, full_name, gender, birth_year_from, birth_year_to, death_year_from, death_year_to, birth_year, birth_month, birth_day,
    death_year, death_month, death_day, death_lunar_year,
    death_lunar_month, death_lunar_day, is_deceased, is_in_law,
    birth_order, generation, other_names, avatar_url, note, memorial_day, memorial_month, memorial_calendar, COALESCE(memorial_is_leap_month, false), memorial_note
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
