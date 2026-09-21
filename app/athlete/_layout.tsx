import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
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
