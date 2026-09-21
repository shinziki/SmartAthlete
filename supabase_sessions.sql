-- ==============================================================================
-- SmartAthlete: Sessions & Athlete Acceptance Schema Migration
-- Run this script in your Supabase SQL Editor (Dashboard -> SQL Editor -> New query)
-- ==============================================================================

-- 1. Create Sessions Table
CREATE TABLE IF NOT EXISTS public.tbl_sessions (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    session_type TEXT NOT NULL DEFAULT 'training', -- 'training', 'sc', 'scrimmage'
    date DATE NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location_type TEXT NOT NULL DEFAULT 'venue', -- 'venue', 'at_home'
    venue_name TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    geofence_radius INTEGER DEFAULT 40,
    drills JSONB DEFAULT '[]'::jsonb,
    total_duration_minutes INTEGER DEFAULT 0,
    coach_id BIGINT REFERENCES public.tbl_coaches(id) ON DELETE SET NULL,
    coach_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Session Attendees / Acceptance Table
CREATE TABLE IF NOT EXISTS public.tbl_session_attendees (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES public.tbl_sessions(id) ON DELETE CASCADE,
    athlete_id BIGINT NOT NULL REFERENCES public.tbl_athletes(id) ON DELETE CASCADE,
    athlete_name TEXT NOT NULL,
    username TEXT,
    status TEXT NOT NULL DEFAULT 'accepted', -- 'accepted', 'attended', 'declined'
    accepted_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_session_athlete UNIQUE (session_id, athlete_id)
);

-- 3. Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_sessions_date ON public.tbl_sessions(date DESC);
CREATE INDEX IF NOT EXISTS idx_attendees_session ON public.tbl_session_attendees(session_id);
CREATE INDEX IF NOT EXISTS idx_attendees_athlete ON public.tbl_session_attendees(athlete_id);

-- 4. Enable RLS and permissive policies matching tbl_athletes / tbl_coaches
ALTER TABLE public.tbl_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tbl_session_attendees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read tbl_sessions" 
    ON public.tbl_sessions FOR SELECT 
    USING (true);

CREATE POLICY "Allow public insert tbl_sessions" 
    ON public.tbl_sessions FOR INSERT 
    WITH CHECK (true);

CREATE POLICY "Allow public update tbl_sessions" 
    ON public.tbl_sessions FOR UPDATE 
    USING (true);

CREATE POLICY "Allow public delete tbl_sessions" 
    ON public.tbl_sessions FOR DELETE 
    USING (true);

CREATE POLICY "Allow public read tbl_session_attendees" 
    ON public.tbl_session_attendees FOR SELECT 
    USING (true);

CREATE POLICY "Allow public insert tbl_session_attendees" 
    ON public.tbl_session_attendees FOR INSERT 
    WITH CHECK (true);

CREATE POLICY "Allow public update tbl_session_attendees" 
    ON public.tbl_session_attendees FOR UPDATE 
    USING (true);

CREATE POLICY "Allow public delete tbl_session_attendees" 
    ON public.tbl_session_attendees FOR DELETE 
    USING (true);
