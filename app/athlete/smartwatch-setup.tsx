import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
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
  IconButton,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { claimWatchLink, WATCH_IN_USE_MESSAGE } from '@/lib/deviceLink';
import {
  confirmPairingWithWatch,
  connectAndReadPairingCode,
  disconnectBleDevice,
  findWatchByPairingCode,
  startWatchLink,
  DiscoveredWearDevice,
  isBluetoothReady,
  requestBluetoothPermissions,
  scanForWearDevices,
  stopBleScan,
  waitForWatchResponse,
} from '@/lib/ble-manager';

export default function SmartwatchSetupScreen() {
  const theme = useTheme();
  const router = useRouter();

  // ── State ──────────────────────────────────────────────────
  const [pairMode, setPairMode] = useState<'scan' | 'code'>('scan');
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<DiscoveredWearDevice[]>([]);
  const [linking, setLinking] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string>('Make sure your watch screen shows "Link Smartwatch"');
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [watchLabelInput, setWatchLabelInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Animations ─────────────────────────────────────────────
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const stopScanRef = useRef<(() => void) | null>(null);
  // Lets "Skip" abandon a pairing that is still waiting for the watch
  const pairingCancelledRef = useRef(false);
  const pairingDeviceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (scanning) {
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
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 3500,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    } else {
      pulseAnim.setValue(1);
      rotateAnim.setValue(0);
    }
  }, [scanning, pulseAnim, rotateAnim]);

  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Cleanup BLE on unmount
  useEffect(() => {
    return () => {
      if (stopScanRef.current) {
        stopScanRef.current();
      }
      stopBleScan();
    };
  }, []);

  // ── Start Real BLE Scan ────────────────────────────────────
  const startScan = useCallback(async () => {
    setErrorMsg(null);
    setDevices([]);

    try {
      const hasPermission = await requestBluetoothPermissions();
      if (!hasPermission) {
        setErrorMsg('Bluetooth and Location permissions are required to scan for watches.');
        return;
      }

      const ready = await isBluetoothReady();
      if (!ready) {
        setErrorMsg('Please turn on Bluetooth on your phone.');
        return;
      }

      setScanning(true);
      setStatusNote('Scanning for nearby Wear OS smartwatches…');

      const stopFn = scanForWearDevices(
        (discovered) => {
          setDevices((prev) => {
            if (prev.some((d) => d.id === discovered.id)) return prev;
            return [...prev, discovered];
          });
          setStatusNote(`Found ${discovered.name}! Tap to connect & pair.`);
        },
        (error) => {
          console.warn('BLE Scan error:', error.message);
          setErrorMsg(error.message || 'Bluetooth scan error.');
          setScanning(false);
        }
      );

      stopScanRef.current = stopFn;
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize Bluetooth.');
      setScanning(false);
    }
  }, []);

  const stopScan = useCallback(() => {
    if (stopScanRef.current) {
      stopScanRef.current();
      stopScanRef.current = null;
    }
    stopBleScan();
    setScanning(false);
    setStatusNote('Scan stopped. Tap below to search again.');
  }, []);

  // ── Pairing (shared by "pick from list" and "enter code") ──
  // Sends the pairing request with this account, waits for the watch, and saves the
  // link only if the watch accepted. A watch linked to another account answers IN_USE.
  const completePairing = async (watch: {
    connectedDevice: Parameters<typeof confirmPairingWithWatch>[0];
    deviceId: string;
    pairingCode: string;
    deviceName: string;
    watchUid: string | null;
  }) => {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      throw new Error('User session not found. Please sign in again.');
    }
    if (!watch.watchUid) {
      // Without its permanent ID the one-account-per-watch rule can't be applied
      await disconnectBleDevice(watch.deviceId);
      setErrorMsg(
        'This watch is running an older SmartAthlete app. Update the app on the watch, then try linking again.'
      );
      return;
    }
    if (pairingCancelledRef.current) return;

    setStatusNote('Sending pairing request to watch…');
    await confirmPairingWithWatch(watch.connectedDevice, 'Athlete App', user.id);

    // Brief tick for BLE stack
    await new Promise((r) => setTimeout(r, 200));

    setStatusNote(`Waiting for watch confirmation (code ${watch.pairingCode})…`);
    const watchResponse = await waitForWatchResponse(watch.connectedDevice);
    // The athlete skipped while waiting: don't save anything
    if (pairingCancelledRef.current) return;

    if (watchResponse === 'DECLINED') {
      await disconnectBleDevice(watch.deviceId);
      setErrorMsg('The watch declined the pairing request. Please try again.');
      return;
    }
    if (watchResponse === 'IN_USE') {
      await disconnectBleDevice(watch.deviceId);
      setErrorMsg(WATCH_IN_USE_MESSAGE);
      return;
    }

    // Watch accepted — save the link (one active account per watch)
    setStatusNote('Watch accepted! Saving link…');
    const saved = await claimWatchLink(user.id, watch.watchUid, watch.deviceId, watch.deviceName);
    await disconnectBleDevice(watch.deviceId);
    if (!saved.ok) {
      setErrorMsg(saved.error ?? 'Could not save the watch link.');
      return;
    }
    // Stay connected to the newly linked watch from now on
    startWatchLink(watch.deviceId);

    Alert.alert(
      'Smartwatch Linked!',
      `Your ${watch.deviceName} (Code: ${watch.pairingCode}) is now paired with your athlete account.`,
      [
        {
          text: 'View in Profile',
          onPress: () => router.replace('/athlete/profile' as any),
        },
        {
          text: 'Go to Dashboard',
          onPress: () => router.replace('/athlete/home' as any),
        },
      ]
    );
  };

  const friendlyPairingError = (err: any) => {
    const isDisconnect =
      err?.message?.toLowerCase().includes('disconnect') ||
      err?.message?.toLowerCase().includes('lost connection');
    return isDisconnect
      ? 'Could not connect to watch (connection dropped). Please ensure your watch screen is active and try again.'
      : err?.message || 'Failed to complete pairing with watch.';
  };

  // ── Handle BLE Device Selection & Pairing ──────────────────
  const handleSelectDevice = async (deviceItem: DiscoveredWearDevice) => {
    pairingCancelledRef.current = false;
    pairingDeviceIdRef.current = deviceItem.id;
    setSelectedDeviceId(deviceItem.id);
    setLinking(true);
    setErrorMsg(null);
    stopScan();

    try {
      setStatusNote(`Connecting to ${deviceItem.name}…`);
      const watch = await connectAndReadPairingCode(deviceItem.rawDevice);
      await completePairing({ ...watch, deviceId: deviceItem.id });
    } catch (err: any) {
      if (pairingCancelledRef.current) return;
      console.error('BLE Linking error:', err);
      setErrorMsg(friendlyPairingError(err));
      await disconnectBleDevice(deviceItem.id);
    } finally {
      pairingDeviceIdRef.current = null;
      setLinking(false);
      setSelectedDeviceId(null);
    }
  };

  // ── Pairing with the code shown on the watch ───────────────
  // The code only identifies which nearby watch to pair with; the watch still has to
  // accept, so a watch linked to someone else can't be claimed by typing its code.
  const handlePairWithCode = async () => {
    const code = pairingCodeInput.trim();
    if (!/^\d{6}$/.test(code)) {
      setErrorMsg('Please enter the 6-digit pairing code shown on your watch.');
      return;
    }

    pairingCancelledRef.current = false;
    setLinking(true);
    setErrorMsg(null);
    stopScan();

    let deviceId: string | null = null;
    try {
      const ok = await requestBluetoothPermissions();
      if (!ok || !(await isBluetoothReady())) {
        throw new Error('Turn on Bluetooth (and allow the permission) so the app can reach your watch.');
      }

      const watch = await findWatchByPairingCode(code, setStatusNote);
      if (!watch) {
        setErrorMsg(
          `No nearby watch is showing code ${code}. Keep the watch awake and close to your phone, then try again.`
        );
        return;
      }
      deviceId = watch.deviceId;
      pairingDeviceIdRef.current = deviceId;
      if (pairingCancelledRef.current) {
        await disconnectBleDevice(deviceId);
        return;
      }
      const label = watchLabelInput.trim();
      await completePairing({ ...watch, deviceName: label || watch.deviceName });
    } catch (err: any) {
      if (pairingCancelledRef.current) return;
      console.error('Code pairing error:', err);
      setErrorMsg(friendlyPairingError(err));
      if (deviceId) await disconnectBleDevice(deviceId);
    } finally {
      pairingDeviceIdRef.current = null;
      setLinking(false);
    }
  };

  // Skip works even mid-pairing: stop waiting for the watch, drop the connection, leave.
  const handleSkip = () => {
    if (linking) {
      pairingCancelledRef.current = true;
      const id = pairingDeviceIdRef.current;
      if (id) disconnectBleDevice(id).catch(() => {});
      pairingDeviceIdRef.current = null;
      setLinking(false);
      setSelectedDeviceId(null);
      setStatusNote('');
    }
    stopScan();
    router.replace('/athlete/home' as any);
  };

  const getSignalLabel = (rssi: number | null) => {
    if (rssi === null) return 'Nearby';
    if (rssi >= -60) return 'Strong';
    if (rssi >= -75) return 'Good';
    return 'Fair';
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        <View style={styles.container}>
          {/* ─── Header ─── */}
          <View style={styles.header}>
            <Text
              variant="headlineSmall"
              style={[styles.title, { color: theme.colors.onBackground }]}
            >
              Link Wear OS Watch
            </Text>
            <Text
              variant="bodyMedium"
              style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
            >
              Connect your smartwatch via Bluetooth to record live telemetry during sessions.
            </Text>
          </View>

          {/* ─── Segmented Mode Selector ─── */}
          <SegmentedButtons
            value={pairMode}
            onValueChange={(val) => setPairMode(val as 'scan' | 'code')}
            buttons={[
              {
                value: 'scan',
                label: 'Bluetooth Scan',
                icon: 'bluetooth',
              },
              {
                value: 'code',
                label: 'Enter Code',
                icon: 'numeric',
              },
            ]}
            style={styles.segment}
          />

          {/* ─── Scan Tab ─── */}
          {pairMode === 'scan' ? (
            <View style={styles.scanSection}>
              {/* Animated Radar Pulse */}
              <View style={styles.radarWrapper}>
                <Animated.View
                  style={[
                    styles.pulseRing,
                    {
                      borderColor: scanning
                        ? theme.colors.primary
                        : theme.colors.outlineVariant,
                      transform: [{ scale: pulseAnim }],
                      opacity: scanning ? 0.35 : 0.15,
                    },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.radarCenter,
                    {
                      backgroundColor: scanning
                        ? theme.colors.primaryContainer
                        : theme.colors.elevation.level2,
                      transform: [{ rotate: scanning ? rotateInterpolate : '0deg' }],
                    },
                  ]}
                >
                  <IconButton
                    icon={scanning ? 'radar' : 'watch'}
                    size={36}
                    iconColor={
                      scanning
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant
                    }
                  />
                </Animated.View>
              </View>

              <Text
                variant="labelLarge"
                style={[
                  styles.scanStatusText,
                  {
                    color: scanning
                      ? theme.colors.primary
                      : theme.colors.onSurfaceVariant,
                  },
                ]}
              >
                {statusNote}
              </Text>

              {/* Discovered Device List */}
              <FlatList
                data={devices}
                keyExtractor={(item) => item.id}
                style={styles.deviceList}
                contentContainerStyle={{ gap: 10, paddingVertical: 8 }}
                renderItem={({ item }) => {
                  const isSelected = selectedDeviceId === item.id;
                  return (
                    <Card
                      mode="outlined"
                      style={[
                        styles.deviceCard,
                        isSelected && {
                          borderColor: theme.colors.primary,
                          backgroundColor: theme.colors.primaryContainer,
                        },
                      ]}
                      onPress={() => !linking && handleSelectDevice(item)}
                    >
                      <Card.Content style={styles.deviceCardRow}>
                        <View style={styles.deviceCardLeft}>
                          <Avatar.Icon
                            size={40}
                            icon="watch"
                            style={{
                              backgroundColor: theme.colors.primaryContainer,
                            }}
                            color={theme.colors.primary}
                          />
                          <View style={{ flex: 1 }}>
                            <Text
                              variant="titleSmall"
                              style={{
                                color: theme.colors.onSurface,
                                fontWeight: 'bold',
                              }}
                            >
                              {item.name}
                            </Text>
                            <Text
                              variant="bodySmall"
                              style={{ color: theme.colors.onSurfaceVariant }}
                            >
                              ID: {item.id}
                            </Text>
                          </View>
                        </View>

                        {isSelected && linking ? (
                          <ActivityIndicator
                            size="small"
                            color={theme.colors.primary}
                          />
                        ) : (
                          <Chip
                            compact
                            textStyle={{ fontSize: 11 }}
                            style={{
                              backgroundColor: theme.colors.elevation.level2,
                            }}
                          >
                            {getSignalLabel(item.rssi)}
                          </Chip>
                        )}
                      </Card.Content>
                    </Card>
                  );
                }}
                ListEmptyComponent={
                  !scanning ? (
                    <View style={styles.emptyList}>
                      <Text
                        variant="bodyMedium"
                        style={{
                          color: theme.colors.onSurfaceVariant,
                          textAlign: 'center',
                        }}
                      >
                        Tap below to start scanning for your Wear OS watch.
                      </Text>
                    </View>
                  ) : null
                }
              />

              <Button
                mode="contained"
                icon={scanning ? 'stop' : 'radar'}
                onPress={scanning ? stopScan : startScan}
                style={styles.actionBtn}
                loading={scanning}
                disabled={linking}
              >
                {scanning ? 'Stop Scanning' : 'Scan for Watches'}
              </Button>
            </View>
          ) : (
            /* ─── Code Tab ─── */
            <View style={styles.codeSection}>
              <Card
                mode="elevated"
                style={[
                  styles.codeCard,
                  { backgroundColor: theme.colors.elevation.level1 },
                ]}
              >
                <Card.Content style={{ gap: 14 }}>
                  <View style={{ alignItems: 'center', gap: 6 }}>
                    <Avatar.Icon
                      size={48}
                      icon="numeric"
                      style={{
                        backgroundColor: theme.colors.primaryContainer,
                      }}
                      color={theme.colors.primary}
                    />
                    <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                      Enter Watch Pairing Code
                    </Text>
                    <Text
                      variant="bodySmall"
                      style={{
                        color: theme.colors.onSurfaceVariant,
                        textAlign: 'center',
                      }}
                    >
                      Look at your smartwatch display for the 6-digit pairing code.
                    </Text>
                  </View>

                  <TextInput
                    mode="outlined"
                    label="6-Digit Code"
                    placeholder="e.g. 849215"
                    value={pairingCodeInput}
                    onChangeText={setPairingCodeInput}
                    keyboardType="number-pad"
                    maxLength={10}
                    left={<TextInput.Icon icon="key" />}
                    style={{ backgroundColor: 'transparent' }}
                  />

                  <TextInput
                    mode="outlined"
                    label="Watch Label (Optional)"
                    placeholder="e.g. Samsung Galaxy Watch"
                    value={watchLabelInput}
                    onChangeText={setWatchLabelInput}
                    left={<TextInput.Icon icon="watch" />}
                    style={{ backgroundColor: 'transparent' }}
                  />

                  <Button
                    mode="contained"
                    icon="link"
                    onPress={handlePairWithCode}
                    style={styles.actionBtn}
                    loading={linking}
                    disabled={linking || !pairingCodeInput.trim()}
                  >
                    Link Watch with Code
                  </Button>
                </Card.Content>
              </Card>
            </View>
          )}

          {/* ─── Error Notification ─── */}
          {errorMsg && (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: theme.colors.errorContainer },
              ]}
            >
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onErrorContainer }}
              >
                {errorMsg}
              </Text>
            </View>
          )}

          <Divider style={{ marginVertical: 8 }} />

          {/* ─── Skip Option ─── */}
          <Button
            mode="text"
            onPress={handleSkip}
            labelStyle={{ color: theme.colors.onSurfaceVariant }}
          >
            {linking ? 'Cancel pairing & skip for now' : 'Skip for now (Continue to Home)'}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },
  header: {
    marginBottom: 12,
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    lineHeight: 20,
  },
  segment: {
    marginBottom: 16,
  },
  scanSection: {
    flex: 1,
    alignItems: 'center',
  },
  radarWrapper: {
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  pulseRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
  },
  radarCenter: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanStatusText: {
    marginBottom: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  deviceList: {
    width: '100%',
    flex: 1,
  },
  deviceCard: {
    borderRadius: 14,
  },
  deviceCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deviceCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  emptyList: {
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  codeSection: {
    flex: 1,
    justifyContent: 'center',
  },
  codeCard: {
    borderRadius: 16,
    paddingVertical: 12,
  },
  actionBtn: {
    borderRadius: 24,
    marginTop: 8,
    width: '100%',
  },
  errorBox: {
    borderRadius: 12,
    padding: 12,
    marginVertical: 6,
  },
});
