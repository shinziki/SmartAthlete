-- ==============================================================================
-- SmartAthlete: Live session progress & offline sync status
-- Run this script in your Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Safe to run more than once.
--
-- One row per athlete per session. The athlete's phone updates it when the session
-- starts, after every drill, every minute while online, and when the session ends.
-- Without internet the phone keeps tracking, stores the latest progress locally and
-- uploads it automatically once the connection returns.
--
-- The coach reads it to show:
--   Live          in_progress and synced within the last few minutes
--   Pending sync  in_progress but the phone has gone quiet (data buffered on the phone)
--   Synced        completed and uploaded
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.tbl_session_progress (
    session_id        BIGINT NOT NULL,
    athlete_id        BIGINT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'in_progress'
                      CHECK (status IN ('in_progress', 'completed')),
    drills_completed  INTEGER NOT NULL DEFAULT 0,
    total_drills      INTEGER NOT NULL DEFAULT 0,
    current_drill     TEXT,
    elapsed_seconds   INTEGER NOT NULL DEFAULT 0,
    player_load_au    DOUBLE PRECISION NOT NULL DEFAULT 0,
    drill_breakdown   JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- When the phone recorded this snapshot (may be long before it could upload)
    recorded_at       TIMESTAMPTZ NOT NULL,
    -- When the server received it; set by the database, not the phone's clock
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, athlete_id)
);

-- Stamps the server's receive time. Uploads can arrive out of order (a buffered
-- snapshot flushed after a newer live one), so older snapshots are ignored and a
-- completed session never goes back to in_progress.
CREATE OR REPLACE FUNCTION public.sa_touch_synced_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.recorded_at < OLD.recorded_at
       OR (OLD.status = 'completed' AND NEW.status <> 'completed')
     ) THEN
    RETURN OLD;
  END IF;
  NEW.synced_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_session_progress_synced_at ON public.tbl_session_progress;
CREATE TRIGGER trg_session_progress_synced_at
  BEFORE INSERT OR UPDATE ON public.tbl_session_progress
  FOR EACH ROW EXECUTE FUNCTION public.sa_touch_synced_at();

CREATE INDEX IF NOT EXISTS idx_session_progress_session ON public.tbl_session_progress (session_id);

-- Access mirrors the other session tables. If you use row-level security, allow
-- athletes to insert/update their own rows and coaches to read all rows.

-- ── Venue boundary (added later; re-running this file adds the columns) ──
-- Where the athlete is relative to the session's venue area, for the coach's roster:
--   inside | near_edge | outside | stopped (session auto-stopped for leaving)
ALTER TABLE public.tbl_session_progress ADD COLUMN IF NOT EXISTS boundary_status TEXT;
-- Distance (m) from the venue center when the status last changed
ALTER TABLE public.tbl_session_progress ADD COLUMN IF NOT EXISTS boundary_meters INTEGER;
