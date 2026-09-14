import { supabase } from '@/lib/supabase';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar, Card, Icon, Surface, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Coach Home — Dashboard overview (placeholder).
 *
 * Displays a greeting and quick stats cards.
 * Will be expanded with real data in a future iteration.
 */

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

export default function CoachHomeScreen() {
  const theme = useTheme();
  const [coachName, setCoachName] = useState('Coach');

  useEffect(() => {
    const loadCoachName = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user?.email) {
          const { data } = await supabase
            .from('tbl_coaches')
            .select('first_name, last_name')
            .ilike('email', session.user.email)
            .maybeSingle();

          if (data) {
            setCoachName(
              `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || 'Coach',
            );
          }
        }
      } catch (err) {
        console.warn('Error loading coach name:', err);
      }
    };

    loadCoachName();
  }, []);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <View style={styles.container}>
        {/* ─── Header ─── */}
        <View style={styles.header}>
          <View>
            <Text
              variant="bodyLarge"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              {getGreeting()}
            </Text>
            <Text
              variant="headlineMedium"
              style={[styles.nameText, { color: theme.colors.onBackground }]}
            >
              {coachName}
            </Text>
          </View>
          <Avatar.Icon
            size={48}
            icon="whistle"
            style={{ backgroundColor: theme.colors.primaryContainer }}
            color={theme.colors.onPrimaryContainer}
          />
        </View>

        {/* ─── Quick Stats ─── */}
        <Text
          variant="labelLarge"
          style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}
        >
          OVERVIEW
        </Text>

        <View style={styles.statsRow}>
          <Surface style={[styles.statCard, { backgroundColor: theme.colors.elevation.level1 }]} elevation={0}>
            <Icon source="account-group" size={28} color={theme.colors.primary} />
            <Text variant="headlineSmall" style={[styles.statNumber, { color: theme.colors.onSurface }]}>
              —
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Athletes
            </Text>
          </Surface>

          <Surface style={[styles.statCard, { backgroundColor: theme.colors.elevation.level1 }]} elevation={0}>
            <Icon source="calendar-check" size={28} color={theme.colors.primary} />
            <Text variant="headlineSmall" style={[styles.statNumber, { color: theme.colors.onSurface }]}>
              —
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Sessions
            </Text>
          </Surface>

          <Surface style={[styles.statCard, { backgroundColor: theme.colors.elevation.level1 }]} elevation={0}>
            <Icon source="clipboard-check-outline" size={28} color={theme.colors.primary} />
            <Text variant="headlineSmall" style={[styles.statNumber, { color: theme.colors.onSurface }]}>
              —
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Check-ins
            </Text>
          </Surface>
        </View>

        {/* ─── Upcoming Session Card ─── */}
        <Text
          variant="labelLarge"
          style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}
        >
          NEXT SESSION
        </Text>

        <Card mode="outlined" style={[styles.nextSessionCard, { borderColor: theme.colors.outlineVariant }]}>
          <Card.Content style={styles.nextSessionContent}>
            <Icon source="calendar-clock" size={24} color={theme.colors.onSurfaceVariant} />
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginLeft: 12 }}>
              No upcoming sessions scheduled
            </Text>
          </Card.Content>
        </Card>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
  },
  nameText: {
    fontWeight: '700',
    marginTop: 2,
  },
  sectionLabel: {
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  statNumber: {
    fontWeight: '700',
  },
  nextSessionCard: {
    borderRadius: 16,
  },
  nextSessionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
});
