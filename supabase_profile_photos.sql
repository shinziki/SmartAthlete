-- Profile photos for athletes and coaches.
-- Run in Supabase SQL Editor.

-- 1. Storage bucket (public read so the image URL can be used directly)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Users may only write inside their own folder: avatars/<auth uid>/...
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
CREATE POLICY "avatars_owner_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 2. Table that stores where each user's photo lives in the bucket
CREATE TABLE IF NOT EXISTS public.tbl_profile_photos (
    user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tbl_profile_photos ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can read photos (coach sees athletes and vice versa)
DROP POLICY IF EXISTS "profile_photos_read" ON public.tbl_profile_photos;
CREATE POLICY "profile_photos_read" ON public.tbl_profile_photos
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profile_photos_owner_write" ON public.tbl_profile_photos;
CREATE POLICY "profile_photos_owner_write" ON public.tbl_profile_photos
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

