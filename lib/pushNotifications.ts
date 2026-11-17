import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getCurrentAthleteRecord } from './sessionService';
import { prepareSessionNotifications } from './sessionNotifications';
import { supabase } from './supabase';

/**
 * Push notifications (e.g. "new training session") reach the athlete even when the app
 * is closed. This phone's Expo push token is stored in tbl_push_tokens; the database sends
 * the notification when a coach creates a session (supabase_push_notifications.sql).
 */

const SAVED_TOKEN_KEY = '@smartathlete_push_token_v1';

export type PushRegistration = 'registered' | 'no-permission' | 'unavailable' | 'failed';

/** Registers this phone for the signed-in athlete. Safe to call on every app start. */
export async function registerForPushNotifications(): Promise<PushRegistration> {
  if (!(await prepareSessionNotifications())) return 'no-permission';

  let token: string;
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (err: any) {
    // Typically: Firebase (google-services.json / FCM key) not set up for this build
    console.warn('[push] Could not get a push token:', err?.message);
    return 'unavailable';
  }

  const athlete = await getCurrentAthleteRecord();
  if (!athlete) return 'failed';

  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_athlete_id: athlete.id,
    p_platform: Platform.OS,
  });
  if (error) {
    console.warn('[push] Could not save the push token:', error.message);
    return 'failed';
  }
  try {
    await AsyncStorage.setItem(SAVED_TOKEN_KEY, token);
  } catch {}
  return 'registered';
}

/** Stops pushes to this phone (call before signing out). Best effort. */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(SAVED_TOKEN_KEY);
    if (!token) return;
    await supabase.from('tbl_push_tokens').delete().eq('token', token);
    await AsyncStorage.removeItem(SAVED_TOKEN_KEY);
  } catch {}
}

// ─── Opening the app from a notification ───────────────────────

// A tap the listener handled while start-up routing may still be running (short-lived,
// so a later normal app start isn't redirected)
let pendingRoute: { route: string; at: number } | null = null;
const PENDING_ROUTE_MS = 10_000;

function routeFor(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as { type?: string } | undefined;
  return data?.type === 'new_session' ? '/athlete/check-in' : null;
}

/**
 * Where a tapped notification should take the athlete when it launched the app (start-up
 * routing consumes it once, instead of the usual home screen).
 */
export function consumeNotificationRoute(): string | null {
  const fromLaunch = routeFor(Notifications.getLastNotificationResponse());
  if (fromLaunch) Notifications.clearLastNotificationResponse();
  const recent = pendingRoute && Date.now() - pendingRoute.at < PENDING_ROUTE_MS ? pendingRoute.route : null;
  pendingRoute = null;
  return recent ?? fromLaunch;
}

/**
 * Taps while the app is running: open the right screen right away. Returns an
 * unsubscribe function.
 */
export function listenForNotificationTaps(navigate: (route: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const route = routeFor(response);
    if (!route) return;
    Notifications.clearLastNotificationResponse();
    pendingRoute = { route, at: Date.now() };
    navigate(route);
  });
  return () => sub.remove();
}
