import AsyncStorage from '@react-native-async-storage/async-storage';
import { unregisterPushNotifications } from './pushNotifications';
import { supabase } from './supabase';

/**
 * Which kind of account is signed in on this phone. Start-up uses it when the server
 * can't be reached, so an athlete who opens the app offline isn't mistaken for a coach.
 */
export type SignedInRole = 'athlete' | 'coach';

const ROLE_KEY = '@smartathlete_signed_in_role_v1';

export async function saveSignedInRole(role: SignedInRole): Promise<void> {
  try {
    await AsyncStorage.setItem(ROLE_KEY, role);
  } catch {}
}

export async function getSignedInRole(): Promise<SignedInRole | null> {
  try {
    const v = await AsyncStorage.getItem(ROLE_KEY);
    return v === 'athlete' || v === 'coach' ? v : null;
  } catch {
    return null;
  }
}

/** True when a Supabase login is saved on this phone (works offline). */
export async function hasStoredAuthSession(): Promise<boolean> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys.some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
  } catch {
    return false;
  }
}

export async function clearSignedInRole(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ROLE_KEY);
  } catch {}
}

/**
 * Signs out. Signing out normally tells the server too; without internet that fails,
 * so the session is then cleared on this phone only and the user is still signed out.
 */
export async function signOutOnThisPhone(): Promise<void> {
  await unregisterPushNotifications();
  await clearSignedInRole();
  try {
    const { error } = await supabase.auth.signOut();
    if (!error) return;
  } catch {}
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {}
}
