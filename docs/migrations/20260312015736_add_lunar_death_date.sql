-- Add lunar death date fields to persons table

ALTER TABLE "public"."persons"
  ADD COLUMN IF NOT EXISTS "death_lunar_day" smallint,
  ADD COLUMN IF NOT EXISTS "death_lunar_month" smallint,
  ADD COLUMN IF NOT EXISTS "death_lunar_year" smallint;
