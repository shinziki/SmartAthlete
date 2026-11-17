-- ==============================================================================
-- SmartAthlete: How each athlete's session ended
-- Run this script in your Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Safe to run more than once.
--
-- end_reason on each saved session result, shown on the coach's session roster:
--   completed    every drill finished
--   ended_early  the athlete stopped before the plan finished
--   left_venue   auto-stopped for staying outside the venue area
-- Older rows stay NULL; the app estimates them from drills and time.
-- ==============================================================================

ALTER TABLE public.tbl_session_metrics ADD COLUMN IF NOT EXISTS end_reason TEXT;
