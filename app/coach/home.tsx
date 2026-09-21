import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar, Card, Chip, Icon, Surface, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { supabase } from '@/lib/supabase';
import {
  DbSession,
  getLatestUpcomingSession,
  getUpcomingSessions,
} from '@/lib/sessionService';

/**
 * Coach Home — Dashboard overview with live stats and latest session.
 */

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

export default function CoachHomeScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [coachName, setCoachName] = useState('Coach');
  const [athleteCount, setAthleteCount] = useState<number | string>('—');
  const [sessionCount, setSessionCount] = useState<number>(0);
  const [checkInCount, setCheckInCount] = useState<number>(0);
  const [nextSession, setNextSession] = useState<DbSession | null>(null);

  const loadDashboardData = useCallback(async () => {
    try {
      // 1. Load Coach Info
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
            `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || 'Coach'
          );
        }
      }

      // 2. Load Athlete Count
      const { count } = await supabase
        .from('tbl_athletes')
        .select('*', { count: 'exact', head: true });

      if (count !== null && count !== undefined) {
        setAthleteCount(count);
      }

      // 3. Load Upcoming Sessions & Check-ins
      const sessions = await getUpcomingSessions();
      setSessionCount(sessions.length);

      const totalCheckIns = sessions.reduce(
        (acc, s) => acc + (s.acceptedAthletes ? s.acceptedAthletes.length : 0),
        0
      );
      setCheckInCount(totalCheckIns);

      // 4. Load Next Session
      const latest = await getLatestUpcomingSession();
      setNextSession(latest);
    } catch (err) {
      console.warn('Error loading coach dashboard data:', err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [loadDashboardData])
  );

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
              {athleteCount}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Athletes
            </Text>
          </Surface>

          <Surface style={[styles.statCard, { backgroundColor: theme.colors.elevation.level1 }]} elevation={0}>
            <Icon source="calendar-check" size={28} color={theme.colors.primary} />
            <Text variant="headlineSmall" style={[styles.statNumber, { color: theme.colors.onSurface }]}>
              {sessionCount}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Sessions
            </Text>
          </Surface>

          <Surface style={[styles.statCard, { backgroundColor: theme.colors.elevation.level1 }]} elevation={0}>
            <Icon source="clipboard-check-outline" size={28} color={theme.colors.primary} />
            <Text variant="headlineSmall" style={[styles.statNumber, { color: theme.colors.onSurface }]}>
              {checkInCount}
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

        {!nextSession ? (
          <Card mode="outlined" style={[styles.nextSessionCard, { borderColor: theme.colors.outlineVariant }]}>
            <Card.Content style={styles.nextSessionContent}>
              <Icon source="calendar-clock" size={24} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginLeft: 12 }}>
                No upcoming sessions scheduled
              </Text>
            </Card.Content>
          </Card>
        ) : (
          <Pressable onPress={() => router.push('/coach/sessions')}>
            <Card
              mode="elevated"
              style={[
                styles.nextSessionCard,
                { backgroundColor: theme.colors.elevation.level1 },
              ]}
            >
              <Card.Content style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text
                    variant="titleMedium"
                    style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1 }}
                  >
                    {nextSession.title}
                  </Text>
                  <Chip
                    compact
                    style={{ backgroundColor: theme.colors.primaryContainer }}
                    textStyle={{ color: theme.colors.primary, fontSize: 11, fontWeight: '700' }}
                  >
                    {nextSession.drills.length} drills
                  </Chip>
                </View>

                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {nextSession.date} · {nextSession.startTime}–{nextSession.endTime}
                </Text>

                <Text variant="bodySmall" style={{ color: theme.colors.primary, fontWeight: '600' }}>
                  {nextSession.locationType === 'at_home'
                    ? '🏠 At Home'
                    : `📍 ${nextSession.venueName || 'Venue'}`}
                </Text>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: 6,
                    paddingTop: 8,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.outlineVariant,
                    justifyContent: 'space-between',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon source="account-check-outline" size={16} color="#2E7D32" />
                    <Text variant="labelSmall" style={{ color: '#2E7D32', fontWeight: '700' }}>
                      {nextSession.acceptedAthletes.length} accepted
                    </Text>
                  </View>
                  <Text variant="labelSmall" style={{ color: theme.colors.primary, fontWeight: '600' }}>
                    View all sessions →
                  </Text>
                </View>
              </Card.Content>
            </Card>
          </Pressable>
        )}
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
