-- Only unfinished submissions can be removed. Approved/rejected review history stays.
-- PostgreSQL rechecks this predicate after concurrent updates, including approval.
BEGIN;

DROP POLICY IF EXISTS "Editors delete unfinished intake submissions" ON public.family_intake_submissions;
CREATE POLICY "Editors delete unfinished intake submissions"
ON public.family_intake_submissions FOR DELETE TO authenticated
USING (
  (public.is_admin() OR public.is_editor())
  AND status IN ('pending', 'needs_info')
);

GRANT DELETE ON public.family_intake_submissions TO authenticated;

COMMIT;
