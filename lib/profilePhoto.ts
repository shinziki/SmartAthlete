import { supabase } from '@/lib/supabase';
import * as ImagePicker from 'expo-image-picker';

const BUCKET = 'avatars';

function publicUrl(path: string, version: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${encodeURIComponent(version)}`;
}

/** Returns the public URL of the user's profile photo, or null if none is set. */
export async function getProfilePhotoUrl(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('tbl_profile_photos')
    .select('storage_path, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return publicUrl(data.storage_path, data.updated_at);
}

/**
 * Lets the user pick (and crop) a photo from the library, uploads it to the
 * `avatars` bucket and records its location in tbl_profile_photos.
 * Returns the new URL, null if cancelled, or throws on failure.
 */
export async function pickAndUploadProfilePhoto(userId: string): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Allow photo access in your phone settings to choose a profile photo.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.6,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase().split('?')[0];
  const contentType = asset.mimeType || (ext === 'png' ? 'image/png' : 'image/jpeg');
  const path = `${userId}/avatar.${ext === 'png' ? 'png' : 'jpg'}`;

  const body = await (await fetch(asset.uri)).arrayBuffer();

  // Remove a previous file with a different extension so storage stays clean.
  const { data: existing } = await supabase
    .from('tbl_profile_photos')
    .select('storage_path')
    .eq('user_id', userId)
    .maybeSingle();
  if (existing?.storage_path && existing.storage_path !== path) {
    await supabase.storage.from(BUCKET).remove([existing.storage_path]);
  }

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (uploadError) throw uploadError;

  const updatedAt = new Date().toISOString();
  const { error: dbError } = await supabase
    .from('tbl_profile_photos')
    .upsert({ user_id: userId, storage_path: path, updated_at: updatedAt });
  if (dbError) throw dbError;

  return publicUrl(path, updatedAt);
}

/** Deletes the user's profile photo file and its database record. */
export async function removeProfilePhoto(userId: string): Promise<void> {
  const { data } = await supabase
    .from('tbl_profile_photos')
    .select('storage_path')
    .eq('user_id', userId)
    .maybeSingle();
  if (data?.storage_path) {
    await supabase.storage.from(BUCKET).remove([data.storage_path]);
  }
  const { error } = await supabase.from('tbl_profile_photos').delete().eq('user_id', userId);
  if (error) throw error;
}

