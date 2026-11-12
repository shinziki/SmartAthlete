-- ==============================================================================
-- SmartAthlete: Personal data protection
-- Run this script in your Supabase SQL Editor (Dashboard -> SQL Editor -> New query)
-- BEFORE installing the app versions that use it. Safe to run more than once.
--
-- After this runs:
--   * names are stored masked:   "John"               -> "J*****"
--   * emails are stored masked:  "John.Doe@gmail.com" -> "j*****@gmail.com"
--   * rows are found by email_hash = sha256(lower(trim(email)))
--   * passwords are stored as   'sha256$' || salt || '$' || sha256(salt || ':' || password)
--     with a random 16-hex-character salt per password
-- Real names and emails remain in Supabase Auth (auth.users) only.
-- The formulas must match Mobile/lib/privacy.ts and Web/src/privacy.js.
--
-- Note: rows whose email is masked can't be converted again, so take a backup first
-- (Dashboard -> Database -> Backups) if you want to keep the plain-text originals.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1. Lookup column (filled from the still-plain email before it is masked)
ALTER TABLE public.tbl_athletes ADD COLUMN IF NOT EXISTS email_hash TEXT;
ALTER TABLE public.tbl_coaches  ADD COLUMN IF NOT EXISTS email_hash TEXT;

UPDATE public.tbl_athletes
SET email_hash = encode(extensions.digest(lower(trim(email)), 'sha256'), 'hex')
WHERE email_hash IS NULL AND email IS NOT NULL AND email NOT LIKE '_*****@%';

UPDATE public.tbl_coaches
SET email_hash = encode(extensions.digest(lower(trim(email)), 'sha256'), 'hex')
WHERE email_hash IS NULL AND email IS NOT NULL AND email NOT LIKE '_*****@%';

CREATE INDEX IF NOT EXISTS idx_tbl_athletes_email_hash ON public.tbl_athletes (email_hash);
CREATE INDEX IF NOT EXISTS idx_tbl_coaches_email_hash  ON public.tbl_coaches (email_hash);

-- 2. Hash passwords that are still plain text
UPDATE public.tbl_athletes AS t
SET password = 'sha256$' || s.salt || '$' || encode(extensions.digest(s.salt || ':' || t.password, 'sha256'), 'hex')
FROM (SELECT id, encode(extensions.gen_random_bytes(8), 'hex') AS salt FROM public.tbl_athletes) AS s
WHERE s.id = t.id AND t.password IS NOT NULL AND t.password <> '' AND t.password NOT LIKE 'sha256$%';

UPDATE public.tbl_athletes SET "confirmPassword" = password
WHERE "confirmPassword" IS DISTINCT FROM password AND password LIKE 'sha256$%';

UPDATE public.tbl_coaches AS t
SET password = 'sha256$' || s.salt || '$' || encode(extensions.digest(s.salt || ':' || t.password, 'sha256'), 'hex')
FROM (SELECT id, encode(extensions.gen_random_bytes(8), 'hex') AS salt FROM public.tbl_coaches) AS s
WHERE s.id = t.id AND t.password IS NOT NULL AND t.password <> '' AND t.password NOT LIKE 'sha256$%';

UPDATE public.tbl_coaches SET "confirmPassword" = password
WHERE "confirmPassword" IS DISTINCT FROM password AND password LIKE 'sha256$%';

-- 3. Mask names and emails

-- Masked emails repeat ("j*****@gmail.com"), so the email column can't stay unique.
-- Uniqueness is meaningful on email_hash instead (non-unique index above, since older
-- data may already contain duplicates).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'u'
      AND c.conrelid IN ('public.tbl_athletes'::regclass, 'public.tbl_coaches'::regclass)
      AND a.attname = 'email'
      AND array_length(c.conkey, 1) = 1
  LOOP
    RAISE NOTICE 'Dropping unique constraint % on %.email', r.conname, r.tbl;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.sa_mask_name(v TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN v IS NULL OR btrim(v) = '' THEN v
    WHEN btrim(v) ~ '^.\*{5}$' THEN btrim(v)
    ELSE left(btrim(v), 1) || '*****'
  END
$$;

CREATE OR REPLACE FUNCTION public.sa_mask_full_name(v TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN v IS NULL OR btrim(v) = '' THEN v
    ELSE (SELECT string_agg(public.sa_mask_name(w), ' ' ORDER BY n)
          FROM regexp_split_to_table(btrim(v), '\s+') WITH ORDINALITY AS t(w, n))
  END
$$;

CREATE OR REPLACE FUNCTION public.sa_mask_email(v TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN v IS NULL OR btrim(v) = '' OR position('@' IN v) <= 1 THEN v
    WHEN btrim(v) LIKE '_*****@%' THEN btrim(v)
    ELSE lower(left(btrim(v), 1)) || '*****' || lower(substring(btrim(v) FROM '@.*$'))
  END
$$;

UPDATE public.tbl_athletes SET
  "firstName"  = public.sa_mask_name("firstName"),
  "middleName" = public.sa_mask_name("middleName"),
  "lastName"   = public.sa_mask_name("lastName"),
  email        = public.sa_mask_email(email);

UPDATE public.tbl_coaches SET
  "firstName"  = public.sa_mask_name("firstName"),
  "middleName" = public.sa_mask_name("middleName"),
  "lastName"   = public.sa_mask_name("lastName"),
  email        = public.sa_mask_email(email);

-- Names copied into other tables
UPDATE public.tbl_session_attendees SET athlete_name = public.sa_mask_full_name(athlete_name);
UPDATE public.tbl_sessions SET coach_name = public.sa_mask_full_name(coach_name) WHERE coach_name IS NOT NULL;

-- 4. Username sign-in: the app needs the real email to call Supabase Auth, and the
--    table no longer has it. Returns the Auth email for a username of the given role.
CREATE OR REPLACE FUNCTION public.login_email_for_username(p_username TEXT, p_role TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
  WITH target AS (
    SELECT email_hash FROM public.tbl_athletes
    WHERE lower(p_role) = 'athlete' AND lower(username) = lower(btrim(p_username))
    UNION ALL
    SELECT email_hash FROM public.tbl_coaches
    WHERE lower(p_role) = 'coach' AND lower(username) = lower(btrim(p_username))
    LIMIT 1
  )
  SELECT u.email::TEXT
  FROM auth.users u, target t
  WHERE encode(extensions.digest(lower(trim(u.email)), 'sha256'), 'hex') = t.email_hash
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.login_email_for_username(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_email_for_username(TEXT, TEXT) TO anon, authenticated;
