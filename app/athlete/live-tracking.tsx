import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useIsFocused } from '@react-navigation/native';
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
  Vibration,
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
import { GEOFENCE_WARN_CMD } from '@/constants/ble';
import { SENSOR_PROFILES, resolveSensorProfile } from '@/constants/sensorProfiles';
import {
  pingWatch,
  sendActiveWorkoutToWatch,
  sendSessionControlCommand,
  sendSessionEndToWatch,
  sendSessionPauseToWatch,
  sendSessionResumeToWatch,
  startLiveTelemetrySubscription,
} from '@/lib/ble-manager';
import { getActiveDeviceLink } from '@/lib/deviceLink';
import { usePhoneJumpDetector } from '@/lib/phoneJumpDetector';
import { notifySessionEnded, prepareSessionNotifications } from '@/lib/sessionNotifications';
import { createVenueBoundaryGuard } from '@/lib/venueBoundary';
import {
  getCurrentAthleteRecord,
  getNextSessionForAthlete,
  subscribeSyncStatus,
  SyncStatus,
} from '@/lib/sessionService';
import {
  CompletedSessionMetrics,
  LiveTrackingState,
  trackingService
} from '@/lib/trackingService';
import { RPE_LABELS, computeSessionLoadAU } from '@/lib/workload';

/** Rest between drills before the next one starts automatically. */
const REST_BETWEEN_DRILLS_SECONDS = 180;
/** Warn when the athlete is within the outer 15% of the venue radius. */
const BOUNDARY_WARN_RATIO = 0.85;
/** Re-arm the warning once the athlete is back inside 75% of the radius. */
const BOUNDARY_REARM_RATIO = 0.75;
/** How long the athlete may stay outside (after warning) before the session stops. */
const BOUNDARY_GRACE_MS = 10_000;

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

  // Session RPE (CR-10) collected right after the session; AU = RPE × minutes
  const [rpePromptVisible, setRpePromptVisible] = useState(false);
  const [selectedRpe, setSelectedRpe] = useState<number | null>(null);

  // Toggle for Collapsible All-Sensors Telemetry
  const [showAllSensors, setShowAllSensors] = useState(false);

  // Venue geofence for the active session (null for at-home sessions)
  const [venueFence, setVenueFence] = useState<{
    latitude: number;
    longitude: number;
    radius: number;
    name: string;
  } | null>(null);

  // Rest countdown (seconds) shown between drills; null when not resting
  const [restRemaining, setRestRemaining] = useState<number | null>(null);

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

  // Upload state of this session's data (tracking continues offline either way)
  const [sync, setSync] = useState<SyncStatus>({ pending: 0, lastSyncedAt: null });
  useEffect(() => subscribeSyncStatus(setSync), []);

  // Guard against late/polled packets after session finish
  const sessionEndedRef = useRef(false);
  const hasLivePacketRef = useRef(false);

  // Identifies the current run. This screen is a tab, so it stays mounted between
  // sessions: everything tied to the previous run must be cleared when a new one starts.
  const runKey = state.isActive ? state.startedAt : '';
  const lastRunKeyRef = useRef(runKey);
  useEffect(() => {
    if (!runKey || runKey === lastRunKeyRef.current) return;
    lastRunKeyRef.current = runKey;
    prepareSessionNotifications().catch(() => undefined);
    sessionEndedRef.current = false;
    hasLivePacketRef.current = false;
    setRpePromptVisible(false);
    setSelectedRpe(null);
    setSummaryData(null);
    setRestRemaining(null);
    setTestZoneOverride(null);
    setVenueFence(null);
    testZoneIdxRef.current = 0;
  }, [runKey]);

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

  // Watch Bluetooth link: false while the watch is out of range (it keeps recording)
  const [watchInRange, setWatchInRange] = useState(true);
  // Drills the watch says it still holds (from its sync status)
  const [watchPending, setWatchPending] = useState(0);

  // Live BLE telemetry subscription: locks time and sensor data to watch
  useEffect(() => {
    if (!runKey) return;
    let wasConnected = true;
    const unsubscribe = startLiveTelemetrySubscription(
      watchNodeId,
      (telemetry) => {
        if (sessionEndedRef.current) return;
        // Drop packets from a different run (e.g. the watch's last packet of the previous session)
        const expectedSid = trackingService.getState().watchSessionId;
        if (telemetry.sid && expectedSid && telemetry.sid !== expectedSid) return;

        if (telemetry.completed) {
          // The watch reached the end of the last drill first
          if (!hasLivePacketRef.current) return;
          sessionEndedRef.current = true;
          trackingService.updateFromWatch(telemetry);
          trackingService.pauseTracking();
          Vibration.vibrate([0, 600, 200, 600]);
          Speech.speak('Session complete. Great work.', { language: 'en-US' });
          notifySessionEnded(
            'Session complete 🏁',
            `${trackingService.getState().sessionTitle} is finished. Rate how hard it was to save your session.`
          );
          setRpePromptVisible(true);
          return;
        }

        hasLivePacketRef.current = true;
        trackingService.updateFromWatch(telemetry);
      },
      undefined,
      {
        // Drills the watch recorded on its own while out of range
        onDrillRecord: (record) => trackingService.applyWatchDrillRecord(record),
        onWatchSyncStatus: (status) => {
          setWatchPending(status.pending);
          trackingService.applyWatchSyncStatus(status);
        },
        onConnectionChange: (connected) => {
          setWatchInRange(connected);
          trackingService.setWatchConnected(connected);
          if (connected && !wasConnected) {
            const st = trackingService.getState();
            if (sessionEndedRef.current) {
              // Ended on the phone while apart: stop the watch too (it still sends its drills)
              sendSessionEndToWatch(watchNodeId);
            } else if (st.isActive) {
              // Back in range: the phone leads again — same drill, same pause state
              const drill = st.drills[st.currentDrillIndex];
              if (drill) {
                sendActiveWorkoutToWatch(st.currentDrillIndex, drill, getDrillTargetMetrics(drill), watchNodeId);
              }
              if (st.isPaused) sendSessionPauseToWatch(watchNodeId);
              else sendSessionResumeToWatch(watchNodeId);
            }
          }
          wasConnected = connected;
        },
      }
    );

    return () => {
      unsubscribe();
    };
    // Re-subscribe per run: starting a session reconnects to the watch
  }, [watchNodeId, runKey]);

  // Start tracking if the screen was opened without an active session
  useEffect(() => {
    if (!trackingService.getState().isActive) {
      trackingService.startTracking(null, undefined, undefined, 'Wear OS Watch');
    }
    setInitLoading(false);
  }, []);

  // For each run: load the scheduled session (drills, venue fence) and the watch link
  useEffect(() => {
    if (!runKey) return;
    let cancelled = false;

    const init = async () => {
      try {
        const [athlete, session] = await Promise.all([
          getCurrentAthleteRecord(),
          getNextSessionForAthlete(),
        ]);

        if (cancelled) return;

        let watchName = 'Wear OS Watch';
        if (athlete?.userId) {
          const link = await getActiveDeviceLink(athlete.userId);
          if (link?.watch_name) watchName = link.watch_name;
          if (link?.watch_node_id) setWatchNodeId(link.watch_node_id);
        }

        if (session) {
          if (
            session.locationType === 'venue' &&
            session.latitude != null &&
            session.longitude != null
          ) {
            setVenueFence({
              latitude: session.latitude,
              longitude: session.longitude,
              radius: session.geofenceRadius || 100,
              name: session.venueName || 'the training venue',
            });
          }
          const current = trackingService.getState();
          if (!current.sessionId || current.sessionId === 'live_session') {
            // The workout-sync effect below tells the watch about the first drill
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
  }, [runKey]);

  // Seconds left before an athlete outside the venue has their session stopped (null = inside)
  const [boundaryCountdown, setBoundaryCountdown] = useState<number | null>(null);

  // ── Venue boundary guard: warn near the edge, auto-stop if athlete stays outside ──
  // (rules and timing in lib/venueBoundary.ts)
  useEffect(() => {
    if (!venueFence || !state.isActive) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    const speak = (text: string) => {
      try {
        Speech.stop();
        Speech.speak(text, { language: 'en-US', rate: 0.95, pitch: 1.0, volume: 1.0 });
      } catch (e) {
        console.warn('Speech failed:', e);
      }
    };

    const warn = (msg: string, spoken: string) => {
      Vibration.vibrate([0, 500, 200, 500]);
      speak(spoken);
      Alert.alert('⚠️ Venue Boundary Warning', msg);
      sendSessionControlCommand(GEOFENCE_WARN_CMD, watchNodeId);
    };

    const graceSeconds = Math.round(BOUNDARY_GRACE_MS / 1000);
    const guard = createVenueBoundaryGuard({
      radius: venueFence.radius,
      graceMs: BOUNDARY_GRACE_MS,
      warnRatio: BOUNDARY_WARN_RATIO,
      rearmRatio: BOUNDARY_REARM_RATIO,
      onEdgeWarning: (toEdge) =>
        warn(
          `You are about to leave ${venueFence.name} (${toEdge}m from the edge). Stay inside the area.`,
          'Warning. You are about to leave the training area. Please stay inside.'
        ),
      onOutsideWarning: () =>
        warn(
          `You have left ${venueFence.name}. Return inside the ${venueFence.radius}m area within ${graceSeconds} seconds or your session will stop.`,
          'Warning. You are outside the training area. Return now or your session will stop.'
        ),
      onCountdown: setBoundaryCountdown,
      // Shared with the coach (uploaded with the session progress)
      onStatus: (status, distance) => trackingService.setBoundaryStatus(status, distance),
      onStop: () => {
        if (cancelled || sessionEndedRef.current) return;
        trackingService.setBoundaryStatus('stopped', null);
        sessionEndedRef.current = true;
        sendSessionEndToWatch(watchNodeId);
        trackingService.pauseTracking();
        Vibration.vibrate(1500);
        Speech.stop();
        Speech.speak('Session stopped. You left the training area.', { language: 'en-US' });
        notifySessionEnded(
          'Session stopped',
          'You stayed outside the venue boundary, so the session was stopped automatically.'
        );
        Alert.alert(
          'Session Stopped',
          'You stayed outside the venue boundary after a warning, so the session was stopped automatically.'
        );
        setRpePromptVisible(true);
      },
    });

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        sub = await Location.watchPositionAsync(
          // distanceInterval 0: keep reporting while standing still, so a return is seen quickly
          { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 2000 },
          (pos) => {
            if (cancelled || sessionEndedRef.current) return;
            if ((pos as any).mocked === true) return;
            if (pos.coords.accuracy != null && pos.coords.accuracy > 50) return; // ignore poor fixes
            guard.update(
              distanceMeters(
                pos.coords.latitude,
                pos.coords.longitude,
                venueFence.latitude,
                venueFence.longitude
              )
            );
          }
        );
        if (cancelled) sub.remove();
      } catch (err) {
        console.warn('Venue boundary guard failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      guard.dispose();
      setBoundaryCountdown(null);
    };
  }, [venueFence, state.isActive, watchNodeId]);

  // Tell the watch which workout is running whenever it changes (phone advance,
  // watch advance echoed back, or the session's drills loading), so the watch
  // switches to the sensors that suit that workout.
  useEffect(() => {
    if (state.isActive && state.drills.length > 0) {
      const active = state.drills[state.currentDrillIndex];
      if (active) {
        sendActiveWorkoutToWatch(
          state.currentDrillIndex,
          active,
          getDrillTargetMetrics(active),
          watchNodeId
        );
      }
    }
  }, [state.isActive, state.currentDrillIndex, state.drills, watchNodeId]);

  // Animations: this tab stays mounted, so only animate while it's on screen
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!isFocused) return;
    const pulse = Animated.loop(
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
    );
    const heartBeat = Animated.loop(
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
    );
    pulse.start();
    heartBeat.start();
    return () => {
      pulse.stop();
      heartBeat.stop();
    };
  }, [isFocused, pulseAnim, heartBeatAnim]);

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
            trackingService.pauseTracking();
            setRpePromptVisible(true);
          },
        },
      ]
    );
  };

  const handleSubmitRpe = async () => {
    if (selectedRpe === null) return;
    // Drills recorded on the watch while out of range aren't on the phone yet
    const waiting = trackingService.drillsAwaitingWatch();
    if (waiting > 0) {
      const them = waiting === 1 ? 'it' : 'them';
      Alert.alert(
        'Watch data not synced yet',
        watchInRange
          ? `Still receiving ${waiting} drill${waiting === 1 ? '' : 's'} the watch recorded while out of range. Wait a few seconds, then save again.`
          : `${waiting} drill${waiting === 1 ? ' was' : 's were'} recorded on the watch while it was out of range. Bring the watch close to the phone to add ${them} to this session, or save now without ${them}.`,
        [
          { text: 'Wait for watch', style: 'cancel' },
          { text: 'Save without', style: 'destructive', onPress: () => saveSession(selectedRpe) },
        ]
      );
      return;
    }
    await saveSession(selectedRpe);
  };

  const saveSession = async (rpe: number) => {
    setRpePromptVisible(false);
    const summary = await trackingService.stopTracking(rpe);
    setSummaryData(summary);
  };

  // The workout-sync effect sends the new drill to the watch
  const handleNextDrill = () => {
    trackingService.nextDrill();
  };

  const handlePrevDrill = () => {
    trackingService.prevDrill();
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
  const zoneKey = `${runKey}|${state.currentDrillIndex}|${testZoneOverride ?? ''}`;
  const zoneAnchorRef = useRef({ key: zoneKey, at: state.elapsedSeconds - state.currentDrillSeconds });
  if (zoneAnchorRef.current.key !== zoneKey) {
    zoneAnchorRef.current = { key: zoneKey, at: state.elapsedSeconds };
  }
  const zoneSeconds = Math.max(0, state.elapsedSeconds - zoneAnchorRef.current.at);

  // ── Enforce allocated drill duration: rest between drills, auto-finish after the last one ──
  const endRest = () => {
    setRestRemaining(null);
    if (sessionEndedRef.current) return;
    handleNextDrill();
    trackingService.resumeTracking();
    sendSessionResumeToWatch(watchNodeId);
    Vibration.vibrate([0, 400, 200, 400]);
    Speech.speak('Rest is over. Next drill starting.', { language: 'en-US' });
  };
  const endRestRef = useRef(endRest);
  endRestRef.current = endRest;

  useEffect(() => {
    if (
      !state.isActive ||
      state.isPaused ||
      restRemaining != null ||
      sessionEndedRef.current ||
      testZoneOverride
    ) {
      return;
    }
    const drill = state.drills[state.currentDrillIndex];
    if (!drill || !drill.durationMinutes || drill.durationMinutes <= 0) return;
    if (zoneSeconds < drill.durationMinutes * 60) return;

    const isLastDrill = state.currentDrillIndex >= state.drills.length - 1;
    if (isLastDrill) {
      // Final drill finished → session is complete on both devices
      sessionEndedRef.current = true;
      sendSessionEndToWatch(watchNodeId);
      trackingService.pauseTracking();
      Vibration.vibrate([0, 600, 200, 600]);
      Speech.speak('Session complete. Great work.', { language: 'en-US' });
      notifySessionEnded(
        'Session complete 🏁',
        `${state.sessionTitle} is finished. Rate how hard it was to save your session.`
      );
      setRpePromptVisible(true);
    } else {
      // Drill time is up → pause both devices and start the rest countdown
      trackingService.pauseTracking();
      sendSessionPauseToWatch(watchNodeId);
      setRestRemaining(REST_BETWEEN_DRILLS_SECONDS);
      Vibration.vibrate([0, 500, 200, 500]);
      Speech.speak(
        `Drill complete. Rest for ${Math.round(REST_BETWEEN_DRILLS_SECONDS / 60)} minutes.`,
        { language: 'en-US' }
      );
    }
  }, [zoneSeconds, state.isActive, state.isPaused, state.currentDrillIndex, state.drills, restRemaining, testZoneOverride]);

  // Rest countdown
  useEffect(() => {
    if (restRemaining == null) return;
    if (restRemaining <= 0) {
      endRestRef.current();
      return;
    }
    const t = setTimeout(() => setRestRemaining((r) => (r == null ? r : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [restRemaining]);

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
    sendActiveWorkoutToWatch(
      state.currentDrillIndex,
      { name: zone.category, category: zone.category },
      zone.metrics,
      watchNodeId
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

  // Live speed (km/h) and cadence (spm) from the watch; session averages as fallback
  const currentSpeedKmH =
    state.speedKmh != null
      ? state.speedKmh.toFixed(1)
      : state.elapsedSeconds > 0
      ? ((state.meters / state.elapsedSeconds) * 3.6).toFixed(1)
      : '0.0';

  const spm =
    state.cadenceSpm != null
      ? Math.round(state.cadenceSpm)
      : state.elapsedSeconds > 5
      ? Math.round((state.steps / state.elapsedSeconds) * 60)
      : 0;

  // Watch sensor profile for the running workout, and whether the watch confirmed it
  const sensorProfile =
    SENSOR_PROFILES[
      resolveSensorProfile(currentDrill ?? { name: activeCategory, category: activeCategory })
    ];
  const watchOnProfile = state.watchSensorProfile === sensorProfile.key;

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

      {/* ─── Outside the venue: session stops when the countdown ends ─── */}
      {boundaryCountdown != null && state.isActive && (
        <View style={[styles.syncRow, { backgroundColor: '#FEE2E2' }]}>
          <Icon source="map-marker-alert-outline" size={14} color="#991B1B" />
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#991B1B', flexShrink: 1 }}>
            Outside the venue · go back in — session stops in {boundaryCountdown}s
          </Text>
        </View>
      )}

      {/* ─── Watch out of range: it keeps recording and syncs when back ─── */}
      {!watchInRange && state.isActive && (
        <View style={[styles.syncRow, { backgroundColor: '#FEE2E2' }]}>
          <Icon source="watch-variant" size={14} color="#991B1B" />
          <Text style={{ fontSize: 12, fontWeight: '600', color: '#991B1B', flexShrink: 1 }}>
            Watch out of range · it keeps recording and syncs once it is back near the phone
          </Text>
        </View>
      )}
      {watchInRange && state.isActive && state.completedDrills.some((d) => d.watchGap) && (
        <View style={[styles.syncRow, { backgroundColor: '#DBEAFE' }]}>
          <Icon source="sync" size={14} color="#1D4ED8" />
          <Text style={{ fontSize: 12, fontWeight: '600', color: '#1D4ED8', flexShrink: 1 }}>
            Getting drills recorded on the watch…
          </Text>
        </View>
      )}

      {/* ─── Sync status: data is kept on the phone while offline ─── */}
      {(sync.pending > 0 || sync.lastSyncedAt) && (
        <View
          style={[
            styles.syncRow,
            { backgroundColor: sync.pending > 0 ? '#FEF3C7' : '#E8F5E9' },
          ]}
        >
          <Icon
            source={sync.pending > 0 ? 'cloud-off-outline' : 'cloud-check-outline'}
            size={14}
            color={sync.pending > 0 ? '#92400E' : '#2E7D32'}
          />
          <Text style={{ fontSize: 12, fontWeight: '600', color: sync.pending > 0 ? '#92400E' : '#2E7D32' }}>
            {sync.pending > 0
              ? 'No internet · saved on phone, syncs automatically when online'
              : `Synced ${new Date(sync.lastSyncedAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
          </Text>
        </View>
      )}

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

          {/* Watch sensors chosen for this workout */}
          <View style={[styles.targetChip, { backgroundColor: '#FFFFFF', borderColor: '#CBD5E1', marginTop: 8, alignSelf: 'flex-start' }]}>
            <Icon source={sensorProfile.icon} size={14} color="#334155" />
            <Text style={[styles.targetChipText, { color: '#334155', flexShrink: 1 }]}>
              Watch: {sensorProfile.label} · {sensorProfile.sensors}
            </Text>
            <Icon
              source={watchOnProfile ? 'check-circle' : 'progress-clock'}
              size={14}
              color={watchOnProfile ? '#2E7D32' : '#94A3B8'}
            />
          </View>

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

      {/* ─── Rest between drills ─── */}
      {restRemaining != null && !rpePromptVisible && !summaryData && (
        <View style={styles.summaryOverlay}>
          <Surface style={[styles.summaryCard, { backgroundColor: theme.colors.surface }]} elevation={5}>
            <Text variant="titleLarge" style={{ fontWeight: '800', color: theme.colors.onSurface }}>
              Rest Time
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
              Drill complete. Next drill starts automatically.
            </Text>
            <Text variant="displayMedium" style={{ fontWeight: '800', textAlign: 'center', marginVertical: 20 }}>
              {formatDuration(restRemaining)}
            </Text>
            <Button mode="contained" onPress={() => endRestRef.current()}>
              Skip Rest & Start Next Drill
            </Button>
          </Surface>
        </View>
      )}

      {/* ─── Session RPE prompt (CR-10) ─── */}
      {rpePromptVisible && !summaryData && (
        <View style={styles.summaryOverlay}>
          <Surface style={[styles.summaryCard, { backgroundColor: theme.colors.surface }]} elevation={5}>
            <Text variant="titleLarge" style={{ fontWeight: '800', color: theme.colors.onSurface }}>
              How hard was that session?
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
              Rate your perceived exertion (CR-10). Session Load (AU) = RPE × minutes.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setSelectedRpe(n)}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor:
                      selectedRpe === n ? theme.colors.primary : theme.colors.elevation.level2,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: '800',
                      color: selectedRpe === n ? '#FFFFFF' : theme.colors.onSurface,
                    }}
                  >
                    {n}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text variant="bodyMedium" style={{ marginTop: 12, color: theme.colors.onSurface }}>
              {selectedRpe === null
                ? 'Select a value from 0 to 10'
                : `${RPE_LABELS[selectedRpe]} · ${computeSessionLoadAU(
                    selectedRpe,
                    state.elapsedSeconds / 60
                  )} AU`}
            </Text>
            {/* Drills recorded on the watch while out of range */}
            {trackingService.drillsAwaitingWatch() > 0 && (
              <View style={[styles.syncRow, { marginHorizontal: 0, marginTop: 12, backgroundColor: watchInRange ? '#DBEAFE' : '#FEF3C7' }]}>
                {watchInRange ? (
                  <ActivityIndicator size={12} color="#1D4ED8" />
                ) : (
                  <Icon source="watch-variant" size={14} color="#92400E" />
                )}
                <Text style={{ fontSize: 12, fontWeight: '600', flexShrink: 1, color: watchInRange ? '#1D4ED8' : '#92400E' }}>
                  {watchInRange
                    ? `Syncing drills from the watch… ${watchPending > 0 ? `${watchPending} left` : ''}`
                    : `Bring the watch near the phone to sync ${trackingService.drillsAwaitingWatch()} drill${trackingService.drillsAwaitingWatch() === 1 ? '' : 's'}`}
                </Text>
              </View>
            )}
            <Button
              mode="contained"
              disabled={selectedRpe === null}
              onPress={handleSubmitRpe}
              style={{ marginTop: 16 }}
            >
              Save Session
            </Button>
          </Surface>
        </View>
      )}

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
                    SESSION LOAD
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
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
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
