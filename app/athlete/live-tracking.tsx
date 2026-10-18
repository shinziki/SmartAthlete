import { useRouter } from 'expo-router';
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
  Chip,
  Divider,
  Icon,
  IconButton,
  ProgressBar,
  Surface,
  Text,
  useTheme
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CATEGORY_CONFIG } from '@/components/DrillsEditor';
import {
  METRIC_DEFINITIONS,
  MetricType,
  REGIME_DEFAULT_METRICS,
  REGIME_GUIDES,
  getDrillTargetMetrics,
} from '@/constants/regimes';
import {
  pingWatch,
  sendSessionEndToWatch,
  sendSessionNextDrillToWatch,
  sendSessionPauseToWatch,
  sendSessionRegimeToWatch,
  sendSessionResumeToWatch,
  startLiveTelemetrySubscription,
} from '@/lib/ble-manager';
import { getActiveDeviceLink } from '@/lib/deviceLink';
import { usePhoneJumpDetector } from '@/lib/phoneJumpDetector';
import { getCurrentAthleteRecord, getLatestUpcomingSession } from '@/lib/sessionService';
import {
  CompletedSessionMetrics,
  LiveTrackingState,
  trackingService
} from '@/lib/trackingService';

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
  if (meters < 10) {
    return `${meters.toFixed(1)} m`;
  }
  return `${Math.round(meters)} m`;
}

function getHeartRateZone(bpm: number): { label: string; color: string; zoneNum: number } {
  if (bpm <= 0) return { label: 'Resting', color: '#9E9E9E', zoneNum: 0 };
  if (bpm < 100) return { label: 'Warm-up', color: '#4CAF50', zoneNum: 1 };
  if (bpm < 135) return { label: 'Fat Burn', color: '#00BCD4', zoneNum: 2 };
  if (bpm < 160) return { label: 'Aerobic', color: '#FF9800', zoneNum: 3 };
  if (bpm < 175) return { label: 'Anaerobic', color: '#E91E63', zoneNum: 4 };
  return { label: 'Maximum', color: '#F44336', zoneNum: 5 };
}

// ─── Main Screen ──────────────────────────────────────────────

export default function LiveTrackingScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [state, setState] = useState<LiveTrackingState>(trackingService.getState());
  const [initLoading, setInitLoading] = useState(!state.isActive);
  const [summaryData, setSummaryData] = useState<CompletedSessionMetrics | null>(null);
  const [watchNodeId, setWatchNodeId] = useState<string | undefined>(undefined);

  // Toggle for Collapsible All-Sensors Telemetry
  const [showAllSensors, setShowAllSensors] = useState(false);

  // Ping Watch state
  const [pinging, setPinging] = useState(false);
  const [pingFeedback, setPingFeedback] = useState<string | null>(null);

  // Phone accelerometer jump detection (more reliable than wrist IMU)
  const [usePhoneJumps, setUsePhoneJumps] = useState(true);

  // TEMP: test zone override state — must be declared before drillTracksJumps
  const [testZoneOverride, setTestZoneOverride] = useState<string | null>(null);

  // Derive which metrics the CURRENT drill tracks — safe to call at hook level.
  // When test zone override is active, use its category to resolve target metrics.
  const currentDrillForHook =
    state.drills.length > 0 && state.drills[state.currentDrillIndex]
      ? state.drills[state.currentDrillIndex]
      : null;
  const effectiveTargetMetrics = testZoneOverride
    ? (REGIME_DEFAULT_METRICS[testZoneOverride as keyof typeof REGIME_DEFAULT_METRICS] || ['heartRate', 'steps'])
    : getDrillTargetMetrics(currentDrillForHook);
  const drillTracksJumps = effectiveTargetMetrics.includes('jumps');

  const { available: phoneSensorAvailable } = usePhoneJumpDetector(
    usePhoneJumps && state.isActive && !state.isPaused && drillTracksJumps,
    () => trackingService.addPhoneJump()
  );

  useEffect(() => {
    const active = usePhoneJumps && phoneSensorAvailable === true && drillTracksJumps;
    trackingService.setPhoneJumpDetection(active);
    return () => trackingService.setPhoneJumpDetection(false);
  }, [usePhoneJumps, phoneSensorAvailable, drillTracksJumps]);

  // Pulse animation for live sync indicator
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const heartBeatAnim = useRef(new Animated.Value(1)).current;

  // Guard against late/polled packets after session finish
  const sessionEndedRef = useRef(false);
  const hasLivePacketRef = useRef(false);

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
        if (sessionEndedRef.current) return;

        if (telemetry.completed) {
          if (!hasLivePacketRef.current) return;
          sessionEndedRef.current = true;
          trackingService.updateFromWatch(telemetry);
          trackingService.stopTracking().then((summary) => {
            setSummaryData(summary);
          });
          return;
        }

        hasLivePacketRef.current = true;
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
      if (!trackingService.getState().isActive) {
        trackingService.startTracking(null, undefined, undefined, 'Wear OS Watch');
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

        if (session) {
          const current = trackingService.getState();
          if (!current.sessionId || current.sessionId === 'live_session') {
            trackingService.startTracking(
              session,
              athlete?.id,
              athlete?.fullName,
              watchName
            );
            // Notify watch of initial regime
            const initialDrill = session.drills?.[0];
            const targetMetrics = getDrillTargetMetrics(initialDrill);
            sendSessionRegimeToWatch(
              initialDrill?.category || 'Warm-up',
              targetMetrics,
              watchNodeId
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

  // Sync regime with watch whenever drill changes
  useEffect(() => {
    if (state.isActive && state.drills.length > 0) {
      const active = state.drills[state.currentDrillIndex];
      if (active) {
        const targetMetrics = getDrillTargetMetrics(active);
        sendSessionRegimeToWatch(active.category, targetMetrics, watchNodeId);
      }
    }
  }, [state.currentDrillIndex, watchNodeId]);

  // Animations
  useEffect(() => {
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
      `Complete tracking for "${state.sessionTitle}"? Segmented metrics for ${state.drills.length || 1} regime(s) will be finalized.`,
      [
        { text: 'Keep Tracking', style: 'cancel' },
        {
          text: 'Finish & Save',
          style: 'destructive',
          onPress: async () => {
            if (sessionEndedRef.current) return;
            sessionEndedRef.current = true;
            sendSessionEndToWatch(watchNodeId);
            const summary = await trackingService.stopTracking();
            setSummaryData(summary);
          },
        },
      ]
    );
  };

  const handleNextDrill = () => {
    trackingService.nextDrill();
    sendSessionNextDrillToWatch(watchNodeId);
    // Read index AFTER advance so the watch gets the correct zone
    const { currentDrillIndex, drills } = trackingService.getState();
    if (currentDrillIndex < drills.length) {
      const nextDrill = drills[currentDrillIndex];
      const metrics = getDrillTargetMetrics(nextDrill);
      sendSessionRegimeToWatch(nextDrill.category, metrics, watchNodeId);
    }
  };

  const handlePrevDrill = () => {
    trackingService.prevDrill();
    const { currentDrillIndex, drills } = trackingService.getState();
    if (currentDrillIndex >= 0 && currentDrillIndex < drills.length) {
      const prevDrill = drills[currentDrillIndex];
      const metrics = getDrillTargetMetrics(prevDrill);
      sendSessionRegimeToWatch(prevDrill.category, metrics, watchNodeId);
    }
  };

  // ── Test helper: cycles through all 5 drill zones and syncs watch ──
  const TEST_ZONES: Array<{ category: string; metrics: string[]; minutes: number }> = [
    { category: 'Warm-up', metrics: ['heartRate', 'steps'], minutes: 2 },
    { category: 'Tactics', metrics: ['distance', 'playerLoad'], minutes: 3 },
    { category: 'Conditioning', metrics: ['heartRate', 'speed', 'playerLoad'], minutes: 5 },
    { category: 'Scrimmage', metrics: ['jumps', 'playerLoad', 'distance'], minutes: 5 },
    { category: 'Cool-down', metrics: ['recovery', 'heartRate'], minutes: 2 },
  ];
  const testZoneIdxRef = useRef(0);

  // Per-zone timer: restarts whenever the active drill/zone changes.
  // Based on the watch-locked elapsed clock, so both devices tick together.
  const zoneKey = `${state.currentDrillIndex}|${testZoneOverride ?? ''}`;
  const zoneAnchorRef = useRef({ key: zoneKey, at: state.elapsedSeconds - state.currentDrillSeconds });
  if (zoneAnchorRef.current.key !== zoneKey) {
    zoneAnchorRef.current = { key: zoneKey, at: state.elapsedSeconds };
  }
  const zoneSeconds = Math.max(0, state.elapsedSeconds - zoneAnchorRef.current.at);

  const handleTestNextZone = () => {
    // If the session has real drills, use normal next-drill logic instead
    if (state.drills.length > 1) {
      handleNextDrill();
      setTestZoneOverride(null);
      return;
    }
    testZoneIdxRef.current = (testZoneIdxRef.current + 1) % TEST_ZONES.length;
    const zone = TEST_ZONES[testZoneIdxRef.current];
    // Update the phone UI AND sync the watch (advance drill counter + set new regime)
    setTestZoneOverride(zone.category);
    sendSessionNextDrillToWatch(watchNodeId);
    sendSessionRegimeToWatch(zone.category, zone.metrics, watchNodeId);
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

  // Active Drill & Regime Configuration
  const currentDrill =
    state.drills.length > 0 && state.drills[state.currentDrillIndex]
      ? state.drills[state.currentDrillIndex]
      : null;

  // Test zone override takes priority when cycling zones without real drills
  const activeCategory = (testZoneOverride || currentDrill?.category || 'Tactics') as keyof typeof CATEGORY_CONFIG;
  const regimeConfig = CATEGORY_CONFIG[activeCategory] || CATEGORY_CONFIG['Tactics'];
  const regimeGuide = REGIME_GUIDES[activeCategory] || REGIME_GUIDES['Tactics'];
  const targetMetrics = testZoneOverride
    ? (REGIME_DEFAULT_METRICS[activeCategory as keyof typeof REGIME_DEFAULT_METRICS] || ['heartRate', 'steps'])
    : getDrillTargetMetrics(currentDrill);

  // const drillTargetSeconds = currentDrill ? currentDrill.durationMinutes * 60 : 600;
  // const drillProgress = Math.min(1, state.currentDrillSeconds / (drillTargetSeconds || 1));
  const testZoneMinutes = TEST_ZONES.find((z) => z.category === testZoneOverride)?.minutes;
  const allocatedMinutes = testZoneOverride ? testZoneMinutes : currentDrill?.durationMinutes;
  const drillTargetSeconds = allocatedMinutes ? allocatedMinutes * 60 : 600;
  const drillProgress = Math.min(1, zoneSeconds / (drillTargetSeconds || 1));
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

  // Active Drill metrics
  const drillMetrics = state.activeDrillMetrics;

  // ─── Primary 2 Hero Metrics Selection ──────────────────────
  const primaryMetric1: MetricType =
    targetMetrics.find((m) => !['heartRate', 'playerLoad', 'recovery'].includes(m)) ||
    (targetMetrics.includes('recovery') ? 'recovery' : 'steps');
  const primaryMetric2: MetricType = 'playerLoad';

  /**
   * Helper to render a dynamic Hero Card tailored to a specific reading.
   */
  const renderDynamicHeroCard = (metricKey: MetricType, isFirst: boolean) => {
    const def = METRIC_DEFINITIONS[metricKey] || METRIC_DEFINITIONS['heartRate'];

    let mainValue = '';
    let subText = '';
    let subIcon = 'information-outline';

    switch (metricKey) {
      case 'heartRate':
        if (!state.isWatchOnWrist) {
          mainValue = '--';
          subText = 'No skin contact (off wrist)';
          subIcon = 'heart-broken';
        } else if (state.heartRate <= 0) {
          mainValue = '--';
          subText = 'Acquiring pulse...';
          subIcon = 'heart-pulse';
        } else {
          mainValue = `${state.heartRate}`;
          subText = `${hrZone.label} · Peak: ${drillMetrics.peakHeartRate > 0 ? drillMetrics.peakHeartRate : state.heartRate} bpm`;
          subIcon = 'heart-pulse';
        }
        break;
      case 'steps':
        mainValue = drillMetrics.steps.toLocaleString();
        subText = `${spm} spm · Total: ${state.steps.toLocaleString()}`;
        subIcon = 'speedometer';
        break;
      case 'distance':
        mainValue = formatMeters(drillMetrics.meters);
        subText = `${currentSpeedKmH} km/h pace · Total: ${formatMeters(state.meters)}`;
        subIcon = 'run-fast';
        break;
      case 'jumps':
        mainValue = `${drillMetrics.jumps}`;
        subText = `IMU Takeoffs · Total: ${state.jumps}`;
        subIcon = 'human-male-height';
        break;
      case 'playerLoad':
        mainValue = `${drillMetrics.playerLoadAU}`;
        subText = `Regime AU · Total: ${state.playerLoadAU} AU`;
        subIcon = 'lightning-bolt';
        break;
      case 'speed':
        mainValue = `${currentSpeedKmH} km/h`;
        subText = `Sprint velocity · ${spm} spm`;
        subIcon = 'speedometer';
        break;
      case 'recovery':
        if (!state.isWatchOnWrist || state.heartRate <= 0) {
          mainValue = '--';
          subText = 'Awaiting pulse reading';
          subIcon = 'heart-broken';
        } else {
          mainValue = `-${drillMetrics.hrRecoveryDrop} BPM`;
          subText = `Peak ${drillMetrics.peakHeartRate > 0 ? drillMetrics.peakHeartRate : state.heartRate} → ${state.heartRate} bpm`;
          subIcon = 'arrow-down-bold-circle-outline';
        }
        break;
    }

    return (
      <Surface
        key={metricKey + isFirst}
        style={[
          styles.heroCard,
          {
            backgroundColor: theme.colors.elevation.level2,
            borderColor: def.color + '40',
          },
        ]}
        elevation={1}
      >
        <View style={styles.heroHeaderRow}>
          <View style={[styles.heroIconBadge, { backgroundColor: def.bgColor }]}>
            <Icon source={def.icon} size={20} color={def.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="labelSmall" style={[styles.heroMetricLabel, { color: def.color }]}>
              {def.shortLabel} · REGIME SPECIFIC
            </Text>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }}>
              {def.label}
            </Text>
          </View>
        </View>

        <View style={{ marginVertical: 6 }}>
          <Text
            variant="displaySmall"
            style={[styles.heroMetricValue, { color: theme.colors.onSurface }]}
          >
            {mainValue}
          </Text>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {def.unit}
          </Text>
        </View>

        <View style={styles.heroSubRow}>
          <Icon source={subIcon} size={13} color={theme.colors.onSurfaceVariant} />
          <Text
            variant="labelSmall"
            style={{ color: theme.colors.onSurfaceVariant, fontSize: 11 }}
            numberOfLines={1}
          >
            {subText}
          </Text>
        </View>
      </Surface>
    );
  };

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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="titleMedium" style={{ fontWeight: '800', color: theme.colors.onSurface }}>
              Regime Telemetry
            </Text>
            <View
              style={{
                backgroundColor: theme.colors.primaryContainer,
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 8,
              }}
            >
              <Text
                style={{
                  fontWeight: '800',
                  color: theme.colors.onPrimaryContainer,
                  fontSize: 12,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                }}
              >
                {formatDuration(state.elapsedSeconds)}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={handlePingWatch}
            style={({ pressed }) => [styles.watchPill, { opacity: pressed ? 0.7 : 1 }]}
            accessibilityLabel="Tap to ping watch"
          >
            <Animated.View
              style={[
                styles.pulseDot,
                {
                  backgroundColor: !state.isWatchOnWrist
                    ? '#EF4444'
                    : state.isPaused
                      ? '#FFA000'
                      : state.isMoving
                        ? '#2E7D32'
                        : '#64748B',
                  transform: [
                    {
                      scale: !state.isWatchOnWrist || state.isPaused || !state.isMoving ? 1 : pulseAnim,
                    },
                  ],
                },
              ]}
            />
            <Text
              variant="labelSmall"
              style={{
                color: !state.isWatchOnWrist
                  ? '#DC2626'
                  : state.isPaused
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
                  : !state.isWatchOnWrist
                    ? `Off Wrist (No Skin Contact) · ${state.watchName}`
                    : state.isPaused
                      ? 'Paused'
                      : state.isMoving
                        ? `Active · ${state.watchName}`
                        : `Stationary · ${state.watchName}`}
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
        {/* ─── Watch Match Status Banner ─── */}
        <Surface
          style={[
            styles.matchBanner,
            {
              backgroundColor: !state.isWatchOnWrist
                ? '#FEF2F2'
                : state.isPaused
                  ? '#FFFBEB'
                  : state.isMoving
                    ? '#F0FDF4'
                    : theme.colors.elevation.level1,
              borderColor: !state.isWatchOnWrist
                ? '#FECACA'
                : state.isPaused
                  ? '#FDE68A'
                  : state.isMoving
                    ? '#BBF7D0'
                    : theme.colors.outlineVariant,
            },
          ]}
          elevation={0}
        >
          <Icon
            source={
              !state.isWatchOnWrist
                ? 'watch-variant-off'
                : state.isPaused
                  ? 'pause-circle'
                  : state.isMoving
                    ? 'run-fast'
                    : 'watch-vibrate'
            }
            size={20}
            color={
              !state.isWatchOnWrist
                ? '#DC2626'
                : state.isPaused
                  ? '#D97706'
                  : state.isMoving
                    ? '#16A34A'
                    : theme.colors.primary
            }
          />
          <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.onSurface }}>
            {!state.isWatchOnWrist ? (
              <Text style={{ color: '#991B1B' }}>
                <Text style={{ fontWeight: '700' }}>Watch Off Wrist / Holding Strap: </Text>
                No skin contact detected. Steps, distance, and jumps are held at current count until watch is fastened to your wrist.
              </Text>
            ) : state.isPaused ? (
              <Text style={{ color: '#92400E' }}>
                <Text style={{ fontWeight: '700' }}>Session Paused: </Text>
                Sensor tracking is paused on smartwatch and mobile.
              </Text>
            ) : state.isMoving ? (
              <Text style={{ color: '#166534' }}>
                <Text style={{ fontWeight: '700' }}>Live Movement Streaming: </Text>
                Active IMU readings streaming for current regime.
              </Text>
            ) : (
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                <Text style={{ fontWeight: '700' }}>Stationary on Table: </Text>
                Held at current count until physical motion begins.
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

        {/* ─── Active Regime Focus Banner ─── */}
        <Surface
          style={[
            styles.regimeBanner,
            {
              backgroundColor: regimeConfig.bgColor,
              borderColor: regimeConfig.color + '55',
            },
          ]}
          elevation={0}
        >
          <View style={styles.regimeBannerTop}>
            <View style={[styles.regimeIconBadge, { backgroundColor: '#FFFFFF' }]}>
              <Icon source={regimeGuide.icon} size={22} color={regimeConfig.color} />
            </View>

            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Chip
                  compact
                  style={{ backgroundColor: '#FFFFFF' }}
                  textStyle={{
                    color: regimeConfig.color,
                    fontWeight: '800',
                    fontSize: 11,
                  }}
                >
                  {activeCategory.toUpperCase()} PHASE
                </Chip>
                <Text variant="labelSmall" style={{ color: regimeConfig.color, fontWeight: '700' }}>
                  Drill {state.currentDrillIndex + 1}/{Math.max(1, state.drills.length)}
                </Text>
              </View>

              <Text
                variant="titleMedium"
                style={{ color: '#0F172A', fontWeight: '800', marginTop: 4 }}
              >
                {currentDrill?.name || regimeGuide.title}
              </Text>
            </View>
          </View>

          <Text variant="bodySmall" style={{ color: '#334155', marginTop: 4, lineHeight: 18 }}>
            <Text style={{ fontWeight: '700', color: regimeConfig.color }}>
              Target Focus: {regimeGuide.primaryReadingLabel}.{' '}
            </Text>
            {regimeGuide.targetGuidance}
          </Text>

          {/* Active Target Metrics Chips */}
          <View style={styles.targetMetricsRow}>
            {targetMetrics.map((mKey) => {
              const def = METRIC_DEFINITIONS[mKey];
              if (!def) return null;
              return (
                <View
                  key={mKey}
                  style={[styles.targetChip, { backgroundColor: '#FFFFFF', borderColor: def.color }]}
                >
                  <Icon source={def.icon} size={14} color={def.color} />
                  <Text style={[styles.targetChipText, { color: def.color }]}>
                    {def.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </Surface>

        {/* ─── Primary Cards: Movement (left) · AU (right) ─── */}
        <View style={styles.heroRow}>
          {renderDynamicHeroCard(primaryMetric1, true)}
          {renderDynamicHeroCard(primaryMetric2, false)}
        </View>

        {/* ─── Compact Heart Rate Card ─── */}
        <Surface
          style={[
            styles.tertiaryStrip,
            {
              backgroundColor: theme.colors.elevation.level1,
              borderWidth: 1,
              borderColor: theme.colors.outlineVariant,
              justifyContent: 'space-between',
            },
          ]}
          elevation={0}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Animated.View style={{ transform: [{ scale: state.isPaused ? 1 : heartBeatAnim }] }}>
              <Icon source="heart-pulse" size={22} color="#D32F2F" />
            </Animated.View>
            <Text variant="titleLarge" style={{ fontWeight: '800', color: theme.colors.onSurface }}>
              {!state.isWatchOnWrist || state.heartRate <= 0 ? '--' : state.heartRate}
              <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}> bpm</Text>
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text
              variant="labelSmall"
              style={{
                fontWeight: '800',
                color:
                  !state.isWatchOnWrist || state.heartRate <= 0 ? '#DC2626' : hrZone.color,
              }}
            >
              {!state.isWatchOnWrist
                ? 'Off wrist'
                : state.heartRate <= 0
                  ? 'Acquiring…'
                  : `Zone ${hrZone.zoneNum} · ${hrZone.label}`}
            </Text>
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }}>
              Avg {state.isWatchOnWrist && drillMetrics.avgHeartRate > 0 ? drillMetrics.avgHeartRate : '--'} · Peak{' '}
              {state.isWatchOnWrist && drillMetrics.peakHeartRate > 0 ? drillMetrics.peakHeartRate : '--'}
            </Text>
          </View>
        </Surface>

        {/* ─── Current Drill Stepper & Timer Card ─── */}
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
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                DRILL TIMELINE
              </Text>
              <Text
                variant="titleMedium"
                style={{ color: theme.colors.onSurface, fontWeight: '800', marginTop: 2 }}
              >
                {currentDrill?.name || state.sessionTitle}
              </Text>
            </View>

            <View style={{ alignItems: 'flex-end' }}>
              <Text
                variant="titleMedium"
                style={{ color: theme.colors.primary, fontWeight: '800' }}
              >
                {formatDuration(zoneSeconds)}
                <Text style={{ fontSize: 13, color: theme.colors.onSurfaceVariant }}>
                  {' '}/ {allocatedMinutes ? `${allocatedMinutes}m` : 'Open'}
                </Text>
              </Text>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }}>
                Total: {formatDuration(state.elapsedSeconds)}
              </Text>
            </View>
          </View>

          <ProgressBar
            progress={drillProgress}
            color={regimeConfig.color}
            style={styles.drillProgressBar}
          />

          <View style={styles.drillControls}>
            <Button
              mode="text"
              compact
              icon="chevron-left"
              disabled={state.currentDrillIndex === 0}
              onPress={handlePrevDrill}
              labelStyle={{ fontSize: 12 }}
            >
              Previous Drill
            </Button>

            <Button
              mode="contained-tonal"
              compact
              icon="skip-next"
              disabled={state.currentDrillIndex >= state.drills.length - 1}
              onPress={handleNextDrill}
              labelStyle={{ fontSize: 12, fontWeight: '700' }}
            >
              Next Drill ({state.currentDrillIndex + 1}/{state.drills.length})
            </Button>
          </View>

          {/* Phone jump detector toggle — only relevant for jump regimes */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {drillTracksJumps && (
              <Chip
                compact
                icon={usePhoneJumps ? 'cellphone-check' : 'watch'}
                selected={usePhoneJumps}
                disabled={phoneSensorAvailable === false}
                onPress={() => setUsePhoneJumps((v) => !v)}
              >
                {phoneSensorAvailable === false
                  ? 'Phone sensor unavailable'
                  : usePhoneJumps
                    ? 'Jumps: Phone (hold phone)'
                    : 'Jumps: Watch'}
              </Chip>
            )}

            {/* TEMP: test zone cycler — syncs watch with each drill zone */}
            <Button
              mode="outlined"
              compact
              icon="bug-outline"
              onPress={handleTestNextZone}
              labelStyle={{ fontSize: 11 }}
            >
              Test: Next Zone
            </Button>
          </View>
        </Surface>

        {/* ─── Collapsible All-Sensor Telemetry Drawer ─── */}
        <Surface
          style={[
            styles.allSensorsCard,
            {
              backgroundColor: theme.colors.elevation.level1,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
          elevation={0}
        >
          <Pressable
            onPress={() => setShowAllSensors(!showAllSensors)}
            style={styles.allSensorsHeader}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon source="tune" size={18} color={theme.colors.primary} />
              <Text variant="labelLarge" style={{ fontWeight: '700', color: theme.colors.onSurface }}>
                Cumulative Session Telemetry
              </Text>
            </View>

            <IconButton
              icon={showAllSensors ? 'chevron-up' : 'chevron-down'}
              size={20}
              onPress={() => setShowAllSensors(!showAllSensors)}
              style={{ margin: 0 }}
            />
          </Pressable>

          {showAllSensors && (
            <View style={styles.allSensorsGrid}>
              <Divider style={{ marginVertical: 8 }} />

              <View style={styles.sensorRow}>
                <View style={styles.sensorCol}>
                  <Text variant="labelSmall" style={styles.sensorLabel}>SESSION TIME</Text>
                  <Text variant="titleMedium" style={styles.sensorVal}>
                    {formatDuration(state.elapsedSeconds)}
                  </Text>
                </View>

                <View style={styles.sensorCol}>
                  <Text variant="labelSmall" style={styles.sensorLabel}>TOTAL STEPS</Text>
                  <Text variant="titleMedium" style={styles.sensorVal}>
                    {state.steps.toLocaleString()}
                  </Text>
                </View>

                <View style={styles.sensorCol}>
                  <Text variant="labelSmall" style={styles.sensorLabel}>TOTAL DISTANCE</Text>
                  <Text variant="titleMedium" style={styles.sensorVal}>
                    {formatMeters(state.meters)}
                  </Text>
                </View>
              </View>

              <View style={[styles.sensorRow, { marginTop: 12 }]}>
                <View style={styles.sensorCol}>
                  <Text variant="labelSmall" style={styles.sensorLabel}>TOTAL JUMPS</Text>
                  <Text variant="titleMedium" style={styles.sensorVal}>
                    {state.jumps}
                  </Text>
                </View>

                <View style={styles.sensorCol}>
                  <Text variant="labelSmall" style={styles.sensorLabel}>CURRENT HR</Text>
                  <Text variant="titleMedium" style={[styles.sensorVal, { color: '#D32F2F' }]}>
                    {!state.isWatchOnWrist
                      ? '-- (Off wrist)'
                      : state.heartRate <= 0
                        ? 'Acquiring...'
                        : `${state.heartRate} bpm`}
                  </Text>
                </View>

                <View style={styles.sensorCol}>
                  <Text variant="labelSmall" style={styles.sensorLabel}>TOTAL LOAD</Text>
                  <Text variant="titleMedium" style={[styles.sensorVal, { color: '#F59E0B' }]}>
                    {state.playerLoadAU} AU
                  </Text>
                </View>
              </View>
            </View>
          )}
        </Surface>
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

      {/* ─── Completed Session Summary Dialog with Regime Breakdown ─── */}
      {summaryData && (
        <View style={styles.summaryOverlay}>
          <Surface style={[styles.summaryCard, { backgroundColor: theme.colors.surface }]} elevation={5}>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
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

              {/* Overall Session Highlights */}
              <View style={styles.summaryStatsRow}>
                <View style={styles.summaryCol}>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    TOTAL TIME
                  </Text>
                  <Text variant="titleMedium" style={{ fontWeight: '800', color: theme.colors.onSurface }}>
                    {summaryData.durationFormatted}
                  </Text>
                </View>

                <View style={styles.summaryCol}>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    DISTANCE
                  </Text>
                  <Text variant="titleMedium" style={{ fontWeight: '800', color: theme.colors.primary }}>
                    {formatMeters(summaryData.meters)}
                  </Text>
                </View>

                <View style={styles.summaryCol}>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    TOTAL STEPS
                  </Text>
                  <Text variant="titleMedium" style={{ fontWeight: '800', color: theme.colors.primary }}>
                    {summaryData.steps.toLocaleString()}
                  </Text>
                </View>
              </View>

              <View style={[styles.summaryStatsRow, { marginTop: 10 }]}>
                <View style={styles.summaryCol}>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    JUMPS
                  </Text>
                  <Text variant="titleMedium" style={{ fontWeight: '700', color: '#8E24AA' }}>
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

              {/* ─── Regime-by-Regime Scorecard ─── */}
              {summaryData.drillBreakdown && summaryData.drillBreakdown.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <Text
                    variant="titleSmall"
                    style={{ fontWeight: '800', color: theme.colors.onSurface, marginBottom: 8 }}
                  >
                    Regime Specific Performance Breakdown
                  </Text>

                  {summaryData.drillBreakdown.map((drill, idx) => {
                    const catConfig = CATEGORY_CONFIG[drill.category] || CATEGORY_CONFIG['Tactics'];

                    return (
                      <Surface
                        key={drill.drillId || idx}
                        style={[
                          styles.summaryDrillCard,
                          {
                            backgroundColor: theme.colors.elevation.level1,
                            borderColor: catConfig.color + '33',
                          },
                        ]}
                        elevation={0}
                      >
                        <View style={styles.summaryDrillTop}>
                          <Chip
                            compact
                            style={{ backgroundColor: catConfig.bgColor }}
                            textStyle={{ color: catConfig.color, fontWeight: '800', fontSize: 10 }}
                          >
                            {drill.category}
                          </Chip>
                          <Text
                            variant="labelMedium"
                            style={{ fontWeight: '700', color: theme.colors.onSurface, flex: 1 }}
                            numberOfLines={1}
                          >
                            {drill.drillName}
                          </Text>
                          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                            {drill.durationFormatted}
                          </Text>
                        </View>

                        {/* Targeted Readings for this specific regime */}
                        <View style={styles.summaryDrillMetricsRow}>
                          {drill.category === 'Warm-up' && (
                            <>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                ♥ Avg HR: <Text style={{ fontWeight: '700' }}>{drill.avgHeartRate} bpm</Text>
                              </Text>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                👟 Steps: <Text style={{ fontWeight: '700' }}>{drill.steps}</Text>
                              </Text>
                            </>
                          )}
                          {drill.category === 'Tactics' && (
                            <>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                📍 Distance: <Text style={{ fontWeight: '700' }}>{formatMeters(drill.meters)}</Text>
                              </Text>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                ⚡ Load: <Text style={{ fontWeight: '700' }}>{drill.playerLoadAU} AU</Text>
                              </Text>
                            </>
                          )}
                          {drill.category === 'Conditioning' && (
                            <>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                📍 Distance: <Text style={{ fontWeight: '700' }}>{formatMeters(drill.meters)}</Text>
                              </Text>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                ♥ Peak HR: <Text style={{ fontWeight: '700' }}>{drill.maxHeartRate} bpm</Text>
                              </Text>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                ⚡ Load: <Text style={{ fontWeight: '700' }}>{drill.playerLoadAU} AU</Text>
                              </Text>
                            </>
                          )}
                          {drill.category === 'Scrimmage' && (
                            <>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                ⚡ Jumps: <Text style={{ fontWeight: '700' }}>{drill.jumps}</Text>
                              </Text>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                ⚡ Load: <Text style={{ fontWeight: '700' }}>{drill.playerLoadAU} AU</Text>
                              </Text>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                📍 Distance: <Text style={{ fontWeight: '700' }}>{formatMeters(drill.meters)}</Text>
                              </Text>
                            </>
                          )}
                          {drill.category === 'Cool-down' && (
                            <>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                📉 HR Drop: <Text style={{ fontWeight: '700' }}>-{drill.hrRecoveryDrop} BPM</Text>
                              </Text>
                              <Text variant="bodySmall" style={styles.drillReadingBadge}>
                                ♥ End HR: <Text style={{ fontWeight: '700' }}>{drill.avgHeartRate} bpm</Text>
                              </Text>
                            </>
                          )}
                        </View>
                      </Surface>
                    );
                  })}
                </View>
              )}

              <Button
                mode="contained"
                onPress={handleCloseSummary}
                style={{ marginTop: 24, borderRadius: 14 }}
                contentStyle={{ height: 48 }}
                labelStyle={{ fontWeight: '700', fontSize: 16 }}
              >
                Done — Return Home
              </Button>
            </ScrollView>
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

  // Regime Banner
  regimeBanner: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    gap: 8,
  },
  regimeBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  regimeIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  targetMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  targetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  targetChipText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Hero Row (Regime Specific 2 Hero Metrics)
  heroRow: {
    flexDirection: 'row',
    gap: 12,
  },
  heroCard: {
    flex: 1,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
    justifyContent: 'space-between',
    minHeight: 148,
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
    fontSize: 9,
    letterSpacing: 0.8,
  },
  heroMetricValue: {
    fontWeight: '900',
    letterSpacing: -1,
  },
  heroSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  // Tertiary Readings Strip
  tertiaryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    flexWrap: 'wrap',
    gap: 12,
  },
  tertiaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  // Heart Rate Zone Guidance Card
  gaugeCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    gap: 10,
  },
  gaugeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  zoneBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    gap: 4,
    marginVertical: 4,
  },
  zoneSegment: {
    flex: 1,
    borderRadius: 4,
  },
  zoneFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // Drill Stepper Card
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

  // Collapsible All-Sensors Drawer
  allSensorsCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  allSensorsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  allSensorsGrid: {
    paddingTop: 4,
  },
  sensorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sensorCol: {
    flex: 1,
    alignItems: 'center',
  },
  sensorLabel: {
    fontWeight: '700',
    fontSize: 9,
    letterSpacing: 0.6,
    color: '#64748B',
  },
  sensorVal: {
    fontWeight: '800',
    marginTop: 2,
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
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 999,
  },
  summaryCard: {
    width: '100%',
    borderRadius: 24,
    padding: 22,
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
  summaryDrillCard: {
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    marginBottom: 8,
    gap: 6,
  },
  summaryDrillTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryDrillMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 2,
  },
  drillReadingBadge: {
    color: '#475569',
    fontSize: 11,
  },
});
