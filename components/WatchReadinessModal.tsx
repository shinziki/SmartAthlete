import React, { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
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
  Modal,
  Portal,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { useRouter } from 'expo-router';

import { DeviceLink, getActiveDeviceLink, updateDeviceLinkNodeId } from '@/lib/deviceLink';
import {
  findNearbyWatch,
  isBluetoothReady,
  pingWatch,
  PingWatchResult,
  sendStartSessionToWatch,
} from '@/lib/ble-manager';
import { trackingService } from '@/lib/trackingService';

interface WatchReadinessModalProps {
  visible: boolean;
  onDismiss: () => void;
  athleteId?: number;
  athleteName?: string;
  userId?: string;
  sessionTitle?: string;
  drillCount?: number;
  totalDurationMinutes?: number;
  drills?: Array<{
    name: string;
    durationMinutes: number;
    category?: string;
  }>;
}

export default function WatchReadinessModal({
  visible,
  onDismiss,
  athleteId,
  athleteName,
  userId,
  sessionTitle = 'Training Session',
  drillCount,
  totalDurationMinutes,
  drills,
}: WatchReadinessModalProps) {
  const theme = useTheme();
  const router = useRouter();
  const [startingSession, setStartingSession] = useState(false);

  const [loading, setLoading] = useState(true);
  const [deviceLink, setDeviceLink] = useState<DeviceLink | null>(null);
  const [btReady, setBtReady] = useState(true);
  const [pulseAnim] = useState(new Animated.Value(1));

  // Ping & Find Watch States
  const [pinging, setPinging] = useState(false);
  const [findingWatch, setFindingWatch] = useState(false);
  const [pingResult, setPingResult] = useState<PingWatchResult | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      checkWatchReadiness();

      // Subtle pulse animation on watch icon
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [visible, userId]);

  const checkWatchReadiness = async () => {
    setLoading(true);
    try {
      if (userId) {
        const link = await getActiveDeviceLink(userId);
        setDeviceLink(link);
      }

      // Check Bluetooth
      try {
        const ready = await isBluetoothReady();
        setBtReady(ready);
      } catch {
        setBtReady(false);
      }
    } catch (err) {
      console.warn('Error checking watch readiness:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePairWatch = () => {
    onDismiss();
    router.push('/athlete/smartwatch-setup' as any);
  };

  const handlePingWatch = async () => {
    setPinging(true);
    setPingError(null);
    setStatusMsg('Pinging watch…');
    try {
      const res = await pingWatch(deviceLink?.watch_node_id, (msg) => setStatusMsg(msg));
      setPingResult(res);
      setStatusMsg(`Connected! ${res.rttMs}ms RTT (Watch Vibrated)`);
      if (userId && res.watchId && res.watchId !== deviceLink?.watch_node_id) {
        await updateDeviceLinkNodeId(userId, res.watchId, res.watchName);
        setDeviceLink((prev) => (prev ? { ...prev, watch_node_id: res.watchId } : null));
      }
    } catch (err: any) {
      setPingResult(null);
      setPingError(err?.message || 'Watch not responding. Ensure watch screen is active.');
      setStatusMsg(null);
    } finally {
      setPinging(false);
    }
  };

  const handleFindWatch = async () => {
    setFindingWatch(true);
    setPingError(null);
    setStatusMsg('Searching for nearby SmartAthlete watch…');
    try {
      const found = await findNearbyWatch((msg) => setStatusMsg(msg));
      if (found) {
        setStatusMsg(`Found ${found.name}! Pinging…`);
        const res = await pingWatch(found.id, (msg) => setStatusMsg(msg));
        setPingResult(res);
        setStatusMsg(`Connected to ${found.name} (${res.rttMs}ms RTT)!`);
        if (userId) {
          await updateDeviceLinkNodeId(userId, found.id, found.name);
          setDeviceLink((prev) =>
            prev
              ? { ...prev, watch_node_id: found.id, watch_name: found.name }
              : {
                  id: 'temp',
                  watch_node_id: found.id,
                  watch_name: found.name,
                  paired_at: new Date().toISOString(),
                }
          );
        }
      } else {
        setPingError('No SmartAthlete watch found nearby. Check that watch display is on.');
        setStatusMsg(null);
      }
    } catch (err: any) {
      setPingError(err?.message || 'Failed to scan for nearby watch.');
      setStatusMsg(null);
    } finally {
      setFindingWatch(false);
    }
  };

  const handleStartTracking = async () => {
    setStartingSession(true);
    try {
      if (deviceLink?.watch_node_id) {
        await sendStartSessionToWatch(deviceLink.watch_node_id, {
          title: sessionTitle || 'Training Session',
          drillCount: drillCount || drills?.length || 1,
          totalDurationMinutes: totalDurationMinutes || 30,
          drills: drills || [],
        });
      }
    } catch (err) {
      console.warn('Could not send live start session signal to watch:', err);
    } finally {
      // Immediately start tracking on phone so timer and data start in sync right away
      trackingService.startTracking(
        {
          id: 'live_session',
          title: sessionTitle || 'Training Session',
          drills: drills || [],
          totalDurationMinutes: totalDurationMinutes || 30,
        } as any,
        athleteId,
        athleteName,
        deviceLink?.watch_name || 'Wear OS Watch'
      );
      setStartingSession(false);
      onDismiss();
      router.push('/athlete/live-tracking' as any);
    }
  };

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[
          styles.modalContainer,
          { backgroundColor: theme.colors.surface },
        ]}
      >
        {/* ─── Top Check-in Confirmation Banner ─── */}
        <View style={styles.confirmHeader}>
          <View style={styles.checkIconWrap}>
            <Icon source="check-circle" size={28} color="#2E7D32" />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              variant="titleMedium"
              style={{ color: '#1B5E3B', fontWeight: '800', fontSize: 16 }}
            >
              Check-in Confirmed! ✓
            </Text>
            {athleteId !== undefined && (
              <Text
                variant="bodySmall"
                style={{ color: '#2E7D32', fontWeight: '600', marginTop: 1 }}
              >
                Registered with Coach under Athlete ID #{athleteId}
              </Text>
            )}
          </View>
        </View>

        <Divider style={{ marginVertical: 12 }} />

        {/* ─── Watch Movement Tracking Section ─── */}
        <View style={styles.watchSectionHeader}>
          <Animated.View
            style={[
              styles.watchIconCircle,
              {
                backgroundColor: deviceLink
                  ? theme.colors.primaryContainer
                  : '#FFEBEE',
                transform: [{ scale: pulseAnim }],
              },
            ]}
          >
            <Icon
              source={deviceLink ? 'watch-vibrate' : 'watch-variant'}
              size={32}
              color={deviceLink ? theme.colors.primary : '#D32F2F'}
            />
          </Animated.View>

          <View style={{ flex: 1 }}>
            <Text
              variant="titleMedium"
              style={{ color: theme.colors.onSurface, fontWeight: '700' }}
            >
              Watch Movement Tracking
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: 2, lineHeight: 16 }}
            >
              Your Wear OS watch will record all drill movements, jumps, and exercise intensity.
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Checking smartwatch readiness…
            </Text>
          </View>
        ) : deviceLink ? (
          /* ─── Device Linked & Ready State ─── */
          <View style={styles.contentWrap}>
            {/* Device Info Surface */}
            <Surface
              style={[
                styles.deviceStatusCard,
                {
                  backgroundColor: theme.colors.elevation.level1,
                  borderColor: '#A5D6A7',
                },
              ]}
              elevation={0}
            >
              <View style={styles.deviceRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    variant="labelSmall"
                    style={{ color: theme.colors.onSurfaceVariant, fontWeight: '600' }}
                  >
                    LINKED DEVICE
                  </Text>
                  <Text
                    variant="titleSmall"
                    style={{ color: theme.colors.onSurface, fontWeight: '700', marginTop: 1 }}
                  >
                    {deviceLink.watch_name || 'Wear OS Smartwatch'}
                  </Text>
                </View>

                <Chip
                  compact
                  icon="check"
                  style={{ backgroundColor: '#E8F5E9' }}
                  textStyle={{ color: '#2E7D32', fontSize: 11, fontWeight: '700' }}
                >
                  Ready to Track
                </Chip>
              </View>

              {!btReady && (
                <View style={styles.btWarningRow}>
                  <Icon source="bluetooth-off" size={16} color="#D32F2F" />
                  <Text variant="labelSmall" style={{ color: '#D32F2F', flex: 1 }}>
                    Bluetooth appears off. Turn it on to sync live telemetry.
                  </Text>
                </View>
              )}
            </Surface>

            {/* ─── Ping & Connection Verification Card ─── */}
            <Surface
              style={[
                styles.pingCard,
                {
                  backgroundColor: pingResult?.success
                    ? '#F0FDF4'
                    : pingError
                    ? '#FEF2F2'
                    : theme.colors.elevation.level1,
                  borderColor: pingResult?.success
                    ? '#86EFAC'
                    : pingError
                    ? '#FECACA'
                    : theme.colors.outlineVariant,
                },
              ]}
              elevation={0}
            >
              <View style={styles.pingRow}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon
                      source={
                        pingResult?.success
                          ? 'check-decagram'
                          : pingError
                          ? 'alert-circle'
                          : 'broadcast'
                      }
                      size={18}
                      color={
                        pingResult?.success
                          ? '#16A34A'
                          : pingError
                          ? '#DC2626'
                          : theme.colors.primary
                      }
                    />
                    <Text
                      variant="labelMedium"
                      style={{
                        fontWeight: '700',
                        color: pingResult?.success
                          ? '#15803D'
                          : pingError
                          ? '#B91C1C'
                          : theme.colors.onSurface,
                      }}
                    >
                      {pingResult?.success
                        ? 'Watch Connection Verified ✓'
                        : pingError
                        ? 'Connection Attention Needed'
                        : 'Verify Watch Connection'}
                    </Text>
                  </View>

                  <Text
                    variant="bodySmall"
                    style={{
                      color: pingResult?.success
                        ? '#166534'
                        : pingError
                        ? '#991B1B'
                        : theme.colors.onSurfaceVariant,
                      marginTop: 3,
                      lineHeight: 16,
                    }}
                  >
                    {statusMsg ||
                      pingError ||
                      'Ping the nearby watch to test communication and buzz the wrist before starting.'}
                  </Text>
                </View>

                <Button
                  mode={pingResult?.success ? 'outlined' : 'contained-tonal'}
                  compact
                  icon="vibrate"
                  onPress={handlePingWatch}
                  loading={pinging}
                  disabled={pinging || findingWatch}
                  contentStyle={{ height: 36 }}
                  labelStyle={{ fontSize: 12, fontWeight: '700' }}
                >
                  {pinging ? 'Pinging…' : 'Ping Watch'}
                </Button>
              </View>

              {/* Fallback Find button if ping had error */}
              {pingError && (
                <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#FEE2E2' }}>
                  <Button
                    mode="contained"
                    compact
                    icon="radar"
                    onPress={handleFindWatch}
                    loading={findingWatch}
                    disabled={findingWatch || pinging}
                    style={{ backgroundColor: '#DC2626' }}
                    labelStyle={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}
                  >
                    Find / Reconnect Nearby Watch
                  </Button>
                </View>
              )}
            </Surface>

            {/* Preparation Checklist */}
            <View style={styles.instructionsBox}>
              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 8 }}
              >
                Movement Tracking Checklist:
              </Text>

              <View style={styles.checkItem}>
                <Icon source="check-circle-outline" size={18} color="#2E7D32" />
                <Text variant="bodySmall" style={styles.checkItemText}>
                  <Text style={{ fontWeight: '700' }}>Wear snugly on wrist: </Text>
                  Sensors track accelerations, lateral bounds, and vertical jumps.
                </Text>
              </View>

              <View style={styles.checkItem}>
                <Icon source="check-circle-outline" size={18} color="#2E7D32" />
                <Text variant="bodySmall" style={styles.checkItemText}>
                  <Text style={{ fontWeight: '700' }}>Open SmartAthlete on watch: </Text>
                  Ensure watch display shows the active session.
                </Text>
              </View>

              <View style={styles.checkItem}>
                <Icon source="check-circle-outline" size={18} color="#2E7D32" />
                <Text variant="bodySmall" style={styles.checkItemText}>
                  <Text style={{ fontWeight: '700' }}>Live telemetry: </Text>
                  Movement load will transmit directly to your Coach.
                </Text>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.actionButtons}>
              <Button
                mode="contained"
                icon="check-bold"
                onPress={handleStartTracking}
                loading={startingSession}
                disabled={startingSession}
                style={styles.primaryButton}
                contentStyle={{ height: 48 }}
                labelStyle={{ fontWeight: '700', fontSize: 15 }}
              >
                Watch is Ready — Start Tracking
              </Button>

              <Button
                mode="text"
                compact
                icon="cog-outline"
                onPress={handlePairWatch}
                labelStyle={{ fontSize: 12 }}
              >
                Manage Smartwatch Settings
              </Button>
            </View>
          </View>
        ) : (
          /* ─── No Device Linked Warning ─── */
          <View style={styles.contentWrap}>
            <Surface
              style={[
                styles.deviceStatusCard,
                {
                  backgroundColor: '#FFF3E0',
                  borderColor: '#FFE0B2',
                },
              ]}
              elevation={0}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon source="alert-circle" size={24} color="#E65100" />
                <View style={{ flex: 1 }}>
                  <Text
                    variant="titleSmall"
                    style={{ color: '#E65100', fontWeight: '700' }}
                  >
                    No Smartwatch Linked
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: '#8D4004', marginTop: 2, lineHeight: 16 }}
                  >
                    The watch is required to track your training movements, jump count, and
                    drill intensity.
                  </Text>
                </View>
              </View>
            </Surface>

            <View style={styles.actionButtons}>
              <Button
                mode="contained"
                icon="radar"
                onPress={handleFindWatch}
                loading={findingWatch}
                disabled={findingWatch}
                style={styles.primaryButton}
                contentStyle={{ height: 48 }}
                labelStyle={{ fontWeight: '700', fontSize: 15 }}
              >
                Scan & Find Nearby Watch
              </Button>

              <Button
                mode="outlined"
                icon="bluetooth-connect"
                onPress={handlePairWatch}
                style={{ borderRadius: 14 }}
                contentStyle={{ height: 44 }}
                labelStyle={{ fontWeight: '700', fontSize: 14 }}
              >
                Pair Smartwatch via Code
              </Button>

              <Button
                mode="outlined"
                onPress={onDismiss}
                style={{ borderRadius: 12, marginTop: 4 }}
                labelStyle={{ fontSize: 13 }}
              >
                Continue Without Movement Tracking
              </Button>
            </View>
          </View>
        )}
      </Modal>
    </Portal>
  );
}

// ─── Companion Card Component for Check-in / Home Screen ───────

interface WatchTrackingCardProps {
  deviceLink: DeviceLink | null;
  onVerifyPress: () => void;
  onSetupPress: () => void;
  onLiveTrackingPress?: () => void;
}

export function WatchTrackingCard({
  deviceLink,
  onVerifyPress,
  onSetupPress,
  onLiveTrackingPress,
}: WatchTrackingCardProps) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Card
      mode="outlined"
      style={[
        styles.trackingCard,
        {
          borderColor: deviceLink ? '#A5D6A7' : theme.colors.outlineVariant,
          backgroundColor: deviceLink ? '#F1F8F4' : theme.colors.elevation.level1,
        },
      ]}
    >
      <Card.Content style={styles.trackingCardContent}>
        <View style={styles.trackingLeft}>
          <View
            style={[
              styles.trackingIconBadge,
              {
                backgroundColor: deviceLink ? '#E8F5E9' : theme.colors.elevation.level2,
              },
            ]}
          >
            <Icon
              source={deviceLink ? 'watch-vibrate' : 'watch-variant'}
              size={24}
              color={deviceLink ? '#2E7D32' : theme.colors.onSurfaceVariant}
            />
          </View>

          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text
                variant="titleSmall"
                style={{
                  color: deviceLink ? '#1B5E3B' : theme.colors.onSurface,
                  fontWeight: '700',
                }}
              >
                {deviceLink ? 'Smartwatch Ready' : 'Smartwatch Required'}
              </Text>
              <View
                style={[
                  styles.pulseDot,
                  { backgroundColor: deviceLink ? '#2E7D32' : '#FF9800' },
                ]}
              />
            </View>

            <Text
              variant="bodySmall"
              style={{
                color: deviceLink ? '#2E7D32' : theme.colors.onSurfaceVariant,
                marginTop: 2,
              }}
            >
              {deviceLink
                ? `${deviceLink.watch_name || 'Wear OS'} · Tracking movements & jumps`
                : 'Pair watch to capture movement telemetry'}
            </Text>
          </View>
        </View>

        {deviceLink ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Button
              mode="contained"
              compact
              icon="run-fast"
              onPress={onLiveTrackingPress || (() => router.push('/athlete/live-tracking' as any))}
              style={{ borderRadius: 10 }}
              labelStyle={{ fontSize: 11, fontWeight: '700' }}
            >
              Live Tracker
            </Button>
            <IconButton
              icon="information-outline"
              size={18}
              onPress={onVerifyPress}
              accessibilityLabel="Check watch readiness"
              style={{ margin: 0 }}
            />
          </View>
        ) : (
          <Button
            mode="contained"
            compact
            icon="plus"
            onPress={onSetupPress}
            style={{ borderRadius: 10 }}
            labelStyle={{ fontSize: 11, fontWeight: '700' }}
          >
            Pair Watch
          </Button>
        )}
      </Card.Content>
    </Card>
  );
}

// ─── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  modalContainer: {
    margin: 20,
    borderRadius: 24,
    padding: 22,
    elevation: 8,
  },
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  watchIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 8,
  },
  contentWrap: {
    gap: 14,
  },
  deviceStatusCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  btWarningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  instructionsBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  pingCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  pingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  checkItemText: {
    flex: 1,
    color: '#334155',
    lineHeight: 18,
  },
  actionButtons: {
    gap: 6,
    marginTop: 4,
  },
  primaryButton: {
    borderRadius: 14,
  },

  // Companion Card Styles
  trackingCard: {
    borderRadius: 16,
    borderWidth: 1,
  },
  trackingCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
  },
  trackingLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  trackingIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
