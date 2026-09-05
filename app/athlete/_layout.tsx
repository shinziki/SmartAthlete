import { Stack } from 'expo-router';

/**
 * Nested layout for all athlete-only screens.
 * Routes under app/athlete/ share this Stack navigator.
 */
export default function AthleteLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="device-check" />
      <Stack.Screen name="smartwatch-setup" />
      <Stack.Screen name="home" />
    </Stack>
  );
}
