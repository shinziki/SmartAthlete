import { ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider } from 'react-native-paper';
import 'react-native-reanimated';

import { CombinedDarkTheme, CombinedLightTheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { flushOfflineQueue } from '@/lib/sessionService';
import { useEffect } from 'react';
import { AppState } from 'react-native';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? CombinedDarkTheme : CombinedLightTheme;

  // Offline-first: push queued check-ins / metrics whenever connectivity may have returned.
  useEffect(() => {
    const sync = () => {
      flushOfflineQueue().catch(() => undefined);
    };
    sync();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && sync());
    const timer = setInterval(sync, 30000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

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
