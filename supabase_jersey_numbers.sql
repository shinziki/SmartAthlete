-- ==============================================================================
-- SmartAthlete: Jersey numbers
-- Run this script in your Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Safe to run more than once.
--
-- Coaches assign each athlete a basketball-style number: 0, 00, or 1-99.
-- No two athletes can hold the same number; NULL means "not assigned yet".
-- ==============================================================================

ALTER TABLE public.tbl_athletes ADD COLUMN IF NOT EXISTS jersey_number TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tbl_athletes_jersey_number_format'
      AND conrelid = 'public.tbl_athletes'::regclass
  ) THEN
    ALTER TABLE public.tbl_athletes
      ADD CONSTRAINT tbl_athletes_jersey_number_format
      CHECK (jersey_number IS NULL OR jersey_number ~ '^(0|00|[1-9][0-9]?)$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tbl_athletes_jersey_number_unique
  ON public.tbl_athletes (jersey_number)
  WHERE jersey_number IS NOT NULL;

-- If row-level security is enabled on tbl_athletes, coaches also need permission to
-- update other athletes' rows (at least the jersey_number column). Check your existing
-- UPDATE policy in Dashboard -> Authentication -> Policies.
