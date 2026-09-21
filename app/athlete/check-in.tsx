import React, { useCallback, useState } from 'react';
import {
  Alert,
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
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';

import { useRouter } from 'expo-router';

import TrainingRegimeView from '@/components/TrainingRegimeView';
import WatchReadinessModal, { WatchTrackingCard } from '@/components/WatchReadinessModal';
import { DeviceLink, getActiveDeviceLink } from '@/lib/deviceLink';
import {
  DbSession,
  acceptSession,
  cancelSessionAcceptance,
  getCurrentAthleteRecord,
  getLatestUpcomingSession,
  hasAthleteAccepted,
} from '@/lib/sessionService';

// ─── Location Radar Visualization ────────────────────────────

interface LocationRadarProps {
  venueName?: string;
  isHome?: boolean;
  radius?: number;
}

function LocationRadar({
  venueName = 'Ormoc Training Venue',
  isHome = false,
  radius = 100,
}: LocationRadarProps) {
  const theme = useTheme();
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;

  if (isHome) {
    return (
      <View style={radarStyles.container}>
        <Svg width={size} height={170} viewBox={`0 0 ${size} 170`}>
          <Rect
            x={0}
            y={0}
            width={size}
            height={170}
            rx={20}
            ry={20}
            fill={theme.colors.primaryContainer}
            opacity={0.25}
          />
          {/* Gentle concentric rings */}
          <Circle
            cx={cx}
            cy={85}
            r={58}
            stroke={theme.colors.primary}
            strokeWidth={1.5}
            strokeDasharray="6,4"
            fill="none"
            opacity={0.35}
          />
          <Circle
            cx={cx}
            cy={85}
            r={30}
            stroke={theme.colors.primary}
            strokeWidth={1}
            fill={theme.colors.primary}
            opacity={0.1}
          />
          <Circle cx={cx} cy={85} r={8} fill={theme.colors.primary} />
        </Svg>

        <View
          style={[
            radarStyles.homeBadge,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
        >
          <Icon source="home-outline" size={16} color={theme.colors.primary} />
          <Text
            variant="labelMedium"
            style={{ color: theme.colors.primary, fontWeight: '700', marginLeft: 6 }}
          >
            At Home Training · No Geofence Required
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={radarStyles.container}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background fill */}
        <Rect
          x={0}
          y={0}
          width={size}
          height={size}
          rx={20}
          ry={20}
          fill={theme.colors.primaryContainer}
          opacity={0.25}
        />

        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <React.Fragment key={fraction}>
            <Line
              x1={cx * fraction}
              y1={0}
              x2={cx * fraction}
              y2={size}
              stroke={theme.colors.primary}
              strokeWidth={0.5}
              opacity={0.15}
            />
            <Line
              x1={cx + cx * fraction}
              y1={0}
              x2={cx + cx * fraction}
              y2={size}
              stroke={theme.colors.primary}
              strokeWidth={0.5}
              opacity={0.15}
            />
            <Line
              x1={0}
              y1={cy * fraction}
              x2={size}
              y2={cy * fraction}
              stroke={theme.colors.primary}
              strokeWidth={0.5}
              opacity={0.15}
            />
            <Line
              x1={0}
              y1={cy + cy * fraction}
              x2={size}
              y2={cy + cy * fraction}
              stroke={theme.colors.primary}
              strokeWidth={0.5}
              opacity={0.15}
            />
          </React.Fragment>
        ))}

        {/* Dashed concentric circles (geofence rings) */}
        <Circle
          cx={cx}
          cy={cy}
          r={95}
          stroke={theme.colors.primary}
          strokeWidth={1.5}
          strokeDasharray="6,4"
          fill="none"
          opacity={0.4}
        />
        <Circle
          cx={cx}
          cy={cy}
          r={60}
          stroke={theme.colors.primary}
          strokeWidth={1.5}
          strokeDasharray="6,4"
          fill="none"
          opacity={0.3}
        />

        {/* Inner zone fill */}
        <Circle
          cx={cx}
          cy={cy}
          r={60}
          fill={theme.colors.primary}
          opacity={0.08}
        />

        {/* User location dot */}
        <Circle cx={cx} cy={cy - 8} r={10} fill="#E8763E" opacity={0.9} />
        <Circle cx={cx} cy={cy - 8} r={5} fill="#F59E4E" />
      </Svg>

      {/* Venue label overlay */}
      <View
        style={[
          radarStyles.venueLabel,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.outlineVariant,
          },
        ]}
      >
        <Text
          variant="labelSmall"
          style={{ color: theme.colors.onSurface, fontWeight: '700', fontSize: 11 }}
          numberOfLines={1}
        >
          📍 {venueName}
        </Text>
        <Text
          variant="labelSmall"
          style={{ color: theme.colors.onSurfaceVariant, fontSize: 10, marginTop: 1 }}
        >
          Geofence: {radius}m radius
        </Text>
      </View>
    </View>
  );
}

const radarStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  venueLabel: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  homeBadge: {
    position: 'absolute',
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
});

// ─── Main Screen ─────────────────────────────────────────────

export default function CheckInScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [athleteRecord, setAthleteRecord] = useState<{
    id: number;
    userId?: string;
    fullName: string;
    username: string;
    email: string;
  } | null>(null);
  const [upcomingSession, setUpcomingSession] = useState<DbSession | null>(null);
  const [deviceLink, setDeviceLink] = useState<DeviceLink | null>(null);
  const [showWatchModal, setShowWatchModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showAttendees, setShowAttendees] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      const athlete = await getCurrentAthleteRecord();
      if (athlete) {
        setAthleteRecord(athlete);
        if (athlete.userId) {
          const link = await getActiveDeviceLink(athlete.userId);
          setDeviceLink(link);
        }
      }
      const session = await getLatestUpcomingSession();
      setUpcomingSession(session);
    } catch (err) {
      console.error('Failed to load check-in data:', err);
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

  const handleCheckIn = async () => {
    if (!upcomingSession) return;

    if (!athleteRecord) {
      Alert.alert('Error', 'Unable to retrieve your Athlete ID. Please sign in again.');
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

        // Refresh device link
        if (athleteRecord.userId) {
          const link = await getActiveDeviceLink(athleteRecord.userId);
          setDeviceLink(link);
        }

        Alert.alert(
          'Check-in Confirmed! ✓',
          `Your check-in has been registered with your Coach under Athlete ID #${athleteRecord.id}.\n\nNext: Ensure your Wear OS watch is ready to track training movements.`,
          [
            {
              text: 'Check Watch Readiness',
              onPress: () => setShowWatchModal(true),
            },
          ]
        );

        // Open watch readiness modal
        setShowWatchModal(true);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to check in for session.');
    } finally {
      setAccepting(false);
    }
  };

  const handleCancelCheckIn = () => {
    if (!upcomingSession || !athleteRecord) return;

    Alert.alert(
      'Cancel Check-in',
      'Are you sure you want to cancel your check-in for this session?',
      [
        { text: 'Keep Check-in', style: 'cancel' },
        {
          text: 'Cancel Check-in',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              const res = await cancelSessionAcceptance(upcomingSession.id, athleteRecord.id);
              if (res.success && res.session) {
                setUpcomingSession(res.session);
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to cancel check-in.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

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

  const isAccepted = hasAthleteAccepted(upcomingSession, athleteRecord?.id);
  const attendees = upcomingSession?.acceptedAthletes || [];
  const isHome = upcomingSession?.locationType === 'at_home';
  const venueDisplay = isHome
    ? 'At Home'
    : upcomingSession?.venueName || 'Ormoc Training Venue';

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
        {/* ─── Page Title & Athlete Identity ─── */}
        <View style={styles.titleRow}>
          <View>
            <Text
              variant="headlineLarge"
              style={[styles.pageTitle, { color: theme.colors.onBackground }]}
            >
              Check In
            </Text>
            {athleteRecord && (
              <Text
                variant="labelMedium"
                style={{ color: theme.colors.primary, fontWeight: '700' }}
              >
                Logged in as {athleteRecord.fullName} · Athlete ID #{athleteRecord.id}
              </Text>
            )}
          </View>
        </View>

        {/* ─── If No Upcoming Session ─── */}
        {!upcomingSession ? (
          <Card
            mode="elevated"
            style={[
              styles.sessionCard,
              { backgroundColor: theme.colors.elevation.level1 },
            ]}
          >
            <Card.Content style={styles.emptyContent}>
              <Icon
                source="calendar-blank-outline"
                size={54}
                color={theme.colors.outlineVariant}
              />
              <Text
                variant="titleMedium"
                style={{ color: theme.colors.onSurface, fontWeight: '700', marginTop: 12 }}
              >
                No Scheduled Session
              </Text>
              <Text
                variant="bodySmall"
                style={{
                  color: theme.colors.onSurfaceVariant,
                  textAlign: 'center',
                  marginTop: 4,
                  lineHeight: 18,
                }}
              >
                Your coach has not scheduled any training sessions yet. Once a session is
                created, you can view the training regime and check in here.
              </Text>
              <Button
                mode="outlined"
                icon="refresh"
                onPress={() => loadData(true)}
                style={{ marginTop: 16, borderRadius: 12 }}
              >
                Refresh Sessions
              </Button>
            </Card.Content>
          </Card>
        ) : (
          <>
            {/* ─── Session + Location Card ─── */}
            <Card
              mode="elevated"
              style={[
                styles.sessionCard,
                { backgroundColor: theme.colors.elevation.level1 },
              ]}
            >
              <Card.Content>
                {/* Session title & timing */}
                <View style={styles.sessionHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text
                      variant="titleLarge"
                      style={{ color: theme.colors.onSurface, fontWeight: '700' }}
                    >
                      {upcomingSession.title}
                    </Text>
                    <Text
                      variant="bodyMedium"
                      style={{ color: theme.colors.onSurfaceVariant, marginTop: 3 }}
                    >
                      {upcomingSession.date} · {upcomingSession.startTime}–{upcomingSession.endTime}
                    </Text>
                    <Text
                      variant="bodySmall"
                      style={{ color: theme.colors.primary, fontWeight: '600', marginTop: 2 }}
                    >
                      {isHome ? '🏠 At Home Session' : `📍 ${venueDisplay}`}
                    </Text>
                  </View>

                  <Chip
                    compact
                    style={{ backgroundColor: theme.colors.primaryContainer }}
                    textStyle={{
                      color: theme.colors.primary,
                      fontSize: 11,
                      fontWeight: '700',
                    }}
                  >
                    {upcomingSession.totalDurationMinutes} min
                  </Chip>
                </View>

                {/* Location Radar Visualization */}
                <LocationRadar
                  venueName={venueDisplay}
                  isHome={isHome}
                  radius={upcomingSession.geofenceRadius || 100}
                />

                {/* Status indicator row */}
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      {
                        backgroundColor: isAccepted
                          ? '#2E7D32'
                          : theme.colors.primary,
                      },
                    ]}
                  />
                  <Text
                    variant="bodyMedium"
                    style={{ color: theme.colors.onSurface, fontWeight: '600' }}
                  >
                    {isHome
                      ? 'Remote Home Training Active'
                      : 'Training Venue Geofence Active'}
                  </Text>
                  {!isHome && (
                    <Text
                      variant="bodyMedium"
                      style={{ color: theme.colors.onSurfaceVariant, marginLeft: 4 }}
                    >
                      (± {upcomingSession.geofenceRadius || 100}m)
                    </Text>
                  )}
                </View>
              </Card.Content>
            </Card>

            {/* ─── Acceptance Status Banner ─── */}
            {isAccepted ? (
              <>
                <View style={styles.acceptedBanner}>
                  <Icon source="check-circle" size={24} color="#2E7D32" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#1B5E3B', fontWeight: '700', fontSize: 14 }}>
                      Checked In & Accepted ✓
                    </Text>
                    <Text style={{ color: '#2E7D32', fontSize: 12, marginTop: 2 }}>
                      Confirmed with Coach under Athlete ID #{athleteRecord?.id} ({athleteRecord?.fullName})
                    </Text>
                  </View>
                  <Button
                    mode="text"
                    compact
                    textColor="#C62828"
                    onPress={handleCancelCheckIn}
                    loading={cancelling}
                    disabled={cancelling}
                    labelStyle={{ fontSize: 12, fontWeight: '700' }}
                  >
                    Cancel
                  </Button>
                </View>

                {/* Smartwatch Movement Tracking Card */}
                <WatchTrackingCard
                  deviceLink={deviceLink}
                  onVerifyPress={() => setShowWatchModal(true)}
                  onSetupPress={() => router.push('/athlete/smartwatch-setup' as any)}
                />
              </>
            ) : null}

            {/* ─── Check In / Acceptance Action Button ─── */}
            {isAccepted ? (
              <Button
                mode="contained"
                icon="check"
                disabled
                style={[styles.checkInButton, { backgroundColor: '#2E7D32' }]}
                contentStyle={styles.checkInButtonContent}
                labelStyle={[styles.checkInButtonLabel, { color: '#FFFFFF' }]}
              >
                Checked In · Athlete ID #{athleteRecord?.id}
              </Button>
            ) : (
              <Button
                mode="contained"
                icon="clipboard-check-outline"
                onPress={handleCheckIn}
                loading={accepting}
                disabled={accepting}
                style={styles.checkInButton}
                contentStyle={styles.checkInButtonContent}
                labelStyle={styles.checkInButtonLabel}
              >
                {accepting
                  ? 'Confirming Check-in...'
                  : `Check In Now (Athlete ID #${athleteRecord?.id ?? '—'})`}
              </Button>
            )}

            {/* ─── Disclaimer ─── */}
            <Text
              variant="bodySmall"
              style={[styles.disclaimer, { color: theme.colors.onSurfaceVariant }]}
            >
              Check-in registers your attendance and Wear OS sync with your Coach.
            </Text>

            {/* ─── Training Regime Breakdown (Live from Database) ─── */}
            <TrainingRegimeView
              drills={upcomingSession.drills || []}
              title={`${upcomingSession.title} Regime`}
            />

            {/* ─── Window Status Card ─── */}
            <Card
              mode="outlined"
              style={[
                styles.windowCard,
                { borderColor: theme.colors.outlineVariant },
              ]}
            >
              <Card.Content style={styles.windowCardContent}>
                <View>
                  <Text
                    variant="titleSmall"
                    style={{ color: theme.colors.onSurface, fontWeight: '700' }}
                  >
                    Check-in Window
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
                  >
                    Opens 15 min prior to {upcomingSession.startTime}
                  </Text>
                </View>
                <Chip
                  compact
                  icon="clock-check-outline"
                  style={{ backgroundColor: theme.colors.primaryContainer }}
                  textStyle={{
                    color: theme.colors.primary,
                    fontSize: 12,
                    fontWeight: '700',
                  }}
                >
                  {isAccepted ? 'Checked In' : 'Active'}
                </Chip>
              </Card.Content>
            </Card>

            {/* ─── Accepted Athletes Roster (With Athlete IDs) ─── */}
            {attendees.length > 0 && (
              <Surface
                style={[
                  styles.rosterCard,
                  {
                    backgroundColor: theme.colors.elevation.level1,
                    borderColor: theme.colors.outlineVariant,
                  },
                ]}
                elevation={0}
              >
                <View style={styles.rosterHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon source="account-multiple-check" size={20} color={theme.colors.primary} />
                    <Text
                      variant="titleSmall"
                      style={{ color: theme.colors.onSurface, fontWeight: '700' }}
                    >
                      Accepted Teammates ({attendees.length})
                    </Text>
                  </View>
                  <Button
                    compact
                    mode="text"
                    onPress={() => setShowAttendees(!showAttendees)}
                    labelStyle={{ fontSize: 12 }}
                  >
                    {showAttendees ? 'Hide' : 'Show All'}
                  </Button>
                </View>

                {showAttendees && (
                  <View style={styles.rosterList}>
                    <Divider style={{ marginVertical: 8 }} />
                    {attendees.map((item, idx) => {
                      const isMe = item.athleteId === athleteRecord?.id;
                      return (
                        <View key={idx} style={styles.attendeeRow}>
                          <Avatar.Text
                            size={28}
                            label={item.athleteName.slice(0, 2).toUpperCase()}
                            style={{
                              backgroundColor: isMe
                                ? theme.colors.primary
                                : theme.colors.elevation.level3,
                            }}
                            color={isMe ? '#FFFFFF' : theme.colors.onSurface}
                            labelStyle={{ fontSize: 11, fontWeight: '700' }}
                          />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text
                              variant="bodyMedium"
                              style={{
                                color: theme.colors.onSurface,
                                fontWeight: isMe ? '700' : '500',
                              }}
                            >
                              {item.athleteName} {isMe ? '(You)' : ''}
                            </Text>
                            <Text
                              variant="labelSmall"
                              style={{ color: theme.colors.primary, fontWeight: '700' }}
                            >
                              Athlete ID #{item.athleteId}
                            </Text>
                          </View>
                          <Chip
                            compact
                            style={{ backgroundColor: '#E8F5E9' }}
                            textStyle={{ color: '#2E7D32', fontSize: 10, fontWeight: '700' }}
                          >
                            Accepted
                          </Chip>
                        </View>
                      );
                    })}
                  </View>
                )}
              </Surface>
            )}
          </>
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
    paddingBottom: 36,
    gap: 16,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  pageTitle: {
    fontWeight: '700',
  },

  // Session + Location card
  sessionCard: {
    borderRadius: 20,
  },
  sessionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  emptyContent: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 16,
  },

  // Status row
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  // Accepted Banner
  acceptedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    borderColor: '#A5D6A7',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },

  // Check-in button
  checkInButton: {
    borderRadius: 16,
    marginTop: 2,
  },
  checkInButtonContent: {
    height: 56,
  },
  checkInButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Disclaimer
  disclaimer: {
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 18,
    paddingHorizontal: 16,
  },

  // Window status
  windowCard: {
    borderRadius: 16,
  },
  windowCardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // Accepted Teammates Roster
  rosterCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  rosterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rosterList: {
    gap: 10,
  },
  attendeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
});
