import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Coach Athletes — Placeholder screen.
 *
 * Will display athlete roster, management, and performance metrics.
 */
export default function CoachAthletesScreen() {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <View style={styles.container}>
        <Text
          variant="headlineMedium"
          style={[styles.title, { color: theme.colors.onBackground }]}
        >
          Athletes
        </Text>

        <View style={styles.emptyState}>
          <Icon
            source="account-group-outline"
            size={64}
            color={theme.colors.outlineVariant}
          />
          <Text
            variant="bodyLarge"
            style={{ color: theme.colors.onSurfaceVariant, marginTop: 16 }}
          >
            Athlete roster coming soon
          </Text>
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.outline, marginTop: 4 }}
          >
            Manage your team and track performance
          </Text>
        </View>
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
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  title: {
    fontWeight: '700',
    marginBottom: 24,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 80,
  },
});
