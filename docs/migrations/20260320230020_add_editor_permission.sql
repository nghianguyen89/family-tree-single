-- Create or replace function to check if user is an editor

ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_editor () returns boolean language plpgsql security definer
SET
  search_path = public AS $$
begin
  return exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'editor'
      and is_active = true
  );
end;
$$;

REVOKE ALL ON function public.is_editor ()
FROM
  public;

GRANT
EXECUTE ON function public.is_editor () TO authenticated;

-- Drop existing admin-only policies
DROP POLICY if EXISTS "Admins can insert persons" ON public.persons;

DROP POLICY if EXISTS "Admins can update persons" ON public.persons;

DROP POLICY if EXISTS "Admins can delete persons" ON public.persons;

DROP POLICY if EXISTS "Admins and Editors can insert persons" ON public.persons;

DROP POLICY if EXISTS "Admins and Editors can update persons" ON public.persons;

DROP POLICY if EXISTS "Admins and Editors can delete persons" ON public.persons;

-- INSERT
CREATE POLICY "Admins and Editors can insert persons" ON public.persons FOR insert TO authenticated
WITH
  CHECK (
    public.is_admin ()
    OR public.is_editor ()
  );

-- UPDATE
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

-- DELETE
CREATE POLICY "Admins and Editors can delete persons" ON public.persons FOR delete TO authenticated USING (
  public.is_admin ()
  OR public.is_editor ()
);

DROP POLICY if EXISTS "Admins can insert relationships" ON public.relationships;

DROP POLICY if EXISTS "Admins can update relationships" ON public.relationships;

DROP POLICY if EXISTS "Admins can delete relationships" ON public.relationships;

DROP POLICY if EXISTS "Admins and Editors can insert relationships" ON public.relationships;

DROP POLICY if EXISTS "Admins and Editors can update relationships" ON public.relationships;

DROP POLICY if EXISTS "Admins and Editors can delete relationships" ON public.relationships;

-- INSERT
CREATE POLICY "Admins and Editors can insert relationships" ON public.relationships FOR insert TO authenticated
WITH
  CHECK (
    public.is_admin ()
    OR public.is_editor ()
  );

-- UPDATE
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

-- DELETE
CREATE POLICY "Admins and Editors can delete relationships" ON public.relationships FOR delete TO authenticated USING (
  public.is_admin ()
  OR public.is_editor ()
);
