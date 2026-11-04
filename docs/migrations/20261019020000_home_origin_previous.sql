-- Keep current and pre-merger origin addresses independently, including newlines.
BEGIN;
ALTER TABLE public.home_settings ADD COLUMN IF NOT EXISTS origin_previous text NOT NULL DEFAULT '';
ALTER TABLE public.home_settings DROP CONSTRAINT IF EXISTS home_settings_origin_previous_check;
ALTER TABLE public.home_settings ADD CONSTRAINT home_settings_origin_previous_check
  CHECK (length(origin_previous) <= 300);
NOTIFY pgrst, 'reload schema';
COMMIT;
