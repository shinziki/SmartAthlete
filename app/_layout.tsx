import { ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider } from 'react-native-paper';
import 'react-native-reanimated';

import { CombinedDarkTheme, CombinedLightTheme } from '@/constants/theme';
import { ThemePreferenceProvider, useThemePreference } from '@/lib/themePreference';
import { startProgressSync } from '@/lib/progressSync';
import { flushOfflineQueue } from '@/lib/sessionService';
import { useEffect } from 'react';
import { AppState } from 'react-native';

export const unstable_settings = {
  initialRouteName: 'index',
};

function ThemedApp() {
  const { scheme } = useThemePreference();
  const theme = scheme === 'dark' ? CombinedDarkTheme : CombinedLightTheme;

  return (
    <PaperProvider theme={theme}>
      <ThemeProvider value={theme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="athlete-sign-in" />
          <Stack.Screen name="athlete-register" />
          <Stack.Screen name="athlete-forgot-password" />
          <Stack.Screen name="coach-sign-in" />
          <Stack.Screen name="coach-register" />
          <Stack.Screen name="coach-forgot-password" />
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="athlete" />
          <Stack.Screen name="coach" />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </PaperProvider>
  );
}

export default function RootLayout() {
  // Offline-first: push queued check-ins / metrics whenever connectivity may have returned.
  useEffect(() => {
    const sync = () => {
      flushOfflineQueue().catch(() => undefined);
    };
    sync();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && sync());
    const timer = setInterval(sync, 30000);
    // Live session progress for the coach (buffered on the phone while offline)
    const stopProgressSync = startProgressSync();
    return () => {
      sub.remove();
      clearInterval(timer);
      stopProgressSync();
    };
  }, []);

  return (
    <ThemePreferenceProvider>
      <ThemedApp />
    </ThemePreferenceProvider>
  );
}
