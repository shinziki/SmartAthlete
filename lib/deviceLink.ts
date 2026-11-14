import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

export type DeviceLink = {
    id: string;
    watch_node_id: string;
    watch_name: string | null;
    paired_at: string;
};

// ─── Linked watch, remembered on the phone ────────────────────
// Finding the athlete's watch must not need the internet: offline, the phone would
// otherwise think no watch is linked, show it as disconnected, and never send it the
// session (Bluetooth itself works without internet).

const LINK_CACHE_PREFIX = '@smartathlete_device_link_v1:';

async function readCachedLink(athleteId: string): Promise<DeviceLink | null | undefined> {
    try {
        const raw = await AsyncStorage.getItem(LINK_CACHE_PREFIX + athleteId);
        if (raw === null) return undefined; // never looked up on this phone
        return JSON.parse(raw) as DeviceLink | null;
    } catch {
        return undefined;
    }
}

async function writeCachedLink(athleteId: string, link: DeviceLink | null): Promise<void> {
    try {
        await AsyncStorage.setItem(LINK_CACHE_PREFIX + athleteId, JSON.stringify(link));
    } catch {}
}

/** Forget the remembered link (after linking or unlinking, the next lookup refreshes it). */
export async function clearCachedDeviceLink(athleteId: string): Promise<void> {
    try {
        await AsyncStorage.removeItem(LINK_CACHE_PREFIX + athleteId);
    } catch {}
}

// Unlink accepted while offline: the database is updated once the phone is back online
const PENDING_UNLINK_PREFIX = '@smartathlete_pending_unlink_v1:';

/**
 * Unlinks right away on this phone, even offline: the remembered link is cleared now and
 * the database link is deactivated as soon as there is internet.
 */
export async function unlinkWatchDeviceOfflineSafe(athleteId: string): Promise<void> {
    await writeCachedLink(athleteId, null);
    const ok = await unlinkWatchDevice(athleteId).catch(() => false);
    try {
        if (ok) await AsyncStorage.removeItem(PENDING_UNLINK_PREFIX + athleteId);
        else await AsyncStorage.setItem(PENDING_UNLINK_PREFIX + athleteId, '1');
    } catch {}
}

/** Finishes an unlink that happened offline. Returns true when none is left pending. */
async function flushPendingUnlink(athleteId: string): Promise<boolean> {
    let pending = false;
    try {
        pending = (await AsyncStorage.getItem(PENDING_UNLINK_PREFIX + athleteId)) === '1';
    } catch {}
    if (!pending) return true;
    if (!(await unlinkWatchDevice(athleteId).catch(() => false))) return false;
    try {
        await AsyncStorage.removeItem(PENDING_UNLINK_PREFIX + athleteId);
    } catch {}
    return true;
}

/**
 * Like getActiveDeviceLink, but tells "no watch linked" apart from "couldn't check"
 * (offline, and nothing remembered on this phone yet).
 */
export async function lookupActiveDeviceLink(
    athleteId: string
): Promise<{ link: DeviceLink | null; failed: boolean }> {
    // An unlink still waiting for the database means: no watch, whatever the server says
    if (!(await flushPendingUnlink(athleteId))) return { link: null, failed: false };
    try {
        const { data, error } = await supabase
            .from('tbl_device_links')
            .select('id, watch_node_id, watch_name, paired_at')
            .eq('athlete_id', athleteId)
            .eq('is_active', true)
            .maybeSingle();
        if (!error) {
            await writeCachedLink(athleteId, data);
            return { link: data, failed: false };
        }
    } catch {}
    // Offline: use the link remembered on this phone
    const cached = await readCachedLink(athleteId);
    return cached === undefined ? { link: null, failed: true } : { link: cached, failed: false };
}

/**
 * Returns the active device link for a given athlete, or null if no watch has been
 * paired yet. Works offline using the link remembered on this phone.
 */
export async function getActiveDeviceLink(
    athleteId: string
): Promise<DeviceLink | null> {
    return (await lookupActiveDeviceLink(athleteId)).link;
}

/**
 * Deactivates any existing link for the athlete, then inserts a new one.
 */
export async function linkWatchDevice(
    athleteId: string,
    watchNodeId: string,
    watchName: string
): Promise<boolean> {
    // 1. Deactivate old link(s) if any
    const { error: deactivateError } = await supabase
        .from('tbl_device_links')
        .update({ is_active: false })
        .eq('athlete_id', athleteId)
        .eq('is_active', true);

    if (deactivateError) {
        console.error('Failed to deactivate old link:', deactivateError.message);
        return false;
    }

    // 2. Insert the new active link
    const { error: insertError } = await supabase
        .from('tbl_device_links')
        .insert({
            athlete_id: athleteId,
            watch_node_id: watchNodeId,
            watch_name: watchName,
            is_active: true,
        });

    if (insertError) {
        console.error('Failed to insert new device link:', insertError.message);
        return false;
    }

    await clearCachedDeviceLink(athleteId);
    return true;
}

export const WATCH_IN_USE_MESSAGE =
  "This watch is linked to another athlete's account. Use your own watch, or ask them to unlink it (from their app or on the watch) first.";

/**
 * Saves the link after the watch accepted the pairing. Uses the link_watch database
 * function (supabase_device_links.sql), which keeps one active account per watch; falls
 * back to the plain insert if that function hasn't been installed yet.
 */
export async function claimWatchLink(
    athleteId: string,
    watchUid: string | null,
    watchNodeId: string,
    watchName: string
): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase.rpc('link_watch', {
        p_watch_uid: watchUid,
        p_watch_node_id: watchNodeId,
        p_watch_name: watchName,
    });
    if (!error) {
        await clearCachedDeviceLink(athleteId);
        return { ok: true };
    }

    if (error.code === '23505') return { ok: false, error: WATCH_IN_USE_MESSAGE };
    if (error.code === 'PGRST202' || /link_watch/.test(error.message ?? '')) {
        // Database not updated yet
        const ok = await linkWatchDevice(athleteId, watchNodeId, watchName);
        return ok ? { ok: true } : { ok: false, error: 'Could not save the watch link. Please try again.' };
    }
    console.error('link_watch failed:', error.message);
    return { ok: false, error: error.message || 'Could not save the watch link.' };
}

/**
 * Deactivates active device link(s) for the athlete.
 */
export async function unlinkWatchDevice(athleteId: string): Promise<boolean> {
    const { error } = await supabase
        .from('tbl_device_links')
        .update({ is_active: false })
        .eq('athlete_id', athleteId)
        .eq('is_active', true);

    if (error) {
        console.error('Failed to unlink device:', error.message);
        return false;
    }
    await writeCachedLink(athleteId, null);
    return true;
}

/**
 * Updates the active device link's watch_node_id (and optionally watch_name)
 * when a rotated BLE MAC address is detected.
 */
export async function updateDeviceLinkNodeId(
    athleteId: string,
    newWatchNodeId: string,
    newWatchName?: string
): Promise<boolean> {
    const updates: Record<string, any> = { watch_node_id: newWatchNodeId };
    if (newWatchName) {
        updates.watch_name = newWatchName;
    }
    const { error } = await supabase
        .from('tbl_device_links')
        .update(updates)
        .eq('athlete_id', athleteId)
        .eq('is_active', true);

    if (error) {
        console.warn('Could not update device link node ID:', error.message);
        return false;
    }
    await clearCachedDeviceLink(athleteId);
    return true;
}
