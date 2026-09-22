import { supabase } from '@/lib/supabase';

export type DeviceLink = {
    id: string;
    watch_node_id: string;
    watch_name: string | null;
    paired_at: string;
};

/**
 * Returns the active device link for a given athlete,
 * or null if no watch has been paired yet.
 */
export async function getActiveDeviceLink(
    athleteId: string
): Promise<DeviceLink | null> {
    const { data, error } = await supabase
        .from('tbl_device_links')
        .select('id, watch_node_id, watch_name, paired_at')
        .eq('athlete_id', athleteId)
        .eq('is_active', true)
        .maybeSingle();

    if (error) {
        console.error('Device link lookup error:', error.message);
        return null;
    }

    return data;
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

    return true;
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
    return true;
}
