import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Card, Chip, Icon, Surface, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { InitialsAvatar, READINESS_COLORS } from '@/components/coach/readiness';
import { getTeamOverview, Readiness, TeamOverview } from '@/lib/coachService';
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
  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

      // 5. Load team load / readiness analytics
      setOverview(await getTeamOverview());
    } catch (err) {
      console.warn('Error loading coach dashboard data:', err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [loadDashboardData])
  );

  const total = overview?.athletes.length ?? 0;
  const counts = overview?.readinessCounts;
  const sportCoachInitials =
    coachName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase() || 'C';

  const acwr = overview?.teamAcwr ?? null;
  const acwrZone: { label: string; color: string } =
    acwr === null
      ? { label: 'No data yet', color: theme.colors.onSurfaceVariant }
      : acwr > 1.5
        ? { label: 'High risk', color: '#F87171' }
        : acwr > 1.3 || acwr < 0.8
          ? { label: 'Watch zone', color: '#FBBF24' }
          : { label: 'Optimal', color: '#34D399' };

  const delta = (v: number | null, suffix: string) =>
    v === null ? 'vs last wk: —' : `${v >= 0 ? '↑' : '↓'}${Math.abs(v)}${suffix} vs last wk`;
  const deltaColor = (v: number | null) =>
    v === null ? theme.colors.onSurfaceVariant : v >= 0 ? '#34D399' : '#F87171';

  const bars: { key: Readiness; label: string }[] = [
    { key: 'ready', label: 'Ready' },
    { key: 'moderate', label: 'Moderate' },
    { key: 'watch', label: 'Watch' },
  ];

  const bigStats = [
    {
      label: 'ATTENDANCE',
      value: overview?.attendancePct != null ? `${overview.attendancePct}%` : '—',
      sub: delta(overview?.attendanceDelta ?? null, '%'),
      color: deltaColor(overview?.attendanceDelta ?? null),
    },
    {
      label: 'AVG LOAD',
      value: overview?.avgLoad != null ? `${overview.avgLoad} AU` : '—',
      sub: delta(overview?.avgLoadDeltaPct ?? null, '%'),
      color: deltaColor(overview?.avgLoadDeltaPct ?? null),
    },
    {
      label: 'ACWR',
      value: acwr !== null ? acwr.toFixed(2) : '—',
      sub: acwrZone.label,
      color: acwrZone.color,
    },
    {
      label: 'FLAGGED',
      value: String(overview?.flagged.length ?? 0),
      sub: (overview?.flagged.length ?? 0) > 0 ? 'High load' : 'All clear',
      color: (overview?.flagged.length ?? 0) > 0 ? '#F87171' : '#34D399',
    },
  ];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadDashboardData();
            }}
          />
        }
      >
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
          <InitialsAvatar
            initials={sportCoachInitials}
            size={48}
            color={theme.colors.primaryContainer}
          />
        </View>

        {/* ─── Team Stat Grid ─── */}
        <View style={styles.grid}>
          {bigStats.map((s) => (
            <Surface
              key={s.label}
              style={[styles.gridCard, { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant }]}
              elevation={0}
            >
              <Text variant="labelSmall" style={[styles.gridLabel, { color: theme.colors.onSurfaceVariant }]}>
                {s.label}
              </Text>
              <Text variant="headlineMedium" style={{ fontWeight: '800', color: theme.colors.onSurface }}>
                {s.value}
              </Text>
              <Text variant="labelSmall" style={{ color: s.color, fontWeight: '700' }}>
                {s.sub}
              </Text>
            </Surface>
          ))}
        </View>

        {/* ─── Team Readiness ─── */}
        <Surface
          style={[styles.readinessCard, { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant }]}
          elevation={0}
        >
          <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface, marginBottom: 12 }}>
            Team readiness
          </Text>
          {bars.map((b) => {
            const n = counts?.[b.key] ?? 0;
            return (
              <View key={b.key} style={{ marginBottom: 12 }}>
                <View style={styles.barHeader}>
                  <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, fontWeight: '600' }}>
                    {b.label}
                  </Text>
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    {n}/{total}
                  </Text>
                </View>
                <View style={[styles.barTrack, { backgroundColor: theme.colors.surfaceVariant }]}>
                  <View
                    style={{
                      height: '100%',
                      borderRadius: 3,
                      width: `${total ? (n / total) * 100 : 0}%`,
                      backgroundColor: READINESS_COLORS[b.key].fg,
                    }}
                  />
                </View>
              </View>
            );
          })}
          <Text variant="labelSmall" style={{ fontStyle: 'italic', color: theme.colors.outline }}>
            Coaching decision-support estimates only — not medical assessments.
          </Text>
        </Surface>

        {/* ─── Needs attention ─── */}
        {(overview?.flagged.length ?? 0) > 0 && (
          <>
            <Text variant="labelLarge" style={[styles.sectionLabel, { color: '#F87171' }]}>
              NEEDS ATTENTION
            </Text>
            <View style={styles.grid}>
              {overview!.flagged.slice(0, 4).map((a) => (
                <Surface
                  key={a.id}
                  style={[styles.attentionCard, { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant }]}
                  elevation={0}
                >
                  <InitialsAvatar initials={a.initials} size={36} color={theme.colors.primaryContainer} />
                  <Text variant="titleSmall" numberOfLines={1} style={{ fontWeight: '700', color: theme.colors.onSurface, marginTop: 8 }}>
                    {a.fullName}
                  </Text>
                  <Text variant="labelSmall" style={{ color: '#F87171', fontWeight: '700' }}>
                    ACWR {a.acwr?.toFixed(2)} · {a.acuteLoad} AU/wk
                  </Text>
                </Surface>
              ))}
            </View>
          </>
        )}

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
      </ScrollView>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  gridCard: {
    width: '47.5%',
    flexGrow: 1,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 2,
  },
  gridLabel: {
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  readinessCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  barHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  attentionCard: {
    width: '47.5%',
    flexGrow: 1,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  nextSessionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
});
