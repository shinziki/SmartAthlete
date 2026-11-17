-- ==============================================================================
-- SmartAthlete: Push notifications for new sessions
-- Run this script in your Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Safe to run more than once.
--
-- Athletes' phones register an Expo push token here when they sign in. When a coach
-- creates a session (mobile app or web dashboard), the database itself sends a push
-- notification to every registered athlete through Expo's push service, so athletes
-- are told even when the app is closed.
--
-- Android also needs Firebase set up for the app (google-services.json + the FCM key
-- uploaded to Expo); see the setup steps given with this change.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 1. One row per athlete phone
CREATE TABLE IF NOT EXISTS public.tbl_push_tokens (
    token       TEXT PRIMARY KEY,          -- ExponentPushToken[...]
    user_id     UUID,                      -- Supabase Auth user
    athlete_id  BIGINT,                    -- tbl_athletes.id
    platform    TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_athlete ON public.tbl_push_tokens (athlete_id);

-- Athletes manage only their own tokens; nobody else can read them
ALTER TABLE public.tbl_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push tokens: own insert" ON public.tbl_push_tokens;
CREATE POLICY "push tokens: own insert" ON public.tbl_push_tokens
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "push tokens: own update" ON public.tbl_push_tokens;
CREATE POLICY "push tokens: own update" ON public.tbl_push_tokens
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "push tokens: own delete" ON public.tbl_push_tokens;
CREATE POLICY "push tokens: own delete" ON public.tbl_push_tokens
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push tokens: own select" ON public.tbl_push_tokens;
CREATE POLICY "push tokens: own select" ON public.tbl_push_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- A phone that changes hands moves to the new athlete (token is the key)
CREATE OR REPLACE FUNCTION public.register_push_token(p_token TEXT, p_athlete_id BIGINT, p_platform TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.tbl_push_tokens (token, user_id, athlete_id, platform, updated_at)
  VALUES (p_token, auth.uid(), p_athlete_id, p_platform, now())
  ON CONFLICT (token) DO UPDATE
    SET user_id = auth.uid(), athlete_id = EXCLUDED.athlete_id,
        platform = EXCLUDED.platform, updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.register_push_token(TEXT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, BIGINT, TEXT) TO authenticated;

-- 2. Send "new session" pushes when a session is created
CREATE OR REPLACE FUNCTION public.sa_notify_new_session() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  body_text TEXT;
  batch JSONB;
BEGIN
  body_text := NEW.title
    || ' · ' || to_char(NEW.date, 'Mon DD')
    || CASE WHEN NEW.start_time IS NOT NULL AND NEW.start_time <> 'TBD' THEN ' · ' || NEW.start_time ELSE '' END
    || CASE WHEN NEW.location_type = 'at_home' THEN ' · 🏠 At Home'
            WHEN NEW.venue_name IS NOT NULL THEN ' · 📍 ' || NEW.venue_name
            ELSE '' END;

  -- Expo accepts up to 100 messages per request
  FOR batch IN
    SELECT jsonb_agg(jsonb_build_object(
             'to', token,
             'title', 'New training session 🏀',
             'body', body_text,
             'sound', 'default',
             'priority', 'high',
             'channelId', 'session-alerts',
             'data', jsonb_build_object('type', 'new_session', 'sessionId', NEW.id)
           ))
    FROM (
      SELECT token, (row_number() OVER (ORDER BY token) - 1) / 100 AS chunk
      FROM public.tbl_push_tokens
      WHERE athlete_id IS NOT NULL
    ) t
    GROUP BY chunk
  LOOP
    PERFORM net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := batch,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json')
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block creating the session because a notification failed
  RAISE WARNING 'SmartAthlete push failed: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_new_session ON public.tbl_sessions;
CREATE TRIGGER trg_notify_new_session
  AFTER INSERT ON public.tbl_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sa_notify_new_session();
