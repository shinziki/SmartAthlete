import { Tabs } from 'expo-router';
import React, { useEffect } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import {
  ackWatchUnlinkNotice,
  replyToWatchUnlink,
  startWatchLink,
  stopWatchLink,
  subscribeWatchUnlinkEvents,
} from '@/lib/ble-manager';
import { lookupActiveDeviceLink, unlinkWatchDeviceOfflineSafe } from '@/lib/deviceLink';
import { supabase } from '@/lib/supabase';
import { Icon, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Athlete tab layout with Material 3 bottom navigation.
 *
 * Tab screens: Home, History, Check In, Profile
 * Stack screens (device-check, smartwatch-setup) are accessible
 * via navigation from within tab screens.
 */
export default function AthleteLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const TAB_BAR_HEIGHT = 68;

  // Keep the athlete's watch connected while the app is open (works offline: the
  // linked watch is remembered on the phone). Paused in the background.
  useEffect(() => {
    let cancelled = false;
    const connect = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user || cancelled) return;
      const { link } = await lookupActiveDeviceLink(session.user.id);
      if (link?.watch_node_id && !cancelled) startWatchLink(link.watch_node_id);
    };
    connect().catch(() => undefined);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') connect().catch(() => undefined);
      else stopWatchLink();
    });
    return () => {
      cancelled = true;
      sub.remove();
      stopWatchLink();
    };
  }, []);

  // Unlink started on the watch: confirm here (like a phone-started unlink is confirmed
  // on the watch), or accept that it already happened while the phone was away
  useEffect(() => {
    const userId = async () =>
      (await supabase.auth.getSession()).data.session?.user?.id ?? null;

    return subscribeWatchUnlinkEvents(async (event) => {
      if (event.type === 'unlinked') {
        const uid = await userId();
        if (uid) await unlinkWatchDeviceOfflineSafe(uid);
        await ackWatchUnlinkNotice();
        stopWatchLink();
        Alert.alert(
          'Watch unlinked',
          'Your smartwatch was unlinked from the watch itself. Link it again from Smartwatch setup if you want to keep using it.'
        );
        return;
      }
      Alert.alert(
        'Unlink smartwatch?',
        `Your watch${event.name ? ` (linked to ${event.name})` : ''} wants to unlink from your account. It will stop tracking for you until it is linked again.`,
        [
          { text: 'Keep linked', style: 'cancel', onPress: () => replyToWatchUnlink(false) },
          {
            text: 'Unlink',
            style: 'destructive',
            onPress: async () => {
              // Tell the watch first, while still connected
              await replyToWatchUnlink(true);
              const uid = await userId();
              if (uid) await unlinkWatchDeviceOfflineSafe(uid);
              stopWatchLink();
              Alert.alert('Watch unlinked', 'Your smartwatch is no longer linked to your account.');
            },
          },
        ]
      );
    });
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: theme.colors.elevation.level2,
          borderTopWidth: 0,
          elevation: 0,
          height: Platform.OS === 'ios' ? 88 : TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: Platform.OS === 'ios' ? 28 : insets.bottom + 10,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        tabBarItemStyle: {
          gap: 4,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Icon source="home" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => (
            <Icon source="history" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="check-in"
        options={{
          title: 'Check in',
          tabBarIcon: ({ color, size }) => (
            <Icon source="clipboard-check-outline" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Icon source="account-circle-outline" size={size ?? 24} color={color} />
          ),
        }}
      />
      {/* Hide utility screens from tab bar but keep them navigable */}
      <Tabs.Screen
        name="device-check"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="smartwatch-setup"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="live-tracking"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tabs>
  );
}
