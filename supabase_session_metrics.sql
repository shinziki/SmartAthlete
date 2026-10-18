-- ==============================================================================
-- SmartAthlete: Completed session metrics (incl. Player Load AU)
-- Run this script in your Supabase SQL Editor (Dashboard -> SQL Editor -> New query)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.tbl_session_metrics (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT REFERENCES public.tbl_sessions(id) ON DELETE SET NULL,
    athlete_id BIGINT REFERENCES public.tbl_athletes(id) ON DELETE CASCADE,
    session_title TEXT,
    player_load_au DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_seconds INTEGER DEFAULT 0,
    steps INTEGER DEFAULT 0,
    meters DOUBLE PRECISION DEFAULT 0,
    jumps INTEGER DEFAULT 0,
    avg_heart_rate INTEGER DEFAULT 0,
    max_heart_rate INTEGER DEFAULT 0,
    calories_burned INTEGER DEFAULT 0,
    watch_name TEXT,
    drill_breakdown JSONB DEFAULT '[]'::jsonb,
    completed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_athlete ON public.tbl_session_metrics(athlete_id);
CREATE INDEX IF NOT EXISTS idx_metrics_session ON public.tbl_session_metrics(session_id);

ALTER TABLE public.tbl_session_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read tbl_session_metrics"
    ON public.tbl_session_metrics FOR SELECT USING (true);
CREATE POLICY "Allow public insert tbl_session_metrics"
    ON public.tbl_session_metrics FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update tbl_session_metrics"
    ON public.tbl_session_metrics FOR UPDATE USING (true);
CREATE POLICY "Allow public delete tbl_session_metrics"
    ON public.tbl_session_metrics FOR DELETE USING (true);
