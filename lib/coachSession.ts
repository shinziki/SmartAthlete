import AsyncStorage from '@react-native-async-storage/async-storage';

const COACH_EMAIL_KEY = '@smartathlete_coach_email_v1';

/** Remember the signed-in coach so the login survives app restarts. */
export async function saveCoachLogin(email: string): Promise<void> {
  try {
    await AsyncStorage.setItem(COACH_EMAIL_KEY, email.trim());
  } catch (err) {
    console.warn('[coachSession] Failed to save coach login:', err);
  }
}

export async function getSavedCoachEmail(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(COACH_EMAIL_KEY);
  } catch {
    return null;
  }
}

export async function clearCoachLogin(): Promise<void> {
  try {
    await AsyncStorage.removeItem(COACH_EMAIL_KEY);
  } catch (err) {
    console.warn('[coachSession] Failed to clear coach login:', err);
  }
}
