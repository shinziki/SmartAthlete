import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  Divider,
  Icon,
  IconButton,
  ProgressBar,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { CATEGORY_CONFIG } from '@/components/DrillsEditor';
import { getLatestUpcomingSession, getCurrentAthleteRecord } from '@/lib/sessionService';
import { getActiveDeviceLink } from '@/lib/deviceLink';
import {
  CompletedSessionMetrics,
  LiveTrackingState,
  trackingService,
} from '@/lib/trackingService';
import {
  pingWatch,
  sendSessionEndToWatch,
  sendSessionNextDrillToWatch,
  sendSessionPauseToWatch,
  sendSessionResumeToWatch,
  startLiveTelemetrySubscription,
} from '@/lib/ble-manager';

// ─── Format Helpers ───────────────────────────────────────────

function formatDuration(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatMeters(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function getHeartRateZone(bpm: number): { label: string; color: string } {
  if (bpm < 100) return { label: 'Warm-up', color: '#4CAF50' };
  if (bpm < 135) return { label: 'Fat Burn', color: '#00BCD4' };
  if (bpm < 160) return { label: 'Aerobic', color: '#FF9800' };
  if (bpm < 175) return { label: 'Anaerobic', color: '#E91E63' };
  return { label: 'Maximum', color: '#F44336' };
}

// ─── Main Screen ──────────────────────────────────────────────

export default function LiveTrackingScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [state, setState] = useState<LiveTrackingState>(trackingService.getState());
  const [initLoading, setInitLoading] = useState(!state.isActive);
  const [summaryData, setSummaryData] = useState<CompletedSessionMetrics | null>(null);
  const [watchNodeId, setWatchNodeId] = useState<string | undefined>(undefined);

  // Ping Watch state
  const [pinging, setPinging] = useState(false);
  const [pingFeedback, setPingFeedback] = useState<string | null>(null);

  // Pulse animation for live sync indicator
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const heartBeatAnim = useRef(new Animated.Value(1)).current;

  // Subscribe to trackingService state updates
  useEffect(() => {
    const unsubscribe = trackingService.subscribe((updated) => {
      setState(updated);
    });
    return unsubscribe;
  }, []);

  // Fetch watch link node id
  useEffect(() => {
    let cancelled = false;
    const fetchWatchLink = async () => {
      try {
        const athlete = await getCurrentAthleteRecord();
        if (athlete?.userId && !cancelled) {
          const link = await getActiveDeviceLink(athlete.userId);
          if (link?.watch_node_id && !cancelled) {
            setWatchNodeId(link.watch_node_id);
          }
        }
      } catch (err) {
        console.warn('Error fetching device link for live tracking:', err);
      }
    };
    fetchWatchLink();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live BLE telemetry subscription: locks time and sensor data to watch
  useEffect(() => {
    const unsubscribe = startLiveTelemetrySubscription(
      watchNodeId,
      (telemetry) => {
        trackingService.updateFromWatch(telemetry);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [watchNodeId]);

  // Initialize session tracking if not already active
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // If not active yet, immediately activate tracking so the screen never gets stuck at 0:00
      if (!trackingService.getState().isActive) {
        trackingService.startTracking(
          null,
          undefined,
          undefined,
          'Wear OS Watch'
        );
      }
      setInitLoading(false);

      try {
        const [athlete, session] = await Promise.all([
          getCurrentAthleteRecord(),
          getLatestUpcomingSession(),
        ]);

        if (cancelled) return;

        let watchName = 'Wear OS Watch';
        if (athlete?.userId) {
          const link = await getActiveDeviceLink(athlete.userId);
          if (link?.watch_name) watchName = link.watch_name;
          if (link?.watch_node_id) setWatchNodeId(link.watch_node_id);
        }

        // If session was loaded from database, update title/drills in state
        if (session) {
          const current = trackingService.getState();
          if (!current.sessionId || current.sessionId === 'live_session') {
            trackingService.startTracking(
              session,
              athlete?.id,
              athlete?.fullName,
              watchName
            );
          }
        }
      } catch (err) {
        console.warn('Background athlete/session fetch error:', err);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  // Animations
  useEffect(() => {
    // Pulse for sync badge
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.25,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Heart beat animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(heartBeatAnim, {
          toValue: 1.18,
          duration: 400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(heartBeatAnim, {
          toValue: 1,
          duration: 400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim, heartBeatAnim]);

  const handlePingWatch = async () => {
    setPinging(true);
    setPingFeedback('Pinging watch…');
    try {
      const res = await pingWatch(watchNodeId);
      setPingFeedback(`✓ Responded ${res.rttMs}ms (Vibrated)`);
      setTimeout(() => setPingFeedback(null), 4000);
    } catch (err: any) {
      setPingFeedback('⚠ Watch not responding');
      setTimeout(() => setPingFeedback(null), 4000);
    } finally {
      setPinging(false);
    }
  };

  const handlePauseResume = () => {
    if (state.isPaused) {
      trackingService.resumeTracking();
      sendSessionResumeToWatch(watchNodeId);
    } else {
      trackingService.pauseTracking();
      sendSessionPauseToWatch(watchNodeId);
    }
  };

  const handleEndSession = () => {
    Alert.alert(
      'End Training Session',
      `Complete tracking for "${state.sessionTitle}"? Tracked movements (${state.steps} steps · ${formatMeters(state.meters)}) will be finalized and saved.`,
      [
        { text: 'Keep Tracking', style: 'cancel' },
        {
          text: 'Finish & Save',
          style: 'destructive',
          onPress: async () => {
            sendSessionEndToWatch(watchNodeId);
            const summary = await trackingService.stopTracking();
            setSummaryData(summary);
          },
        },
      ]
    );
  };

  const handleCloseSummary = () => {
    setSummaryData(null);
    router.replace('/athlete/home' as any);
  };

  if (initLoading) {
    return (
      <SafeAreaView
        style={[styles.safeArea, styles.center, { backgroundColor: theme.colors.background }]}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text variant="bodyMedium" style={{ marginTop: 16, color: theme.colors.onSurfaceVariant }}>
          Connecting to Wear OS Watch & initializing telemetry…
        </Text>
      </SafeAreaView>
    );
  }

  // Current Drill details
  const currentDrill =
    state.drills.length > 0 && state.drills[state.currentDrillIndex]
      ? state.drills[state.currentDrillIndex]
      : null;

  const drillTargetSeconds = currentDrill ? currentDrill.durationMinutes * 60 : 600;
  const drillProgress = Math.min(1, state.currentDrillSeconds / (drillTargetSeconds || 1));
  const hrZone = getHeartRateZone(state.heartRate);

  // Speed estimation (km/h) based on meters & seconds
  const currentSpeedKmH =
    state.elapsedSeconds > 0
      ? ((state.meters / state.elapsedSeconds) * 3.6).toFixed(1)
      : '0.0';

  // Cadence (steps per minute)
  const spm =
    state.elapsedSeconds > 5
      ? Math.round((state.steps / state.elapsedSeconds) * 60)
      : 0;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      {/* ─── Top Header Bar ─── */}
      <View style={styles.topBar}>
        <IconButton
          icon="chevron-down"
          size={24}
          onPress={() => router.back()}
          accessibilityLabel="Minimize tracking"
        />

        <View style={styles.headerTitleGroup}>
          <Text variant="titleMedium" style={{ fontWeight: '800', color: theme.colors.onSurface }}>
            Live Movement Tracking
          </Text>
          <Pressable
            onPress={handlePingWatch}
            style={({ pressed }) => [styles.watchPill, { opacity: pressed ? 0.7 : 1 }]}
            accessibilityLabel="Tap to ping watch"
          >
            <Animated.View
              style={[
                styles.pulseDot,
                {
                  backgroundColor: state.isPaused
                    ? '#FFA000'
                    : state.isMoving
                    ? '#2E7D32'
                    : '#64748B',
                  transform: [{ scale: state.isPaused || !state.isMoving ? 1 : pulseAnim }],
                },
              ]}
            />
            <Text
              variant="labelSmall"
              style={{
                color: state.isPaused
                  ? '#C67C00'
                  : state.isMoving
                  ? '#2E7D32'
                  : '#64748B',
                fontWeight: '700',
                fontSize: 11,
              }}
            >
              {pinging
                ? 'Pinging watch…'
                : pingFeedback
                ? pingFeedback
                : state.isPaused
                ? 'Paused'
                : state.isMoving
                ? `Active · ${state.watchName}`
                : `Stationary (Table) · ${state.watchName}`}
            </Text>
          </Pressable>
        </View>

        <IconButton
          icon="stop-circle-outline"
          iconColor={theme.colors.error}
          size={24}
          onPress={handleEndSession}
          accessibilityLabel="End session"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Watch Match Notification Banner ─── */}
        <Surface
          style={[
            styles.matchBanner,
            {
              backgroundColor: state.isPaused
                ? '#FFFBEB'
                : state.isMoving
                ? '#F0FDF4'
                : theme.colors.elevation.level1,
              borderColor: state.isPaused
                ? '#FDE68A'
                : state.isMoving
                ? '#BBF7D0'
                : theme.colors.outlineVariant,
            },
          ]}
          elevation={0}
        >
          <Icon
            source={state.isPaused ? 'pause-circle' : state.isMoving ? 'run-fast' : 'watch-vibrate'}
            size={20}
            color={state.isPaused ? '#D97706' : state.isMoving ? '#16A34A' : theme.colors.primary}
          />
          <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.onSurface }}>
            {state.isPaused ? (
              <Text style={{ color: '#92400E' }}>
                <Text style={{ fontWeight: '700' }}>Session Paused: </Text>
                Sensor tracking is paused on both smartwatch and mobile.
              </Text>
            ) : state.isMoving ? (
              <Text style={{ color: '#166534' }}>
                <Text style={{ fontWeight: '700' }}>Active Movement Streaming: </Text>
                Real-time steps, pace, and player load are streaming live from your watch IMU.
              </Text>
            ) : (
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                <Text style={{ fontWeight: '700' }}>Watch Resting on Table: </Text>
                Zero motion detected. Steps and distance are held at current count until physical motion begins.
              </Text>
            )}
          </Text>

          <IconButton
            icon="vibrate"
            size={18}
            onPress={handlePingWatch}
            loading={pinging}
            disabled={pinging}
            accessibilityLabel="Ping watch"
            style={{ margin: 0 }}
          />
        </Surface>

        {/* Ping Feedback Pill */}
        {pingFeedback && (
          <Surface
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 10,
              marginBottom: 12,
              backgroundColor: pingFeedback.startsWith('✓') ? '#F0FDF4' : '#FEF2F2',
              borderColor: pingFeedback.startsWith('✓') ? '#BBF7D0' : '#FECACA',
              borderWidth: 1,
            }}
            elevation={0}
          >
            <Icon
              source={pingFeedback.startsWith('✓') ? 'check-circle' : 'alert-circle'}
              size={16}
              color={pingFeedback.startsWith('✓') ? '#16A34A' : '#DC2626'}
            />
            <Text
              variant="labelMedium"
              style={{
                color: pingFeedback.startsWith('✓') ? '#15803D' : '#B91C1C',
                fontWeight: '700',
              }}
            >
              Watch Connection: {pingFeedback}
            </Text>
          </Surface>
        )}

        {/* ─── Hero Dual Metrics: Tracked Steps & Meters ─── */}
        <View style={styles.heroRow}>
          {/* Steps Card */}
          <Surface
            style={[
              styles.heroCard,
              {
                backgroundColor: theme.colors.elevation.level2,
                borderColor: theme.colors.primaryContainer,
              },
            ]}
            elevation={1}
          >
            <View style={styles.heroHeaderRow}>
              <View style={[styles.heroIconBadge, { backgroundColor: theme.colors.primaryContainer }]}>
                <Icon source="shoe-print" size={20} color={theme.colors.primary} />
              </View>
              <Text variant="labelSmall" style={styles.heroMetricLabel}>
                TRACKED STEPS
              </Text>
            </View>

            <Text variant="displaySmall" style={[styles.heroMetricValue, { color: theme.colors.onSurface }]}>
              {state.steps.toLocaleString()}
            </Text>

            <View style={styles.heroSubRow}>
              <Icon source="speedometer" size={14} color={theme.colors.onSurfaceVariant} />
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {spm} spm cadence
              </Text>
            </View>
          </Surface>

          {/* Meters Card */}
          <Surface
            style={[
              styles.heroCard,
              {
                backgroundColor: theme.colors.elevation.level2,
                borderColor: theme.colors.primaryContainer,
              },
            ]}
            elevation={1}
          >
            <View style={styles.heroHeaderRow}>
              <View style={[styles.heroIconBadge, { backgroundColor: '#E0F2FE' }]}>
                <Icon source="map-marker-distance" size={20} color="#0284C7" />
              </View>
              <Text variant="labelSmall" style={styles.heroMetricLabel}>
                DISTANCE (METERS)
              </Text>
            </View>

            <Text variant="displaySmall" style={[styles.heroMetricValue, { color: theme.colors.onSurface }]}>
              {formatMeters(state.meters)}
            </Text>

            <View style={styles.heroSubRow}>
              <Icon source="run-fast" size={14} color={theme.colors.onSurfaceVariant} />
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {currentSpeedKmH} km/h pace
              </Text>
            </View>
          </Surface>
        </View>

        {/* ─── Secondary 4-Metric Grid (Duration, Heart Rate, Jumps, Load) ─── */}
        <View style={styles.statsGrid}>
          {/* Active Time */}
          <Surface style={[styles.statTile, { backgroundColor: theme.colors.elevation.level1 }]} elevation={0}>
            <View style={styles.statTileHeader}>
              <Icon source="timer-outline" size={18} color={theme.colors.primary} />
              <Text variant="labelSmall" style={styles.statTileLabel}>
                DURATION
              </Text>
            </View>
            <Text variant="titleLarge" style={styles.statTileValue}>
              {formatDuration(state.elapsedSeconds)}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 11 }}>
              {state.isPaused ? 'Paused' : state.isMoving ? 'Active tracking' : 'Stationary (waiting)'}
            </Text>
          </Surface>

          {/* Heart Rate */}
          <Surface style={[styles.statTile, { backgroundColor: theme.colors.elevation.level1 }]} elevation={0}>
            <View style={styles.statTileHeader}>
              <Animated.View style={{ transform: [{ scale: state.isPaused ? 1 : heartBeatAnim }] }}>
                <Icon source="heart-pulse" size={18} color="#D32F2F" />
              </Animated.View>
              <Text variant="labelSmall" style={styles.statTileLabel}>
                HEART RATE
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text variant="titleLarge" style={styles.statTileValue}>
                {state.heartRate}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                BPM
              </Text>
            </View>
            <Text variant="labelSmall" style={{ color: hrZone.color, fontWeight: '700', fontSize: 11 }}>
              {hrZone.label} Zone
            </Text>
          </Surface>

          {/* Jump Count */}
          <Surface style={[styles.statTile, { backgroundColor: theme.colors.elevation.level1 }]} elevation={0}>
            <View style={styles.statTileHeader}>
              <Icon source="human-male-height" size={18} color="#9C27B0" />
              <Text variant="labelSmall" style={styles.statTileLabel}>
                JUMPS
              </Text>
            </View>
            <Text variant="titleLarge" style={styles.statTileValue}>
              {state.jumps}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 11 }}>
              IMU detected jumps
            </Text>
          </Surface>

          {/* Player Load (AU) */}
          <Surface style={[styles.statTile, { backgroundColor: theme.colors.elevation.level1 }]} elevation={0}>
            <View style={styles.statTileHeader}>
              <Icon source="lightning-bolt" size={18} color="#F59E0B" />
              <Text variant="labelSmall" style={styles.statTileLabel}>
                PLAYER LOAD
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text variant="titleLarge" style={styles.statTileValue}>
                {Math.round(state.playerLoadAU)}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                AU
              </Text>
            </View>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 11 }}>
              ~{state.caloriesBurned} kcal
            </Text>
          </Surface>
        </View>

        {/* ─── Current Drill Card ─── */}
        {currentDrill ? (
          <Surface
            style={[
              styles.drillCard,
              {
                backgroundColor: theme.colors.elevation.level1,
                borderColor: theme.colors.outlineVariant,
              },
            ]}
            elevation={0}
          >
            <View style={styles.drillHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Chip
                    compact
                    style={{
                      backgroundColor:
                        CATEGORY_CONFIG[currentDrill.category]?.bgColor || theme.colors.primaryContainer,
                    }}
                    textStyle={{
                      color: CATEGORY_CONFIG[currentDrill.category]?.color || theme.colors.primary,
                      fontSize: 10,
                      fontWeight: '700',
                    }}
                  >
                    Drill {state.currentDrillIndex + 1}/{state.drills.length} · {currentDrill.category}
                  </Chip>
                </View>

                <Text
                  variant="titleMedium"
                  style={{ color: theme.colors.onSurface, fontWeight: '700', marginTop: 6 }}
                >
                  {currentDrill.name}
                </Text>
              </View>

              <Text
                variant="labelLarge"
                style={{ color: theme.colors.primary, fontWeight: '700' }}
              >
                {formatDuration(state.currentDrillSeconds)} / {currentDrill.durationMinutes}m
              </Text>
            </View>

            <ProgressBar
              progress={drillProgress}
              color={theme.colors.primary}
              style={styles.drillProgressBar}
            />

            <View style={styles.drillControls}>
              <Button
                mode="text"
                compact
                disabled={state.currentDrillIndex === 0}
                onPress={() => trackingService.prevDrill()}
                labelStyle={{ fontSize: 12 }}
              >
                Previous
              </Button>

              <Button
                mode="contained-tonal"
                compact
                icon="skip-next"
                disabled={state.currentDrillIndex >= state.drills.length - 1}
                onPress={() => {
                  trackingService.nextDrill();
                  sendSessionNextDrillToWatch(watchNodeId);
                }}
                labelStyle={{ fontSize: 12, fontWeight: '700' }}
              >
                Next Drill
              </Button>
            </View>
          </Surface>
        ) : (
          <Surface
            style={[
              styles.drillCard,
              {
                backgroundColor: theme.colors.elevation.level1,
                borderColor: theme.colors.outlineVariant,
              },
            ]}
            elevation={0}
          >
            <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface }}>
              {state.sessionTitle}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
              Open-regime movement telemetry active.
            </Text>
          </Surface>
        )}
      </ScrollView>

      {/* ─── Bottom Action Controls ─── */}
      <Surface
        style={[
          styles.bottomBar,
          {
            backgroundColor: theme.colors.elevation.level2,
            borderTopColor: theme.colors.outlineVariant,
          },
        ]}
        elevation={2}
      >
        <Button
          mode={state.isPaused ? 'contained' : 'outlined'}
          icon={state.isPaused ? 'play' : 'pause'}
          onPress={handlePauseResume}
          style={styles.controlButton}
          contentStyle={{ height: 50 }}
          labelStyle={{ fontWeight: '700', fontSize: 15 }}
        >
          {state.isPaused ? 'Resume Tracking' : 'Pause'}
        </Button>

        <Button
          mode="contained"
          icon="flag-checkered"
          buttonColor={theme.colors.error}
          textColor="#FFFFFF"
          onPress={handleEndSession}
          style={styles.controlButton}
          contentStyle={{ height: 50 }}
          labelStyle={{ fontWeight: '700', fontSize: 15 }}
        >
          Finish Session
        </Button>
      </Surface>

      {/* ─── Completed Session Summary Dialog ─── */}
      {summaryData && (
        <View style={styles.summaryOverlay}>
          <Surface style={[styles.summaryCard, { backgroundColor: theme.colors.surface }]} elevation={5}>
            <View style={styles.summaryHeader}>
              <View style={styles.summaryTrophy}>
                <Icon source="trophy" size={32} color="#F59E0B" />
              </View>
              <Text variant="headlineSmall" style={{ fontWeight: '800', color: theme.colors.onSurface }}>
                Session Completed!
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                {summaryData.sessionTitle} · {summaryData.date}
              </Text>
            </View>

            <Divider style={{ marginVertical: 14 }} />

            <View style={styles.summaryStatsRow}>
              <View style={styles.summaryCol}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  STEPS
                </Text>
                <Text variant="titleLarge" style={{ fontWeight: '800', color: theme.colors.primary }}>
                  {summaryData.steps.toLocaleString()}
                </Text>
              </View>

              <View style={styles.summaryCol}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  DISTANCE
                </Text>
                <Text variant="titleLarge" style={{ fontWeight: '800', color: theme.colors.primary }}>
                  {formatMeters(summaryData.meters)}
                </Text>
              </View>

              <View style={styles.summaryCol}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  DURATION
                </Text>
                <Text variant="titleLarge" style={{ fontWeight: '800', color: theme.colors.onSurface }}>
                  {summaryData.durationFormatted}
                </Text>
              </View>
            </View>

            <View style={[styles.summaryStatsRow, { marginTop: 12 }]}>
              <View style={styles.summaryCol}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  JUMPS
                </Text>
                <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface }}>
                  {summaryData.jumps}
                </Text>
              </View>

              <View style={styles.summaryCol}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  AVG HR
                </Text>
                <Text variant="titleMedium" style={{ fontWeight: '700', color: '#D32F2F' }}>
                  {summaryData.avgHeartRate} bpm
                </Text>
              </View>

              <View style={styles.summaryCol}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  PLAYER LOAD
                </Text>
                <Text variant="titleMedium" style={{ fontWeight: '700', color: '#F59E0B' }}>
                  {summaryData.playerLoadAU} AU
                </Text>
              </View>
            </View>

            <Button
              mode="contained"
              onPress={handleCloseSummary}
              style={{ marginTop: 24, borderRadius: 14 }}
              contentStyle={{ height: 48 }}
              labelStyle={{ fontWeight: '700', fontSize: 16 }}
            >
              Done — Return Home
            </Button>
          </Surface>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerTitleGroup: {
    alignItems: 'center',
  },
  watchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  matchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },

  // Hero Row (Steps & Meters)
  heroRow: {
    flexDirection: 'row',
    gap: 12,
  },
  heroCard: {
    flex: 1,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    justifyContent: 'space-between',
    minHeight: 140,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMetricLabel: {
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.8,
    color: '#64748B',
  },
  heroMetricValue: {
    fontWeight: '900',
    letterSpacing: -1,
    marginVertical: 4,
  },
  heroSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  // 4-Metric Grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statTile: {
    width: '48%',
    flexGrow: 1,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  statTileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statTileLabel: {
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 0.6,
    color: '#64748B',
  },
  statTileValue: {
    fontWeight: '800',
  },

  // Drill Card
  drillCard: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  drillHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  drillProgressBar: {
    height: 8,
    borderRadius: 4,
  },
  drillControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // Bottom Control Bar
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  controlButton: {
    flex: 1,
    borderRadius: 14,
  },

  // Summary Dialog Overlay
  summaryOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 999,
  },
  summaryCard: {
    width: '100%',
    borderRadius: 24,
    padding: 24,
  },
  summaryHeader: {
    alignItems: 'center',
  },
  summaryTrophy: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  summaryStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
  },
});
