import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { lookupActiveDeviceLink } from '@/lib/deviceLink';
import { consumeNotificationRoute } from '@/lib/pushNotifications';

export default function DeviceCheckScreen() {
  const theme = useTheme();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const checkDeviceLink = async () => {
      try {
        // 1. Confirm the session saved on this phone (getUser would need the internet,
        //    and sent athletes back to the start screen whenever they were offline)
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;

        if (cancelled) return;

        if (!user) {
          router.replace('/' as any);
          return;
        }

        // 2. Query Supabase for active smartwatch link
        const { link, failed } = await lookupActiveDeviceLink(user.id);

        if (cancelled) return;

        // Offline: go to Home; watch setup is only for athletes with no watch linked
        if (link || failed) {
          // Opened by tapping a "new session" notification: go straight to Check-in
          router.replace((consumeNotificationRoute() ?? '/athlete/home') as any);
        } else {
          router.replace('/athlete/smartwatch-setup' as any);
        }
      } catch (err) {
        console.error('Device check error:', err);
        if (!cancelled) {
          router.replace('/athlete/smartwatch-setup' as any);
        }
      }
    };

    checkDeviceLink();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.container}>
        <ActivityIndicator
          size="large"
          color={theme.colors.primary}
          style={styles.spinner}
        />
        <Text
          variant="bodyMedium"
          style={[styles.label, { color: theme.colors.onSurfaceVariant }]}
        >
          Setting up your session…
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  spinner: {
    marginBottom: 4,
  },
  label: {
    letterSpacing: 0.2,
  },
});
