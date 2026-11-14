-- ==============================================================================
-- SmartAthlete: One account per watch
-- Run this script in your Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Safe to run more than once.
--
-- A watch can only be actively linked to one account at a time. The watch itself
-- refuses pairing requests from other accounts while it is linked (it answers IN_USE);
-- this enforces the same rule in the database using the watch's permanent ID
-- (watch_uid), since its Bluetooth address (watch_node_id) can change.
-- ==============================================================================

ALTER TABLE public.tbl_device_links ADD COLUMN IF NOT EXISTS watch_uid TEXT;

-- If the same watch somehow has several active links, keep only the newest
UPDATE public.tbl_device_links AS d
SET is_active = false
WHERE d.is_active
  AND d.watch_uid IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.tbl_device_links n
    WHERE n.is_active AND n.watch_uid = d.watch_uid AND n.paired_at > d.paired_at
  );

CREATE UNIQUE INDEX IF NOT EXISTS tbl_device_links_one_active_per_watch
  ON public.tbl_device_links (watch_uid)
  WHERE is_active AND watch_uid IS NOT NULL;

-- Links the signed-in athlete to a watch. Called only after the watch accepted the
-- pairing (an unlinked watch, or a re-pair from its own account), so any older
-- active link to the same watch is stale (e.g. it was unlinked on the watch itself)
-- and is closed first.
CREATE OR REPLACE FUNCTION public.link_watch(
  p_watch_uid TEXT,
  p_watch_node_id TEXT,
  p_watch_name TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me TEXT := auth.uid()::TEXT;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000';
  END IF;

  -- The caller's previous watch, and any stale link of this watch. Links saved before
  -- watch_uid existed have no ID, so those are matched by the watch's Bluetooth address.
  UPDATE public.tbl_device_links
  SET is_active = false
  WHERE is_active
    AND (
      athlete_id::TEXT = me
      OR (p_watch_uid IS NOT NULL AND watch_uid = p_watch_uid)
      OR (watch_uid IS NULL AND p_watch_node_id IS NOT NULL AND watch_node_id = p_watch_node_id)
    );

  INSERT INTO public.tbl_device_links (athlete_id, watch_node_id, watch_name, watch_uid, is_active)
  VALUES (auth.uid(), p_watch_node_id, p_watch_name, NULLIF(p_watch_uid, ''), true);
END $$;

REVOKE ALL ON FUNCTION public.link_watch(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_watch(TEXT, TEXT, TEXT) TO authenticated;
