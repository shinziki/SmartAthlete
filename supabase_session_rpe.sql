-- Adds session RPE (CR-10) so Session Load (AU) = RPE x duration (min) can be audited.
-- Run in Supabase SQL Editor.
ALTER TABLE public.tbl_session_metrics
    ADD COLUMN IF NOT EXISTS session_rpe DOUBLE PRECISION;
