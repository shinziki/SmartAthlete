import { CATEGORY_CONFIG } from '@/components/DrillsEditor';
import ReadinessRing from '@/components/ReadinessRing';
import WatchReadinessModal, { WatchTrackingCard } from '@/components/WatchReadinessModal';
import { DeviceLink, getActiveDeviceLink } from '@/lib/deviceLink';
import {
  DbSession,
  SessionMetricRecord,
  acceptSession,
  cancelSessionAcceptance,
  fetchAthleteSessionHistory,
  getCurrentAthleteRecord,
  getUpcomingSessions,
  hasAthleteAccepted,
} from '@/lib/sessionService';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Avatar,
  Button,
  Card,
  Chip,
  Divider,
  Icon,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Helpers ──────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

interface HomeStats {
  lastLoad: number | null;
  weekSessions: number;
  weekJumps: number;
  weekDailyLoad: number[]; // Mon..Sun
  todayIndex: number; // 0 = Mon
  attendancePct: number | null;
  readiness: { value: number; label: string; sublabel: string };
}

function computeHomeStats(
  history: SessionMetricRecord[],
  sessions: DbSession[],
  athleteId?: number
): HomeStats {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date();
  const weekStart = startOfWeek(now).getTime();

  const weekDailyLoad = [0, 0, 0, 0, 0, 0, 0];
  let weekSessions = 0;
  let weekJumps = 0;
  let acute = 0;
  let chronic = 0;

  for (const r of history) {
    const d = new Date(r.completedAt);
    const t = d.getTime();
    if (isNaN(t)) continue;

    if (t >= weekStart) {
      weekSessions += 1;
      weekJumps += r.jumps;
      weekDailyLoad[(d.getDay() + 6) % 7] += r.playerLoadAU;
    }

    const age = now.getTime() - t;
    if (age >= 0 && age <= 7 * DAY) acute += r.playerLoadAU;
    if (age >= 0 && age <= 28 * DAY) chronic += r.playerLoadAU;
  }

  // Load-based readiness: this week's load vs. your 4-week weekly average.
  const chronicWeekly = chronic / 4;
  let readiness: HomeStats['readiness'];
  if (chronicWeekly <= 0) {
    readiness = { value: 0, label: 'No data', sublabel: 'finish a session first' };
  } else {
    const ratio = acute / chronicWeekly;
    const penalty = ratio > 1.3 ? (ratio - 1.3) * 150 : ratio < 0.8 ? (0.8 - ratio) * 50 : 0;
    const value = Math.max(0, Math.min(100, Math.round(100 - penalty)));
    readiness = {
      value,
      label: value >= 75 ? 'Good' : value >= 50 ? 'Moderate' : 'Low',
      sublabel: 'based on training load',
    };
  }

  // Attendance: finished sessions in the last 30 days that the athlete accepted or tracked.
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (x: Date) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  const today = fmt(now);
  const from = fmt(new Date(now.getTime() - 30 * DAY));
  const past = sessions.filter((s) => s.date >= from && s.date < today);
  const trackedIds = new Set(history.filter((r) => r.sessionId != null).map((r) => String(r.sessionId)));
  let attendancePct: number | null = null;
  if (past.length > 0 && athleteId != null) {
    const attended = past.filter(
      (s) =>
        s.acceptedAthletes.some((a) => a.athleteId === athleteId) || trackedIds.has(String(s.id))
    ).length;
    attendancePct = Math.round((attended / past.length) * 100);
  }

  return {
    lastLoad: history[0] ? Math.round(history[0].playerLoadAU) : null,
    weekSessions,
    weekJumps,
    weekDailyLoad,
    todayIndex: (now.getDay() + 6) % 7,
    attendancePct,
    readiness,
  };
}

// ─── Mini Bar Chart Component ────────────────────────────────

// function MiniBarChart({ color }: { color: string }) {
//   const barHeights = [14, 22, 10, 28, 18];
//   return (
//     <View style={miniBarStyles.container}>
//       {barHeights.map((h, i) => (
//         <View
//           key={i}
//           style={[
//             miniBarStyles.bar,
//             {
//               height: h,
//               backgroundColor: color,
//               opacity: i === barHeights.length - 1 ? 1 : 0.45,
//             },
//           ]}
//         />
//       ))}
//     </View>
//   );
// }

// const miniBarStyles = StyleSheet.create({
//   container: {
//     flexDirection: 'row',
//     alignItems: 'flex-end',
//     gap: 3,
//     height: 30,
//   },
//   bar: {
//     width: 6,
//     borderRadius: 3,
//   },
// });

function MiniBarChart({
  values,
  highlightIndex,
  color,
}: {
  values: number[];
  highlightIndex: number;
  color: string;
}) {
  const max = Math.max(...values, 0);
  return (
    <View style={miniBarStyles.container}>
      {values.map((v, i) => (
        <View
          key={i}
          style={[
            miniBarStyles.bar,
            {
              height: v > 0 ? Math.max(6, (v / max) * 28) : 3,
              backgroundColor: color,
              opacity: i === highlightIndex ? 1 : v > 0 ? 0.45 : 0.2,
            },
          ]}
        />
      ))}
    </View>
  );
}

const miniBarStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 30,
  },
  bar: {
    width: 5,
    borderRadius: 3,
  },
});

// ─── Main Screen ─────────────────────────────────────────────

export default function AthleteHomeScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [athleteName, setAthleteName] = useState<string>('Athlete');
  const [athleteRecord, setAthleteRecord] = useState<{
    id: number;
    userId?: string;
    fullName: string;
    username: string;
    email: string;
  } | null>(null);
  const [upcomingSession, setUpcomingSession] = useState<DbSession | null>(null);
  const [allSessions, setAllSessions] = useState<DbSession[]>([]);
  const [history, setHistory] = useState<SessionMetricRecord[]>([]);
  const [deviceLink, setDeviceLink] = useState<DeviceLink | null>(null);
  const [showWatchModal, setShowWatchModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showRegime, setShowRegime] = useState(true);
  const [showAttendees, setShowAttendees] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      const athlete = await getCurrentAthleteRecord();
      if (athlete) {
        setAthleteRecord(athlete);
        setAthleteName(athlete.fullName);
        if (athlete.userId) {
          const link = await getActiveDeviceLink(athlete.userId);
          setDeviceLink(link);
        }
      }

      const [sessions, historyRes] = await Promise.all([
        getUpcomingSessions(),
        fetchAthleteSessionHistory(athlete?.id),
      ]);
      setAllSessions(sessions);
      setUpcomingSession(sessions[0] ?? null);
      setHistory(historyRes.data);
    } catch (err) {
      console.error('Failed to load athlete home data:', err);
    } finally {
      setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData(false);
    }, [loadData])
  );

  const handleAcceptSession = async () => {
    if (!upcomingSession) return;

    if (!athleteRecord) {
      Alert.alert('Error', 'Unable to retrieve your athlete ID. Please re-login.');
      return;
    }

    setAccepting(true);
    try {
      const res = await acceptSession(upcomingSession.id, {
        athleteId: athleteRecord.id,
        athleteName: athleteRecord.fullName,
        username: athleteRecord.username,
      });

      if (res.success && res.session) {
        setUpcomingSession(res.session);

        if (athleteRecord.userId) {
          const link = await getActiveDeviceLink(athleteRecord.userId);
          setDeviceLink(link);
        }

        Alert.alert(
          'Session Accepted! ✓',
          `You have accepted this session. Your confirmation is registered with Coach under Athlete ID #${athleteRecord.id}.\n\nNext: Ensure your Wear OS watch is ready to track training movements.`,
          [
            {
              text: 'Check Watch Readiness',
              onPress: () => setShowWatchModal(true),
            },
          ]
        );

        setShowWatchModal(true);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to accept session.');
    } finally {
      setAccepting(false);
    }
  };

  const handleCancelAcceptance = () => {
    if (!upcomingSession || !athleteRecord) return;

    Alert.alert(
      'Withdraw Acceptance',
      'Are you sure you want to withdraw your acceptance for this session?',
      [
        { text: 'Keep Acceptance', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              const res = await cancelSessionAcceptance(upcomingSession.id, athleteRecord.id);
              if (res.success && res.session) {
                setUpcomingSession(res.session);
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to withdraw acceptance.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const stats = useMemo(() => {
    const sessions = allSessions.map((s) =>
      upcomingSession && s.id === upcomingSession.id ? upcomingSession : s
    );
    return computeHomeStats(history, sessions, athleteRecord?.id);
  }, [history, allSessions, upcomingSession, athleteRecord?.id]);

  if (loading) {
    return (
      <SafeAreaView
        style={[
          styles.safeArea,
          styles.loadingContainer,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  const initials = getInitials(athleteName);
  const isAccepted = hasAthleteAccepted(upcomingSession, athleteRecord?.id);
  const attendees = upcomingSession?.acceptedAthletes || [];

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* ─── Header ─── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View>
              <Text
                variant="bodyMedium"
                style={{ color: theme.colors.primary, fontWeight: '500' }}
              >
                {getGreeting()}
              </Text>
              <Text
                variant="headlineSmall"
                style={[styles.athleteName, { color: theme.colors.onBackground }]}
              >
                {athleteName} 👋
              </Text>
              {athleteRecord && (
                <Text
                  variant="labelSmall"
                  style={{ color: theme.colors.onSurfaceVariant, fontWeight: '600' }}
                >
                  Athlete ID #{athleteRecord.id}
                </Text>
              )}
            </View>
          </View>
          <Avatar.Text
            size={44}
            label={initials}
            style={{ backgroundColor: theme.colors.primary }}
            color={theme.colors.onPrimary}
            labelStyle={{ fontWeight: '700', fontSize: 16 }}
          />
        </View>

        {/* ─── Today's Readiness Card ─── */}
        <Card
          mode="elevated"
          style={[
            styles.readinessCard,
            { backgroundColor: theme.colors.elevation.level1 },
          ]}
        >
          <Card.Content style={styles.readinessContent}>
            <Text
              variant="labelLarge"
              style={[
                styles.readinessTitle,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              TODAY'S READINESS
            </Text>

            <View style={styles.readinessRingWrapper}>
              <ReadinessRing
                value={stats.readiness.value}
                size={150}
                strokeWidth={14}
                label={stats.readiness.label}
                sublabel={stats.readiness.sublabel}
              />
            </View>

            <Text
              variant="bodySmall"
              style={[
                styles.readinessDisclaimer,
                { color: theme.colors.outline },
              ]}
            >
              Coaching estimate — not a medical result
            </Text>
          </Card.Content>
        </Card>

        {/* ─── Stats Grid (2×2) ─── */}
        <View style={styles.statsGrid}>
          {/* Last Session */}
          <Surface
            style={[
              styles.statCard,
              { backgroundColor: theme.colors.elevation.level2 },
            ]}
            elevation={0}
          >
            <Text
              variant="labelMedium"
              style={[styles.statLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              LAST SESSION
            </Text>
            <View style={styles.statValueRow}>
              <Text
                variant="headlineMedium"
                style={[styles.statValue, { color: theme.colors.onSurface }]}
              >
                {stats.lastLoad !== null ? stats.lastLoad : '--'}
              </Text>
              <Text
                variant="bodySmall"
                style={[styles.statUnit, { color: theme.colors.onSurfaceVariant }]}
              >
                AU
              </Text>
            </View>
          </Surface>

          {/* This Week */}
          <Surface
            style={[
              styles.statCard,
              { backgroundColor: theme.colors.elevation.level2 },
            ]}
            elevation={0}
          >
            <Text
              variant="labelMedium"
              style={[styles.statLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              THIS WEEK
            </Text>
            <View style={styles.statValueRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text
                    variant="headlineMedium"
                    style={[styles.statValue, { color: theme.colors.onSurface }]}
                  >
                    {stats.weekSessions}
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={[
                      styles.statUnit,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {stats.weekSessions === 1 ? 'session' : 'sessions'}
                  </Text>
                </View>
              </View>
              <MiniBarChart
                values={stats.weekDailyLoad}
                highlightIndex={stats.todayIndex}
                color={theme.colors.primary}
              />
            </View>
          </Surface>

          {/* Attendance */}
          <Surface
            style={[
              styles.statCard,
              { backgroundColor: theme.colors.elevation.level2 },
            ]}
            elevation={0}
          >
            <Text
              variant="labelMedium"
              style={[styles.statLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              ATTENDANCE
            </Text>
            <View style={styles.statValueRow}>
              <Text
                variant="headlineMedium"
                style={[styles.statValue, { color: theme.colors.onSurface }]}
              >
                {stats.attendancePct !== null ? stats.attendancePct : '--'}
              </Text>
              <Text
                variant="bodySmall"
                style={[styles.statUnit, { color: theme.colors.onSurfaceVariant }]}
              >
                %
              </Text>
            </View>
          </Surface>

          {/* Jumps (WK) */}
          <Surface
            style={[
              styles.statCard,
              { backgroundColor: theme.colors.elevation.level2 },
            ]}
            elevation={0}
          >
            <Text
              variant="labelMedium"
              style={[styles.statLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              JUMPS (WK)
            </Text>
            <Text
              variant="headlineMedium"
              style={[styles.statValue, { color: theme.colors.onSurface }]}
            >
              {stats.weekJumps}
            </Text>
          </Surface>
        </View>

        {/* ─── Next Upcoming Session Card (from Database) ─── */}
        {!upcomingSession ? (
          <Card
            mode="elevated"
            style={[
              styles.nextSessionCard,
              { backgroundColor: theme.colors.elevation.level1 },
            ]}
          >
            <Card.Content style={styles.noSessionContent}>
              <Icon
                source="calendar-blank-outline"
                size={42}
                color={theme.colors.outlineVariant}
              />
              <Text
                variant="titleMedium"
                style={{ color: theme.colors.onSurface, fontWeight: '700' }}
              >
                No Upcoming Sessions
              </Text>
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
              >
                Your coach has not scheduled any upcoming sessions yet.
              </Text>
            </Card.Content>
          </Card>
        ) : (
          <Card
            mode="elevated"
            style={[
              styles.nextSessionCard,
              { backgroundColor: theme.colors.elevation.level1 },
            ]}
          >
            <Card.Content style={{ gap: 12 }}>
              {/* Top Header Row */}
              <View style={styles.nextSessionHeaderRow}>
                <Text
                  variant="titleMedium"
                  style={[styles.nextSessionTitle, { color: theme.colors.onSurface }]}
                >
                  Upcoming Session
                </Text>
                {upcomingSession.drills && upcomingSession.drills.length > 0 && (
                  <Chip
                    compact
                    icon="clock-outline"
                    style={{ backgroundColor: theme.colors.primaryContainer }}
                    textStyle={{
                      color: theme.colors.primary,
                      fontWeight: '700',
                      fontSize: 11,
                    }}
                  >
                    {upcomingSession.drills.length} drills · {upcomingSession.totalDurationMinutes}m
                  </Chip>
                )}
              </View>

              {/* Session Details */}
              <View style={styles.nextSessionRow}>
                <View
                  style={[
                    styles.nextSessionIcon,
                    { backgroundColor: theme.colors.primaryContainer },
                  ]}
                >
                  <Icon
                    source={
                      upcomingSession.locationType === 'at_home'
                        ? 'home'
                        : 'map-marker'
                    }
                    size={24}
                    color={theme.colors.primary}
                  />
                </View>
                <View style={styles.nextSessionInfo}>
                  <Text
                    variant="bodyLarge"
                    style={{ color: theme.colors.onSurface, fontWeight: '700' }}
                  >
                    {upcomingSession.title}
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    {upcomingSession.date} · {upcomingSession.startTime}–{upcomingSession.endTime}
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.primary, fontWeight: '600', marginTop: 2 }}
                  >
                    {upcomingSession.locationType === 'at_home'
                      ? '🏠 At Home'
                      : `📍 ${upcomingSession.venueName || 'Ormoc Venue'}`}
                  </Text>
                </View>
              </View>

              {/* Acceptance Status / Action Button */}
              {isAccepted ? (
                <>
                  <View style={styles.acceptedBanner}>
                    <Icon source="check-circle" size={20} color="#2E7D32" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#1B5E3B', fontWeight: '700', fontSize: 13 }}>
                        You accepted this session
                      </Text>
                      <Text style={{ color: '#2E7D32', fontSize: 11 }}>
                        Registered under Athlete ID #{athleteRecord?.id}
                      </Text>
                    </View>
                    <Button
                      mode="text"
                      compact
                      textColor="#C62828"
                      onPress={handleCancelAcceptance}
                      loading={cancelling}
                      disabled={cancelling}
                      labelStyle={{ fontSize: 11, fontWeight: '700' }}
                    >
                      Withdraw
                    </Button>
                  </View>

                  {/* Smartwatch Movement Tracking Card */}
                  <WatchTrackingCard
                    deviceLink={deviceLink}
                    onVerifyPress={() => setShowWatchModal(true)}
                    onSetupPress={() => router.push('/athlete/smartwatch-setup' as any)}
                  />
                </>
              ) : (
                <Button
                  mode="contained"
                  icon="check"
                  onPress={handleAcceptSession}
                  loading={accepting}
                  disabled={accepting}
                  style={styles.acceptButton}
                  contentStyle={{ paddingVertical: 4 }}
                  labelStyle={{ fontWeight: '700', fontSize: 14 }}
                >
                  {athleteRecord?.id
                    ? `Accept session (Athlete ID #${athleteRecord.id})`
                    : 'Accept session'}
                </Button>
              )}

              {/* Accepted Athletes Roster Counter */}
              <View style={styles.attendeesCounterRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon source="account-check-outline" size={16} color={theme.colors.primary} />
                  <Text
                    variant="labelMedium"
                    style={{ color: theme.colors.onSurface, fontWeight: '600' }}
                  >
                    {attendees.length} {attendees.length === 1 ? 'Athlete' : 'Athletes'} Accepted
                  </Text>
                </View>
                {attendees.length > 0 && (
                  <Button
                    mode="text"
                    compact
                    onPress={() => setShowAttendees(!showAttendees)}
                    labelStyle={{ fontSize: 12, marginHorizontal: 0 }}
                  >
                    {showAttendees ? 'Hide Roster' : 'View Roster'}
                  </Button>
                )}
              </View>

              {/* Accepted Athletes List with Athlete ID */}
              {showAttendees && attendees.length > 0 && (
                <View style={styles.attendeesListContainer}>
                  {attendees.map((att, i) => (
                    <View
                      key={`${att.athleteId}-${i}`}
                      style={[
                        styles.attendeePill,
                        { backgroundColor: theme.colors.elevation.level2 },
                      ]}
                    >
                      <View style={styles.athleteIdBadge}>
                        <Text style={styles.athleteIdText}>ID #{att.athleteId}</Text>
                      </View>
                      <Text
                        variant="bodySmall"
                        style={{ color: theme.colors.onSurface, fontWeight: '600', flex: 1 }}
                        numberOfLines={1}
                      >
                        {att.athleteName}
                      </Text>
                      <Icon source="check-circle" size={14} color="#2E7D32" />
                    </View>
                  ))}
                </View>
              )}

              {/* Training Regime Breakdown (Real Drills from Coach) */}
              {upcomingSession.drills && upcomingSession.drills.length > 0 && (
                <>
                  <Divider style={{ marginVertical: 2 }} />

                  <Pressable
                    onPress={() => setShowRegime(!showRegime)}
                    style={styles.regimeToggleRow}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon source="clipboard-list-outline" size={18} color={theme.colors.primary} />
                      <Text
                        variant="labelMedium"
                        style={{ color: theme.colors.primary, fontWeight: '700' }}
                      >
                        Training Regime ({upcomingSession.drills.length} drills)
                      </Text>
                    </View>
                    <Icon
                      source={showRegime ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={theme.colors.primary}
                    />
                  </Pressable>

                  {showRegime && (
                    <View style={styles.regimeList}>
                      {upcomingSession.drills.map((d, i) => {
                        const cat = CATEGORY_CONFIG[d.category] || CATEGORY_CONFIG['Tactics'];
                        return (
                          <View
                            key={d.id || i}
                            style={[
                              styles.regimeItem,
                              { backgroundColor: theme.colors.elevation.level2 },
                            ]}
                          >
                            <View style={styles.regimeItemLeft}>
                              <View style={styles.regimeIndexBadge}>
                                <Text style={styles.regimeIndexText}>#{i + 1}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text
                                  variant="bodyMedium"
                                  style={{ color: theme.colors.onSurface, fontWeight: '600' }}
                                  numberOfLines={1}
                                >
                                  {d.name}
                                </Text>
                                <View style={{ flexDirection: 'row', marginTop: 2 }}>
                                  <View
                                    style={[
                                      styles.regimeCategoryTag,
                                      { backgroundColor: cat.bgColor },
                                    ]}
                                  >
                                    <Text
                                      style={{
                                        color: cat.color,
                                        fontSize: 9,
                                        fontWeight: '700',
                                      }}
                                    >
                                      {cat.label}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            </View>

                            <View
                              style={[
                                styles.regimeDurationBadge,
                                { backgroundColor: theme.colors.surface },
                              ]}
                            >
                              <Icon source="clock-outline" size={12} color={theme.colors.primary} />
                              <Text
                                variant="labelSmall"
                                style={{
                                  color: theme.colors.primary,
                                  fontWeight: '700',
                                  fontSize: 11,
                                }}
                              >
                                {d.durationMinutes}m
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </>
              )}
            </Card.Content>
          </Card>
        )}
      </ScrollView>

      {/* ─── Watch Readiness & Movement Tracking Modal ─── */}
      <WatchReadinessModal
        visible={showWatchModal}
        onDismiss={() => setShowWatchModal(false)}
        athleteId={athleteRecord?.id}
        athleteName={athleteRecord?.fullName}
        userId={athleteRecord?.userId}
        sessionTitle={upcomingSession?.title}
        drillCount={upcomingSession?.drills?.length}
        totalDurationMinutes={upcomingSession?.totalDurationMinutes}
        drills={upcomingSession?.drills}
      />
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
    gap: 16,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  headerLeft: {
    flex: 1,
  },
  athleteName: {
    fontWeight: '700',
    marginTop: 2,
  },

  // Readiness Card
  readinessCard: {
    borderRadius: 20,
  },
  readinessContent: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 12,
  },
  readinessTitle: {
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  readinessRingWrapper: {
    marginVertical: 8,
  },
  readinessDisclaimer: {
    fontStyle: 'italic',
  },

  // Stats Grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: '47%',
    flexGrow: 1,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  statLabel: {
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontSize: 11,
  },
  statValue: {
    fontWeight: '700',
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  statUnit: {
    fontWeight: '500',
    marginBottom: 2,
  },

  // Next Session
  nextSessionCard: {
    borderRadius: 20,
  },
  noSessionContent: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  nextSessionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nextSessionTitle: {
    fontWeight: '700',
  },
  nextSessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nextSessionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextSessionInfo: {
    flex: 1,
    gap: 2,
  },

  // Acceptance button / banner
  acceptButton: {
    borderRadius: 14,
    marginTop: 4,
  },
  acceptedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 10,
  },

  // Attendees
  attendeesCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  attendeesListContainer: {
    gap: 6,
    marginTop: 2,
  },
  attendeePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 8,
  },
  athleteIdBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  athleteIdText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Regime
  regimeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  regimeList: {
    gap: 8,
  },
  regimeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  regimeItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  regimeIndexBadge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  regimeIndexText: {
    fontSize: 10,
    fontWeight: '700',
  },
  regimeCategoryTag: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  regimeDurationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginLeft: 8,
  },
});
