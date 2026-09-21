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
  Modal,
  Portal,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { useRouter } from 'expo-router';

import { DeviceLink, getActiveDeviceLink } from '@/lib/deviceLink';
import { isBluetoothReady } from '@/lib/ble-manager';

interface WatchReadinessModalProps {
  visible: boolean;
  onDismiss: () => void;
  athleteId?: number;
  athleteName?: string;
  userId?: string;
  sessionTitle?: string;
  drillCount?: number;
  totalDurationMinutes?: number;
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
}: WatchReadinessModalProps) {
  const theme = useTheme();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [deviceLink, setDeviceLink] = useState<DeviceLink | null>(null);
  const [btReady, setBtReady] = useState(true);
  const [pulseAnim] = useState(new Animated.Value(1));

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
                onPress={onDismiss}
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
                icon="bluetooth-connect"
                onPress={handlePairWatch}
                style={styles.primaryButton}
                contentStyle={{ height: 48 }}
                labelStyle={{ fontWeight: '700', fontSize: 15 }}
              >
                Pair Smartwatch Now
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
}

export function WatchTrackingCard({
  deviceLink,
  onVerifyPress,
  onSetupPress,
}: WatchTrackingCardProps) {
  const theme = useTheme();

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

        <Button
          mode={deviceLink ? 'outlined' : 'contained'}
          compact
          icon={deviceLink ? 'check-circle-outline' : 'plus'}
          onPress={deviceLink ? onVerifyPress : onSetupPress}
          style={{ borderRadius: 10 }}
          labelStyle={{ fontSize: 11, fontWeight: '700' }}
        >
          {deviceLink ? 'Check Readiness' : 'Pair Watch'}
        </Button>
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
    backgroundColor: '#F8F9FA',
    borderRadius: 14,
    padding: 14,
    gap: 10,
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
