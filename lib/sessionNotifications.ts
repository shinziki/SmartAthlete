import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * System notifications for session events, so the athlete hears about the end of a
 * session even with the app in the background or the screen off.
 */

const CHANNEL_ID = 'session-alerts';
let prepared: Promise<boolean> | null = null;

// Show the notification even while the app is open on screen
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Creates the Android channel and asks for permission once. Call when a session starts,
 * so the permission prompt doesn't appear at the moment the session ends.
 */
export function prepareSessionNotifications(): Promise<boolean> {
  if (!prepared) {
    prepared = (async () => {
      try {
        if (Platform.OS === 'android') {
          // Android 13+ only shows the permission prompt once a channel exists
          await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
            name: 'Training sessions',
            description: 'Session complete and other session alerts',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 500, 250, 500, 250, 500],
            enableVibrate: true,
          });
        }
        const current = await Notifications.getPermissionsAsync();
        if (current.granted) return true;
        if (!current.canAskAgain) return false;
        return (await Notifications.requestPermissionsAsync()).granted;
      } catch (err) {
        console.warn('[sessionNotifications] Setup failed:', err);
        prepared = null;
        return false;
      }
    })();
  }
  return prepared;
}

/** "Session complete" notification. */
export function notifySessionEnded(title: string, body: string): Promise<void> {
  return notifySessionEvent(title, body);
}

/** Any session alert (e.g. "your session is starting"). */
export async function notifySessionEvent(title: string, body: string): Promise<void> {
  try {
    if (!(await prepareSessionNotifications())) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch (err) {
    console.warn('[sessionNotifications] Could not show notification:', err);
  }
}
