/**
 * SmartAthlete BLE Manager
 *
 * Full BLE client for scanning, connecting, reading the pairing code,
 * and sending confirmation to the Wear OS GATT server.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, State } from 'react-native-ble-plx';
import {
  BLE_SERVICE_UUID,
  CONNECTION_TIMEOUT_MS,
  DEVICE_NAME_CHAR_UUID,
  LIVE_TELEMETRY_CHAR_UUID,
  PAIRING_ACCEPTED,
  PAIRING_CODE_CHAR_UUID,
  PAIRING_CONFIRM_CHAR_UUID,
  PAIRING_CONFIRM_VALUE,
  PAIRING_DECLINED,
  PAIRING_IN_USE,
  PAIRING_RESPONSE_CHAR_UUID,
  PING_CMD,
  PING_TIMEOUT_MS,
  PONG_RESP,
  SCAN_TIMEOUT_MS,
  SESSION_END_CMD,
  SESSION_NEXT_DRILL_CMD,
  SESSION_PAUSE_CMD,
  SESSION_REGIME_PREFIX,
  SESSION_RESUME_CMD,
  SESSION_WORKOUT_PREFIX,
  UNLINK_PREFIX,
  UNLINK_REQUEST_VALUE,
  WATCH_ID_CHAR_UUID,
  WATCH_RESPONSE_TIMEOUT_MS,
} from '@/constants/ble';
import { SensorProfile, resolveSensorProfile } from '@/constants/sensorProfiles';
import { trackingService } from '@/lib/trackingService';

let bleManagerInstance: BleManager | null = null;
let activeTelemetryDevice: Device | null = null;

export function getBleManager(): BleManager {
  if (!bleManagerInstance) {
    bleManagerInstance = new BleManager();
  }
  return bleManagerInstance;
}

export function destroyBleManager(): void {
  if (bleManagerInstance) {
    bleManagerInstance.destroy();
    bleManagerInstance = null;
  }
}

export interface DiscoveredWearDevice {
  id: string;
  name: string;
  rssi: number | null;
  rawDevice: Device;
}

/**
 * Request all required Bluetooth permissions based on Android API level.
 */
export async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  const apiLevel =
    typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);

  if (apiLevel >= 31) {
    // Android 12+ (API 31+)
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);

    return (
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
        PermissionsAndroid.RESULTS.GRANTED &&
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
        PermissionsAndroid.RESULTS.GRANTED
    );
  } else {
    // Android 6-11
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }
}

/**
 * Checks whether Bluetooth is powered on and ready.
 */
export async function isBluetoothReady(): Promise<boolean> {
  const manager = getBleManager();
  const state = await manager.state();
  return state === State.PoweredOn;
}

/**
 * Start scanning for Wear OS peripherals advertising SmartAthlete GATT service.
 */
export function scanForWearDevices(
  onDeviceFound: (device: DiscoveredWearDevice) => void,
  onError: (error: Error) => void
): () => void {
  const manager = getBleManager();

  // Scan with service UUID filter + null fallback to find Wear OS watches
  manager.startDeviceScan(
    [BLE_SERVICE_UUID],
    { allowDuplicates: false },
    (error, device) => {
      if (error) {
        onError(error);
        return;
      }

      if (device) {
        const name = device.name || device.localName || 'SmartAthlete Watch';
        onDeviceFound({
          id: device.id,
          name,
          rssi: device.rssi,
          rawDevice: device,
        });
      }
    }
  );

  // Auto-stop scanning after timeout
  const timeoutId = setTimeout(() => {
    manager.stopDeviceScan();
  }, SCAN_TIMEOUT_MS);

  return () => {
    clearTimeout(timeoutId);
    manager.stopDeviceScan();
  };
}

export function stopBleScan(): void {
  const manager = getBleManager();
  manager.stopDeviceScan();
}

/**
 * Decodes a base64 string to a UTF-8 string without depending on Node global Buffer.
 */
export function base64ToUtf8(base64: string): string {
  if (!base64) return '';

  // 1. Try global Buffer if available
  try {
    const Buf = (typeof global !== 'undefined' && (global as any).Buffer) || require('buffer').Buffer;
    if (Buf) {
      return Buf.from(base64, 'base64').toString('utf-8');
    }
  } catch {}

  // 2. Try atob + TextDecoder
  try {
    if (typeof atob === 'function') {
      const binary = atob(base64);
      if (typeof TextDecoder !== 'undefined') {
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder('utf-8').decode(bytes);
      }
      return binary;
    }
  } catch {}

  // 3. Pure JS fallback
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let str = base64.replace(/=+$/, '');
    let output = '';
    for (
      let bc = 0, bs = 0, buffer: number, idx = 0;
      (buffer = str.charCodeAt(idx++));
      ~buffer && ((bs = bc % 4 ? bs * 64 + buffer : buffer), bc++ % 4)
        ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
        : 0
    ) {
      buffer = chars.indexOf(String.fromCharCode(buffer));
    }
    return output;
  } catch {
    return base64;
  }
}

/**
 * Encodes a UTF-8 string to a base64 string without depending on Node global Buffer.
 */
export function utf8ToBase64(str: string): string {
  if (!str) return '';

  // 1. Try global Buffer if available
  try {
    const Buf = (typeof global !== 'undefined' && (global as any).Buffer) || require('buffer').Buffer;
    if (Buf) {
      return Buf.from(str, 'utf-8').toString('base64');
    }
  } catch {}

  // 2. Try TextEncoder + btoa
  try {
    if (typeof btoa === 'function') {
      if (typeof TextEncoder !== 'undefined') {
        const bytes = new TextEncoder().encode(str);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      }
      return btoa(unescape(encodeURIComponent(str)));
    }
  } catch {}

  // 3. Pure JS fallback
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let output = '';
    for (
      let block = 0, charCode: number, idx = 0, map = chars;
      str.charAt(idx | 0) || ((map = '='), idx % 1);
      output += map.charAt(63 & (block >> (8 - (idx % 1) * 8)))
    ) {
      charCode = str.charCodeAt((idx += 3 / 4));
      block = (block << 8) | charCode;
    }
    return output;
  } catch {
    return str;
  }
}

/**
 * Safely connects to a BLE device, handling:
 * 1. Checking if the device is already connected in Android's Bluetooth stack (e.g. across app reloads)
 * 2. Post-scan settling delay (300ms) to avoid Android HCI 133 connection abort races
 * 3. Automatic 1-time retry with clean backoff if the initial connection drops
 */
export async function safeConnectToDevice(device: Device): Promise<Device> {
  const manager = getBleManager();

  // 1. Check if the device is already connected in the OS Bluetooth stack
  try {
    const isConnected = await manager.isDeviceConnected(device.id);
    if (isConnected) {
      console.log(`Device ${device.id} is already connected. Checking services…`);
      try {
        await device.discoverAllServicesAndCharacteristics();
        return device;
      } catch {
        // Cached connection failed discovery, clean up and re-establish
        await manager.cancelDeviceConnection(device.id).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  } catch {}

  // 2. Delay 300ms after stopping scan to let Android Bluetooth controller stabilize
  await new Promise((r) => setTimeout(r, 300));

  // 3. Connect attempt with timeout and auto-retry
  const doConnect = async (): Promise<Device> => {
    const connected = await Promise.race([
      device.connect({ autoConnect: false }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Connection to smartwatch timed out')),
          CONNECTION_TIMEOUT_MS
        )
      ),
    ]);
    await connected.discoverAllServicesAndCharacteristics();
    // Negotiate higher MTU on Android for fast, reliable unfragmented characteristic writes
    if (Platform.OS === 'android') {
      try {
        await connected.requestMTU(512);
      } catch {}
    }
    return connected;
  };

  try {
    return await doConnect();
  } catch (firstErr: any) {
    console.warn(
      'First connection attempt dropped, cleaning up and retrying in 500ms:',
      firstErr?.message
    );
    try {
      await manager.cancelDeviceConnection(device.id).catch(() => {});
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
    return await doConnect();
  }
}

/**
 * Connects to the watch, discovers characteristics, and reads the pairing code.
 */
export async function connectAndReadPairingCode(device: Device): Promise<{
  connectedDevice: Device;
  pairingCode: string;
  deviceName: string;
  /** Permanent watch ID, or null for watch builds that don't expose it */
  watchUid: string | null;
}> {
  // Use robust safe connection with auto-retry and post-scan settling
  const connectedDevice = await safeConnectToDevice(device);

  // Read pairing code characteristic
  const codeChar = await connectedDevice.readCharacteristicForService(
    BLE_SERVICE_UUID,
    PAIRING_CODE_CHAR_UUID
  );

  let pairingCode = '849215';
  if (codeChar && codeChar.value) {
    pairingCode = base64ToUtf8(codeChar.value);
  }

  // Try reading device name characteristic if available
  let deviceName = device.name || 'Wear OS Smartwatch';
  try {
    const nameChar = await connectedDevice.readCharacteristicForService(
      BLE_SERVICE_UUID,
      DEVICE_NAME_CHAR_UUID
    );
    if (nameChar && nameChar.value) {
      deviceName = base64ToUtf8(nameChar.value);
    }
  } catch {
    // Non-critical, fallback to device.name
  }

  const readWatchUid = async (d: Device): Promise<string | null> => {
    try {
      const idChar = await d.readCharacteristicForService(BLE_SERVICE_UUID, WATCH_ID_CHAR_UUID);
      return idChar?.value ? base64ToUtf8(idChar.value).trim() || null : null;
    } catch {
      return null;
    }
  };

  let finalDevice = connectedDevice;
  let watchUid = await readWatchUid(connectedDevice);

  // Android caches a peripheral's service list. A phone that paired with this watch
  // before the ID characteristic existed won't see it until that cache is refreshed.
  if (!watchUid && Platform.OS === 'android') {
    try {
      await getBleManager().cancelDeviceConnection(connectedDevice.id).catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      const refreshed = await device.connect({ autoConnect: false, refreshGatt: 'OnConnected' });
      await refreshed.discoverAllServicesAndCharacteristics();
      try {
        await refreshed.requestMTU(512);
      } catch {}
      finalDevice = refreshed;
      watchUid = await readWatchUid(refreshed);
    } catch (refreshErr: any) {
      console.warn('GATT cache refresh failed:', refreshErr?.message);
    }
  }

  return {
    connectedDevice: finalDevice,
    pairingCode,
    deviceName,
    watchUid,
  };
}

/**
 * Finds the nearby watch showing `pairingCode` on its screen: scans briefly, then
 * connects to each SmartAthlete watch found and reads its code. Returns the connected
 * watch, or null if none matched.
 */
export async function findWatchByPairingCode(
  pairingCode: string,
  onStatus?: (msg: string) => void,
  scanMs: number = 8000
): Promise<(Awaited<ReturnType<typeof connectAndReadPairingCode>> & { deviceId: string }) | null> {
  const found: DiscoveredWearDevice[] = [];
  onStatus?.('Looking for your watch nearby…');
  await new Promise<void>((resolve) => {
    const stop = scanForWearDevices(
      (d) => {
        if (!found.some((f) => f.id === d.id)) found.push(d);
      },
      () => resolve()
    );
    setTimeout(() => {
      stop();
      resolve();
    }, scanMs);
  });

  for (const d of found) {
    onStatus?.(`Checking ${d.name}…`);
    try {
      const res = await connectAndReadPairingCode(d.rawDevice);
      if (res.pairingCode.trim() === pairingCode.trim()) {
        return { ...res, deviceId: d.id };
      }
      await disconnectBleDevice(d.id);
    } catch {
      await disconnectBleDevice(d.id).catch(() => {});
    }
  }
  return null;
}

/**
 * Writes "CONFIRMED" to the watch's PAIRING_CONFIRM characteristic.
 * The watch shows an Accept/Decline prompt to the watch user.
 */
/**
 * Writes a command string to the watch's PAIRING_CONFIRM characteristic.
 *
 * Uses writeCharacteristicWithoutResponseForService as the primary write path:
 * - PAIRING_CONFIRM_CHAR explicitly supports PROPERTY_WRITE_NO_RESPONSE.
 * - ATT_WRITE_CMD is sent directly over the BLE link-layer without waiting for
 *   an application-layer GATT ATT_WRITE_RSP from the Wear OS GATT server.
 * - This prevents write response timeouts (5s) and avoids RxAndroidBle queue
 *   rejection errors ("Operation was rejected").
 *
 * If write-without-response throws, falls back cleanly to write-with-response.
 */
async function writeCommandToConfirmCharacteristic(
  device: Device,
  payload: string
): Promise<void> {
  const base64Value = utf8ToBase64(payload);

  try {
    await device.writeCharacteristicWithoutResponseForService(
      BLE_SERVICE_UUID,
      PAIRING_CONFIRM_CHAR_UUID,
      base64Value
    );
    return;
  } catch (noRespErr: any) {
    console.warn(
      'Write without response failed, attempting write with response:',
      noRespErr?.message
    );
  }

  // Fallback: write with response
  try {
    await device.writeCharacteristicWithResponseForService(
      BLE_SERVICE_UUID,
      PAIRING_CONFIRM_CHAR_UUID,
      base64Value
    );
  } catch (respErr: any) {
    console.error('Write with response failed:', respErr?.message);
    throw new Error(
      `Failed to send command to watch: ${respErr?.message || 'GATT write failed'}`
    );
  }
}

/**
 * Writes "CONFIRMED" to the watch's PAIRING_CONFIRM characteristic.
 * The watch shows an Accept/Decline prompt to the watch user.
 */
export async function confirmPairingWithWatch(
  device: Device,
  clientLabel: string = 'Athlete App',
  accountId?: string
): Promise<void> {
  const base = clientLabel ? `${PAIRING_CONFIRM_VALUE}:${clientLabel}` : PAIRING_CONFIRM_VALUE;
  // The watch remembers this account and refuses pairing requests from others while linked
  const payload = accountId ? `${base};acct=${accountId}` : base;
  await writeCommandToConfirmCharacteristic(device, payload);
}

/**
 * Subscribes to BLE notifications on the watch's PAIRING_RESPONSE characteristic
 * AND runs a concurrent polling read loop.
 * Waits for the watch user to Accept or Decline the pairing/unlinking request.
 *
 * Returns 'ACCEPTED' or 'DECLINED'.
 * Rejects if the watch does not respond within WATCH_RESPONSE_TIMEOUT_MS (60s).
 */
export function waitForWatchResponse(
  device: Device,
  timeoutMs: number = WATCH_RESPONSE_TIMEOUT_MS
): Promise<'ACCEPTED' | 'DECLINED' | 'IN_USE'> {
  return new Promise((resolve, reject) => {
    let subscription: { remove: () => void } | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let pollStartTimeout: ReturnType<typeof setTimeout> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (pollStartTimeout) {
        clearTimeout(pollStartTimeout);
        pollStartTimeout = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (subscription) {
        try {
          subscription.remove();
        } catch {}
        subscription = null;
      }
    };

    const handleResult = (val: string) => {
      if (settled) return;
      const clean = val.trim().toUpperCase();
      if (clean === PAIRING_ACCEPTED) {
        settled = true;
        cleanup();
        resolve('ACCEPTED');
      } else if (clean === PAIRING_DECLINED) {
        settled = true;
        cleanup();
        resolve('DECLINED');
      } else if (clean === PAIRING_IN_USE) {
        settled = true;
        cleanup();
        resolve('IN_USE');
      }
    };

    // 1. Overall Timeout (e.g. 60s)
    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Watch did not respond in time.'));
      }
    }, timeoutMs);

    // 2. BLE Notification listener (best-effort)
    try {
      subscription = device.monitorCharacteristicForService(
        BLE_SERVICE_UUID,
        PAIRING_RESPONSE_CHAR_UUID,
        (error, characteristic) => {
          if (settled) return;

          if (error) {
            console.warn('BLE notification warning (polling read active):', error.message);
            return;
          }

          if (characteristic?.value) {
            const val = base64ToUtf8(characteristic.value);
            handleResult(val);
          }
        }
      );
    } catch (subErr: any) {
      console.warn(
        'Could not start monitorCharacteristicForService, relying on polling:',
        subErr?.message
      );
    }

    // 3. Active GATT Polling Read (starts after 600ms so CCC notification registration completes first)
    pollStartTimeout = setTimeout(() => {
      if (settled) return;
      pollInterval = setInterval(async () => {
        if (settled) return;
        try {
          const char = await device.readCharacteristicForService(
            BLE_SERVICE_UUID,
            PAIRING_RESPONSE_CHAR_UUID
          );
          if (char?.value) {
            const val = base64ToUtf8(char.value);
            handleResult(val);
          }
        } catch {
          // Transient GATT read error (e.g. GATT busy), keep polling
        }
      }, 800);
    }, 600);
  });
}

/**
 * Writes an unlink request (e.g. "UNLINK: Athlete App" or "UNLINK") to the watch's
 * PAIRING_CONFIRM characteristic. The watch triggers onUnlinkRequestedListener and
 * prompts the watch user to Confirm or Cancel unlinking.
 */
export async function sendUnlinkRequestToWatch(
  device: Device,
  clientLabel: string = 'Athlete App'
): Promise<void> {
  const payload = clientLabel ? `${UNLINK_PREFIX} ${clientLabel}` : UNLINK_REQUEST_VALUE;
  await writeCommandToConfirmCharacteristic(device, payload);
}

/**
 * Connects to a watch for unlinking.
 * First checks permissions and Bluetooth state.
 * If watchNodeId is a valid BLE hardware address/UUID, tries direct connection.
 * If that fails or if watchNodeId is a manual code (e.g. 'WATCH-849215'),
 * performs a scan for the SmartAthlete GATT service and connects.
 */
export async function connectToWatchForUnlink(
  watchNodeId?: string,
  onStatusUpdate?: (status: string) => void
): Promise<Device> {
  const manager = getBleManager();

  const hasPermissions = await requestBluetoothPermissions();
  if (!hasPermissions) {
    throw new Error('Bluetooth permissions were not granted.');
  }

  const isReady = await isBluetoothReady();
  if (!isReady) {
    throw new Error('Bluetooth is turned off. Please turn on Bluetooth.');
  }

  const isDirectId =
    watchNodeId &&
    !watchNodeId.startsWith('WATCH-') &&
    (watchNodeId.includes(':') || watchNodeId.includes('-'));

  if (isDirectId) {
    onStatusUpdate?.('Connecting to your watch directly…');
    try {
      const alreadyConnected = await manager.isDeviceConnected(watchNodeId!);
      let device: Device;
      if (alreadyConnected) {
        const knownDevices = await manager.devices([watchNodeId!]).catch(() => []);
        device = knownDevices[0] || (await manager.connectToDevice(watchNodeId!));
      } else {
        device = await Promise.race([
          manager.connectToDevice(watchNodeId!),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Direct connection timeout')), 4500)
          ),
        ]);
      }
      await device.discoverAllServicesAndCharacteristics();
      if (Platform.OS === 'android') {
        try {
          await device.requestMTU(512);
        } catch {}
      }

      const svcs = await device.services().catch(() => []);
      const hasSmartAthlete = svcs.some(
        (s) => s.uuid.toLowerCase() === BLE_SERVICE_UUID.toLowerCase()
      );
      if (hasSmartAthlete) {
        activeTelemetryDevice = device;
        return device;
      }
      console.log(`Direct device ${watchNodeId} does not provide SmartAthlete service. Reconnecting to invalidate stale GATT cache… Services:`, svcs.map((s) => s.uuid));
      // Cancel stale connection and re-attempt once to force Android to re-read GATT table
      await manager.cancelDeviceConnection(watchNodeId!).catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      try {
        const freshDevice = await Promise.race([
          manager.connectToDevice(watchNodeId!),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Direct reconnection timeout')), 4500)
          ),
        ]);
        await freshDevice.discoverAllServicesAndCharacteristics();
        if (Platform.OS === 'android') {
          try {
            await freshDevice.requestMTU(512);
          } catch {}
        }
        const freshSvcs = await freshDevice.services().catch(() => []);
        const freshHas = freshSvcs.some(
          (s) => s.uuid.toLowerCase() === BLE_SERVICE_UUID.toLowerCase()
        );
        if (freshHas) {
          activeTelemetryDevice = freshDevice;
          return freshDevice;
        }
        await manager.cancelDeviceConnection(watchNodeId!).catch(() => {});
      } catch (freshErr) {
        console.log('Direct reconnect attempt failed:', freshErr);
      }
    } catch (directErr) {
      console.log('Direct connection to cached ID failed, scanning for nearby SmartAthlete watch:', directErr);
    }
  }

  onStatusUpdate?.('Scanning for your watch nearby…');
  return new Promise<Device>((resolve, reject) => {
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      try {
        manager.stopDeviceScan();
      } catch {}
    };

    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(
          new Error(
            'Could not find your SmartAthlete watch nearby. Please ensure the watch screen is active and Bluetooth is enabled.'
          )
        );
      }
    }, 12_000);

    manager.startDeviceScan(
      null,
      { allowDuplicates: false },
      async (error, scannedDevice) => {
        if (resolved) return;

        if (error) {
          resolved = true;
          cleanup();
          reject(new Error(error.message || 'Error scanning for watch.'));
          return;
        }

        if (scannedDevice) {
          const targetLower = watchNodeId?.toLowerCase();
          const devIdLower = scannedDevice.id.toLowerCase();
          const devName = scannedDevice.name || scannedDevice.localName || '';
          const hasSvc = scannedDevice.serviceUUIDs?.some(
            (u) => u.toLowerCase() === BLE_SERVICE_UUID.toLowerCase()
          );
          const isDirectMatch = Boolean(targetLower && devIdLower === targetLower);
          const isNameMatch =
            devName === 'SmartAthlete Watch' || devName.toLowerCase().includes('smartathlete');

          if (!hasSvc && !isDirectMatch && !isNameMatch) {
            return;
          }

          resolved = true;
          cleanup();
          onStatusUpdate?.(`Found ${devName || 'SmartAthlete watch'}! Connecting…`);

          try {
            const connectedDevice = await Promise.race([
              scannedDevice.connect(),
              new Promise<never>((_, rejectConn) =>
                setTimeout(() => rejectConn(new Error('Connection to watch timed out.')), 8000)
              ),
            ]);
            await connectedDevice.discoverAllServicesAndCharacteristics();
            if (Platform.OS === 'android') {
              try {
                await connectedDevice.requestMTU(512);
              } catch {}
            }
            activeTelemetryDevice = connectedDevice;
            resolve(connectedDevice);
          } catch (connErr: any) {
            reject(new Error(connErr.message || 'Failed to connect to watch.'));
          }
        }
      }
    );
  });
}

export const connectToWatch = connectToWatchForUnlink;

/**
 * High-level orchestration for two-way unlinking:
 * 1. Connects to the watch.
 * 2. Prepares notification listener on PAIRING_RESPONSE_CHAR_UUID.
 * 3. Writes UNLINK command to PAIRING_CONFIRM_CHAR_UUID.
 * 4. Waits for the watch user's response ('ACCEPTED' or 'DECLINED').
 * 5. Disconnects cleanly in all cases.
 */
export async function requestUnlinkFromWatch(
  watchNodeId?: string,
  clientLabel: string = 'Athlete App',
  onStatusUpdate?: (status: string) => void
): Promise<'ACCEPTED' | 'DECLINED'> {
  let connectedDevice: Device | null = null;
  try {
    connectedDevice = await connectToWatchForUnlink(watchNodeId, onStatusUpdate);

    onStatusUpdate?.('Sending unlink request to watch…');
    await sendUnlinkRequestToWatch(connectedDevice, clientLabel);

    // Brief tick for BLE stack
    await new Promise((r) => setTimeout(r, 200));

    onStatusUpdate?.('Unlink request sent. Waiting for your confirmation on watch…');
    const result = await waitForWatchResponse(connectedDevice);
    // IN_USE only answers pairing requests; for an unlink it means "not done"
    return result === 'IN_USE' ? 'DECLINED' : result;
  } finally {
    if (connectedDevice) {
      await disconnectBleDevice(connectedDevice.id);
    }
  }
}

/**
 * Disconnects from the given device if connected.
 */
export async function disconnectBleDevice(deviceId: string): Promise<void> {
  const manager = getBleManager();
  try {
    const connected = await manager.isDeviceConnected(deviceId);
    if (connected) {
      await manager.cancelDeviceConnection(deviceId);
    }
  } catch (err) {
    console.warn('BLE disconnect warning:', err);
  }
}

export interface SessionStartData {
  /** Identifies this run; the watch echoes it in telemetry so stale packets can be dropped */
  sid?: string;
  title: string;
  drillCount: number;
  totalDurationMinutes: number;
  drills?: Array<{
    name: string;
    durationMinutes: number;
    category?: string;
    sensorProfile?: SensorProfile;
  }>;
  /** Shown on the watch: venue name, or "At Home" for at-home sessions */
  venueName?: string | null;
  locationType?: 'venue' | 'at_home';
  date?: string;
  startTime?: string;
}

/** The session the athlete checked in to, for the watch's home screen. */
export interface WatchSessionInfo {
  title: string;
  venueName?: string | null;
  locationType: 'venue' | 'at_home';
  date?: string;
  startTime?: string;
}

/**
 * Tells the watch which session the athlete checked in to (or, with null, that the
 * check-in was cancelled) so its home screen shows the real venue or "At Home".
 * Goes through the watch outbox: if the watch isn't connected right now it gets the
 * message as soon as it is (only the newest session info is kept).
 */
export async function sendSessionInfoToWatch(
  _watchNodeId: string | undefined,
  info: WatchSessionInfo | null
): Promise<void> {
  const payload = `SESSION_INFO:${info
    ? JSON.stringify({
        title: info.title,
        venue: info.locationType === 'at_home' ? null : info.venueName || null,
        locationType: info.locationType,
        date: info.date ?? null,
        startTime: info.startTime ?? null,
      })
    : '{}'}`;
  await queueForWatch('session_info', payload);
}

/**
 * Sends a START_SESSION signal with session details (title, drill count, total duration, drills)
 * to the connected Wear OS watch via BLE.
 * Keeps the connection alive for immediate live telemetry streaming.
 */
export async function sendStartSessionToWatch(
  watchNodeId?: string,
  sessionData?: SessionStartData,
  onStatusUpdate?: (status: string) => void,
  keepConnectionAlive: boolean = true
): Promise<Device | null> {
  let connectedDevice: Device | null = null;
  try {
    connectedDevice = await connectToWatchForUnlink(watchNodeId, onStatusUpdate);
    onStatusUpdate?.('Sending session details to watch…');

    const data = sessionData || {
      title: 'Training Session',
      drillCount: 0,
      totalDurationMinutes: 0,
      drills: [],
    };
    // Only the fields the watch reads, plus each drill's sensor profile so the
    // watch can switch sensors on its own when the athlete advances from the wrist.
    const payload = `START_SESSION:${JSON.stringify({
      sid: data.sid,
      title: data.title,
      venue: data.locationType === 'at_home' ? null : data.venueName ?? null,
      locationType: data.locationType,
      date: data.date,
      startTime: data.startTime,
      drillCount: data.drillCount,
      totalDurationMinutes: data.totalDurationMinutes,
      drills: (data.drills || []).map((d) => ({
        name: d.name,
        durationMinutes: d.durationMinutes,
        category: d.category,
        profile: resolveSensorProfile(d),
      })),
    })}`;

    await writeCommandToConfirmCharacteristic(connectedDevice, payload);
    onStatusUpdate?.('Session started on watch!');

    if (keepConnectionAlive) {
      activeTelemetryDevice = connectedDevice;
      return connectedDevice;
    } else {
      await disconnectBleDevice(connectedDevice.id);
      return null;
    }
  } catch (err: any) {
    console.warn('Failed to send start session signal to watch:', err?.message);
    if (connectedDevice) {
      await disconnectBleDevice(connectedDevice.id).catch(() => {});
    }
    throw err;
  }
}

export interface WatchLiveTelemetry {
  secs: number;
  steps: number;
  meters: number;
  jumps: number;
  /** Reps counted by the watch (absent on older watch builds) */
  reps?: number;
  bpm: number;
  heartRate?: number;
  moving: boolean;
  paused: boolean;
  drill: number;
  /** True when the watch user pressed Complete/End Session */
  completed: boolean;
  /** True when the watch is confirmed worn on wrist with skin contact */
  onBody?: boolean;
  /** Accelerometer PlayerLoad (AU) accumulated on the watch */
  load?: number;
  /** Current speed (km/h) from the watch's rolling step window */
  speed?: number;
  /** Current cadence (steps/min) */
  cadence?: number;
  /** Sensor profile the watch is currently running */
  profile?: SensorProfile;
  /** Session id echoed from START_SESSION (absent on older watch builds) */
  sid?: string;
}

const optionalNumber = (v: unknown): number | undefined => {
  const n = Number(v);
  return v !== undefined && v !== null && !isNaN(n) ? n : undefined;
};

/** A drill the watch recorded while the phone was out of range. */
export interface WatchDrillRecord {
  sid: string;
  index: number;
  name: string;
  startSecs: number;
  endSecs: number;
  steps: number;
  meters: number;
  jumps: number;
  reps: number;
  load: number;
  avgHeartRate: number;
  maxHeartRate: number;
  /** The session ended (on the watch) with this drill */
  done: boolean;
  /** Session totals at the end, present when `done` */
  totals?: { steps: number; meters: number; jumps: number; reps: number; load: number; secs: number };
}

function parseDrillRecord(p: any): WatchDrillRecord | null {
  if (p?.t !== 'drill' || typeof p.sid !== 'string' || typeof p.i !== 'number') return null;
  const n = (v: unknown) => (typeof v === 'number' && !isNaN(v) ? v : 0);
  return {
    sid: p.sid,
    index: p.i,
    name: typeof p.n === 'string' ? p.n : `Drill ${p.i + 1}`,
    startSecs: n(p.s),
    endSecs: n(p.e),
    steps: n(p.st),
    meters: n(p.m),
    jumps: n(p.j),
    reps: n(p.r),
    load: n(p.l),
    avgHeartRate: n(p.ha),
    maxHeartRate: n(p.hm),
    done: p.done === true,
    totals: p.tot
      ? { steps: n(p.tot.st), meters: n(p.tot.m), jumps: n(p.tot.j), reps: n(p.tot.r), load: n(p.tot.l), secs: n(p.tot.secs) }
      : undefined,
  };
}

const RECONNECT_DELAY_MS = 5000;

/**
 * Subscribes to live sensor telemetry streaming from the Wear OS smartwatch.
 * Connects to the watch (or re-uses cached active connection), monitors
 * LIVE_TELEMETRY_CHAR_UUID notifications, and polls as a robust fallback.
 *
 * If the watch goes out of range the subscription keeps trying to reconnect, so live
 * data resumes by itself once the devices are near each other again. Drill records the
 * watch saved meanwhile arrive through `onDrillRecord`; each is acknowledged so the
 * watch can delete its copy.
 *
 * Returns an unsubscription callback that stops monitoring and cleanly disconnects.
 */
export function startLiveTelemetrySubscription(
  watchNodeId: string | undefined,
  onTelemetry: (data: WatchLiveTelemetry) => void,
  onStatusChange?: (status: string) => void,
  handlers?: {
    onDrillRecord?: (record: WatchDrillRecord) => void;
    onConnectionChange?: (connected: boolean) => void;
    /** Watch status: drills still stored on it, and whether it is running a session */
    onWatchSyncStatus?: (status: { pending: number; active: boolean }) => void;
  }
): () => void {
  let isCancelled = false;
  let monitorSub: { remove: () => void } | null = null;
  let disconnectSub: { remove: () => void } | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connecting = false;
  let device: Device | null = activeTelemetryDevice;
  // The session takes over the telemetry characteristic from the persistent link
  stopLinkMonitor();

  const handleRawTelemetry = (rawStr: string) => {
    try {
      if (!rawStr || !rawStr.startsWith('{')) return;
      const parsed = JSON.parse(rawStr);

      // How many stored drills the watch still has to send
      if (parsed?.t === 'sync') {
        handlers?.onWatchSyncStatus?.({
          pending: Number(parsed.pend) || 0,
          active: parsed.active === true,
        });
        return;
      }

      // A drill the watch stored while out of range
      const record = parseDrillRecord(parsed);
      if (record) {
        handlers?.onDrillRecord?.(record);
        // Delivered: the watch may delete its copy (it re-sends until this arrives)
        sendSessionControlCommand(`DRILL_ACK:${record.sid}:${record.index}`, watchNodeId);
        return;
      }

      // Ensure the packet contains actual telemetry fields
      if (parsed.secs === undefined && parsed.steps === undefined) return;

      const bpmVal = Number(parsed.bpm ?? parsed.heartRate ?? 0);
      const onBody =
        parsed.onBody !== undefined
          ? Boolean(parsed.onBody)
          : (parsed.bpm !== undefined && Number(parsed.bpm) > 30) || bpmVal > 30;

      const telemetry: WatchLiveTelemetry = {
        secs: parsed.secs !== undefined ? Number(parsed.secs) : (undefined as any),
        steps: Number(parsed.steps ?? 0),
        meters: Number(parsed.meters ?? 0),
        jumps: Number(parsed.jumps ?? 0),
        reps: optionalNumber(parsed.reps),
        bpm: bpmVal,
        heartRate: bpmVal,
        moving: Boolean(parsed.moving ?? false) && onBody,
        paused: Boolean(parsed.paused ?? false),
        drill: Number(parsed.drill ?? 0),
        completed: parsed.completed === true,
        onBody: onBody,
        load: optionalNumber(parsed.load),
        speed: optionalNumber(parsed.spd),
        cadence: optionalNumber(parsed.cad),
        profile: typeof parsed.prof === 'string' ? (parsed.prof as SensorProfile) : undefined,
        sid: typeof parsed.sid === 'string' && parsed.sid ? parsed.sid : undefined,
      };
      onTelemetry(telemetry);
    } catch {
      // Ignore partial packet parse issues
    }
  };

  const teardownLink = () => {
    if (monitorSub) {
      try {
        monitorSub.remove();
      } catch {}
      monitorSub = null;
    }
    if (disconnectSub) {
      try {
        disconnectSub.remove();
      } catch {}
      disconnectSub = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  const scheduleReconnect = () => {
    if (isCancelled || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectAndSubscribe();
    }, RECONNECT_DELAY_MS);
  };

  const connectAndSubscribe = async () => {
    if (isCancelled || connecting) return;
    connecting = true;
    try {
      if (!device) {
        onStatusChange?.('Connecting to smartwatch sensors…');
        device = await connectToWatchForUnlink(watchNodeId, onStatusChange);
        activeTelemetryDevice = device;
      } else {
        const isConnected = await getBleManager().isDeviceConnected(device.id).catch(() => false);
        if (!isConnected) {
          onStatusChange?.('Reconnecting to smartwatch sensors…');
          device = await connectToWatchForUnlink(watchNodeId || device.id, onStatusChange);
          activeTelemetryDevice = device;
        }
      }

      if (isCancelled) {
        return;
      }

      const linked = device;
      teardownLink();
      onStatusChange?.('Subscribed to live watch sensors');
      handlers?.onConnectionChange?.(true);

      // Out of range / watch closed: drop this link and keep trying to come back
      disconnectSub = getBleManager().onDeviceDisconnected(linked.id, () => {
        if (isCancelled) return;
        teardownLink();
        if (activeTelemetryDevice?.id === linked.id) activeTelemetryDevice = null;
        device = null;
        onStatusChange?.('Watch out of range — reconnecting automatically');
        handlers?.onConnectionChange?.(false);
        scheduleReconnect();
      });

      let lastNotificationTime = 0;

      // 1. Subscribe to GATT notifications
      try {
        monitorSub = linked.monitorCharacteristicForService(
          BLE_SERVICE_UUID,
          LIVE_TELEMETRY_CHAR_UUID,
          (error, characteristic) => {
            if (isCancelled) return;
            if (error) {
              console.warn('Live telemetry notification error:', error.message);
              return;
            }
            if (characteristic?.value) {
              lastNotificationTime = Date.now();
              const jsonStr = base64ToUtf8(characteristic.value);
              handleRawTelemetry(jsonStr);
            }
          }
        );
      } catch (subErr: any) {
        console.warn('Could not monitor telemetry characteristic:', subErr?.message);
      }

      // 2. Initial read + Polling fallback every 1500ms
      try {
        const initialChar = await linked.readCharacteristicForService(
          BLE_SERVICE_UUID,
          LIVE_TELEMETRY_CHAR_UUID
        );
        if (initialChar?.value) {
          handleRawTelemetry(base64ToUtf8(initialChar.value));
        }
      } catch {}

      pollInterval = setInterval(async () => {
        if (isCancelled || !device) return;
        // If active notifications are arriving smoothly (< 2500ms), avoid redundant polling reads
        // to keep the BLE GATT channel dedicated to zero-latency push notifications
        if (Date.now() - lastNotificationTime < 2500) {
          return;
        }
        try {
          const char = await device.readCharacteristicForService(
            BLE_SERVICE_UUID,
            LIVE_TELEMETRY_CHAR_UUID
          );
          if (char?.value) {
            handleRawTelemetry(base64ToUtf8(char.value));
          }
        } catch {
          // Best effort polling fallback
        }
      }, 1500);
    } catch (err: any) {
      console.warn('Watch not reachable, will retry:', err?.message);
      device = null;
      onStatusChange?.('Watch out of range — reconnecting automatically');
      handlers?.onConnectionChange?.(false);
      scheduleReconnect();
    } finally {
      connecting = false;
    }
  };

  connectAndSubscribe();

  return () => {
    isCancelled = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    teardownLink();
    // Only disconnect if session is no longer active
    if (!trackingService.getState().isActive && device) {
      disconnectBleDevice(device.id);
      if (activeTelemetryDevice?.id === device.id) {
        activeTelemetryDevice = null;
      }
    }
  };
}

// Session commands are written one at a time so back-to-back commands
// (e.g. next workout + resume) reach the watch in order.
let commandQueue: Promise<void> = Promise.resolve();

/**
 * Sends a session command (PAUSE, RESUME, END, WORKOUT) to the active watch.
 */
export function sendSessionControlCommand(
  command: string,
  watchNodeId?: string
): Promise<void> {
  commandQueue = commandQueue.then(async () => {
    try {
      let device = activeTelemetryDevice;
      if (!device) {
        device = await connectToWatchForUnlink(watchNodeId);
        activeTelemetryDevice = device;
      }
      await writeCommandToConfirmCharacteristic(device, command);
    } catch (err: any) {
      console.warn(`Failed to send ${command} to watch:`, err?.message);
    }
  });
  return commandQueue;
}

export async function sendSessionPauseToWatch(watchNodeId?: string) {
  return sendSessionControlCommand(SESSION_PAUSE_CMD, watchNodeId);
}

export async function sendSessionResumeToWatch(watchNodeId?: string) {
  return sendSessionControlCommand(SESSION_RESUME_CMD, watchNodeId);
}

export async function sendSessionEndToWatch(watchNodeId?: string) {
  return sendSessionControlCommand(SESSION_END_CMD, watchNodeId);
}

export async function sendSessionNextDrillToWatch(watchNodeId?: string) {
  return sendSessionControlCommand(SESSION_NEXT_DRILL_CMD, watchNodeId);
}

export async function sendSessionRegimeToWatch(
  category: string,
  targetMetrics?: string[],
  watchNodeId?: string
) {
  const metricsStr = targetMetrics && targetMetrics.length > 0 ? `:${targetMetrics.join(',')}` : '';
  const payload = `${SESSION_REGIME_PREFIX}${category}${metricsStr}`;
  return sendSessionControlCommand(payload, watchNodeId);
}

/**
 * Tells the watch which workout is running on the phone. The watch jumps to
 * drill `index` and switches to the sensors for the workout's profile.
 */
export async function sendActiveWorkoutToWatch(
  index: number,
  workout: { name?: string; category?: string; sensorProfile?: SensorProfile },
  targetMetrics: string[],
  watchNodeId?: string
) {
  const payload = `${SESSION_WORKOUT_PREFIX}${JSON.stringify({
    i: index,
    n: workout.name ?? '',
    c: workout.category ?? '',
    p: resolveSensorProfile(workout),
    m: targetMetrics,
  })}`;
  return sendSessionControlCommand(payload, watchNodeId);
}

// ─── Find & Ping Nearby Watch ──────────────────────────────────

export interface PingWatchResult {
  success: boolean;
  rttMs: number;
  rssi?: number;
  watchId: string;
  watchName: string;
}

/**
 * Pings the nearby watch over BLE:
 * 1. Reuses existing active connection or connects directly/via scan.
 * 2. Subscribes to PAIRING_RESPONSE_CHAR_UUID for PONG.
 * 3. Writes 'PING:<timestamp>' to PAIRING_CONFIRM_CHAR_UUID.
 * 4. Measures Round-Trip Time (RTT in ms) and reads device RSSI.
 * 5. Watch physically vibrates and displays a green confirmation on wrist.
 */
export async function pingWatch(
  watchNodeId?: string,
  onStatusUpdate?: (status: string) => void
): Promise<PingWatchResult> {
  onStatusUpdate?.('Connecting to watch for ping test…');

  let device = activeTelemetryDevice;
  const isConnected = device
    ? await getBleManager().isDeviceConnected(device.id).catch(() => false)
    : false;

  if (!isConnected || !device) {
    device = await connectToWatchForUnlink(watchNodeId, onStatusUpdate);
    activeTelemetryDevice = device;
  } else {
    // If device was already connected, verify SmartAthlete service is present
    try {
      await device.discoverAllServicesAndCharacteristics();
      const svcs = await device.services().catch(() => []);
      const hasSmartAthlete = svcs.some(
        (s) => s.uuid.toLowerCase() === BLE_SERVICE_UUID.toLowerCase()
      );
      if (!hasSmartAthlete) {
        console.log(`Active device ${device.id} missing SmartAthlete service. Reconnecting…`);
        device = await connectToWatchForUnlink(watchNodeId, onStatusUpdate);
        activeTelemetryDevice = device;
      }
    } catch (discErr) {
      console.warn('Re-discovery failed on cached device, reconnecting:', discErr);
      device = await connectToWatchForUnlink(watchNodeId, onStatusUpdate);
      activeTelemetryDevice = device;
    }
  }

  if (!device) {
    throw new Error('Unable to establish BLE connection with SmartAthlete watch.');
  }

  onStatusUpdate?.('Sending ping signal to watch…');

  const sUuid = BLE_SERVICE_UUID.toLowerCase();
  const respUuid = PAIRING_RESPONSE_CHAR_UUID.toLowerCase();
  const confirmUuid = PAIRING_CONFIRM_CHAR_UUID.toLowerCase();

  return new Promise<PingWatchResult>((resolve, reject) => {
    let resolved = false;
    let monitorSub: any = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    const sendTime = Date.now();

    const cleanup = () => {
      if (monitorSub) {
        try {
          monitorSub.remove();
        } catch {}
        monitorSub = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    const handlePong = async (valBase64: string) => {
      if (resolved) return;
      const raw = base64ToUtf8(valBase64).trim().toUpperCase();
      if (
        raw.startsWith('PONG') ||
        raw.startsWith('ACCEPTED') ||
        raw.startsWith('CONFIRM')
      ) {
        resolved = true;
        clearTimeout(timeoutId);
        cleanup();

        const rttMs = Date.now() - sendTime;
        let rssi: number | undefined = undefined;
        try {
          const refreshed = await device!.readRSSI();
          rssi = refreshed.rssi ?? undefined;
        } catch {}

        onStatusUpdate?.(`Ping confirmed in ${rttMs}ms!`);
        resolve({
          success: true,
          rttMs,
          rssi,
          watchId: device!.id,
          watchName: device!.name || 'SmartAthlete Watch',
        });
      }
    };

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(
          new Error('Watch ping timed out. Ensure the watch is awake and nearby.')
        );
      }
    }, PING_TIMEOUT_MS);

    // 1. Subscribe to response characteristic for PONG notifications
    try {
      monitorSub = device.monitorCharacteristicForService(
        sUuid,
        respUuid,
        async (error, char) => {
          if (resolved) return;
          if (error) {
            console.warn('Ping monitor error:', error.message);
            return;
          }

          if (char?.value) {
            handlePong(char.value);
          }
        }
      );
    } catch (subErr: any) {
      console.warn('Could not monitor watch responses, relying on active polling:', subErr?.message);
    }

    // 2. Active GATT polling fallback (every 300ms)
    pollInterval = setInterval(async () => {
      if (resolved || !device) return;
      try {
        const char = await device.readCharacteristicForService(sUuid, respUuid);
        if (char?.value) {
          handlePong(char.value);
        }
      } catch {}
    }, 300);

    // 3. Write PING to PAIRING_CONFIRM_CHAR_UUID
    const pingPayload = `${PING_CMD}:${sendTime}`;
    const base64Payload = utf8ToBase64(pingPayload);

    device
      .writeCharacteristicWithResponseForService(
        sUuid,
        confirmUuid,
        base64Payload
      )
      .catch((writeErr) => {
        if (!resolved) {
          // Fallback to writeWithoutResponse
          device
            .writeCharacteristicWithoutResponseForService(
              sUuid,
              confirmUuid,
              base64Payload
            )
            .catch((err2) => {
              console.warn('Ping write fallback error:', err2?.message);
            });
        }
      });
  });
}

/**
 * Scans for any SmartAthlete watch advertising nearby and returns the discovered device.
 */
export async function findNearbyWatch(
  onStatusUpdate?: (msg: string) => void
): Promise<DiscoveredWearDevice | null> {
  const hasPermissions = await requestBluetoothPermissions();
  if (!hasPermissions) {
    throw new Error('Bluetooth permissions were not granted.');
  }
  const isReady = await isBluetoothReady();
  if (!isReady) {
    throw new Error('Bluetooth is off. Please turn on Bluetooth.');
  }

  onStatusUpdate?.('Scanning for nearby SmartAthlete watch…');
  const manager = getBleManager();

  return new Promise<DiscoveredWearDevice | null>((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          manager.stopDeviceScan();
        } catch {}
        resolve(null);
      }
    }, 8000);

    manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (finished) return;
      if (device) {
        const devName = device.name || device.localName || '';
        const hasSvc = device.serviceUUIDs?.some(
          (u) => u.toLowerCase() === BLE_SERVICE_UUID.toLowerCase()
        );
        const isMatch =
          hasSvc ||
          devName === 'SmartAthlete Watch' ||
          devName.toLowerCase().includes('smartathlete');

        if (!isMatch) return;

        finished = true;
        clearTimeout(timer);
        try {
          manager.stopDeviceScan();
        } catch {}
        resolve({
          id: device.id,
          name: devName || 'SmartAthlete Watch',
          rssi: device.rssi,
          rawDevice: device,
        });
      }
    });
  });
}



// ─── Persistent watch link ─────────────────────────────────────
// While an athlete is signed in and the app is open, the phone stays connected to their
// watch and reconnects by itself (out of range, watch app restarted). Messages such as
// the checked-in venue go through an outbox that is delivered whenever the watch is
// connected — even if that's later, or after the app restarts. During a session the live
// telemetry subscription owns the connection and this link just reports it.

export type WatchLinkStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

const WATCH_OUTBOX_KEY = '@smartathlete_watch_outbox_v1';
const LINK_RETRY_MIN_MS = 8_000;
const LINK_RETRY_MAX_MS = 60_000;

let linkNodeId: string | undefined;
let linkEnabled = false;
let linkStatus: WatchLinkStatus = 'idle';
let linkTimer: ReturnType<typeof setTimeout> | null = null;
let linkBusy = false;
let linkFailures = 0;
let linkDisconnectSub: { remove: () => void } | null = null;
const linkListeners = new Set<(s: WatchLinkStatus) => void>();

function setLinkStatus(s: WatchLinkStatus) {
  if (s === linkStatus) return;
  linkStatus = s;
  linkListeners.forEach((l) => l(s));
}

export function getWatchLinkStatus(): WatchLinkStatus {
  return linkStatus;
}

export function subscribeWatchLink(listener: (s: WatchLinkStatus) => void): () => void {
  linkListeners.add(listener);
  listener(linkStatus);
  return () => {
    linkListeners.delete(listener);
  };
}

async function readOutbox(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(WATCH_OUTBOX_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeOutbox(box: Record<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(WATCH_OUTBOX_KEY, JSON.stringify(box));
  } catch {}
}

/** Writes queued messages to the connected watch; each is removed once written. */
async function flushWatchOutbox(): Promise<void> {
  const device = activeTelemetryDevice;
  if (!device) return;
  const box = await readOutbox();
  for (const [key, payload] of Object.entries(box)) {
    try {
      await writeCommandToConfirmCharacteristic(device, payload);
      const latest = await readOutbox();
      if (latest[key] === payload) {
        delete latest[key];
        await writeOutbox(latest);
      }
    } catch {
      return; // connection dropped: the rest waits for the next connection
    }
  }
}

/**
 * Queues a message for the watch; the newest message per `key` wins. Delivered right away
 * when connected, otherwise as soon as the watch connects.
 */
export async function queueForWatch(key: string, payload: string): Promise<void> {
  const box = await readOutbox();
  box[key] = payload;
  await writeOutbox(box);
  if (activeTelemetryDevice) {
    const connected = await getBleManager().isDeviceConnected(activeTelemetryDevice.id).catch(() => false);
    if (connected) await flushWatchOutbox();
  }
}

function watchForDisconnect(device: Device) {
  linkDisconnectSub?.remove();
  linkDisconnectSub = getBleManager().onDeviceDisconnected(device.id, () => {
    if (activeTelemetryDevice?.id === device.id) activeTelemetryDevice = null;
    stopLinkMonitor();
    setLinkStatus('disconnected');
    linkFailures = 0;
    scheduleLinkTick(LINK_RETRY_MIN_MS);
  });
}

function scheduleLinkTick(delay: number) {
  if (!linkEnabled) return;
  if (linkTimer) clearTimeout(linkTimer);
  linkTimer = setTimeout(() => {
    linkTimer = null;
    linkTick();
  }, delay);
}

async function linkTick() {
  if (!linkEnabled || linkBusy) return;
  linkBusy = true;
  try {
    // Already connected (by this link or by a session)?
    const current = activeTelemetryDevice;
    if (current && (await getBleManager().isDeviceConnected(current.id).catch(() => false))) {
      linkFailures = 0;
      setLinkStatus('connected');
      watchForDisconnect(current);
      monitorLinkMessages(current);
      await flushWatchOutbox();
      scheduleLinkTick(LINK_RETRY_MAX_MS); // periodic health check
      return;
    }
    // During a session the telemetry subscription reconnects on its own
    if (trackingService.getState().isActive) {
      setLinkStatus('disconnected');
      scheduleLinkTick(LINK_RETRY_MIN_MS);
      return;
    }
    setLinkStatus('connecting');
    const device = await connectToWatchForUnlink(linkNodeId);
    if (!linkEnabled) return;
    activeTelemetryDevice = device;
    linkFailures = 0;
    setLinkStatus('connected');
    watchForDisconnect(device);
    monitorLinkMessages(device);
    await flushWatchOutbox();
    scheduleLinkTick(LINK_RETRY_MAX_MS);
  } catch {
    setLinkStatus('disconnected');
    // Watch away: retry soon, then less often to spare the battery
    linkFailures += 1;
    scheduleLinkTick(Math.min(LINK_RETRY_MAX_MS, LINK_RETRY_MIN_MS * 2 ** (linkFailures - 1)));
  } finally {
    linkBusy = false;
  }
}

/** Keep the phone connected to this watch (call when the app is in the foreground). */
export function startWatchLink(watchNodeId: string | undefined) {
  linkNodeId = watchNodeId;
  linkEnabled = true;
  linkFailures = 0;
  scheduleLinkTick(0);
}

/** Stop reconnecting (app in the background, signed out, or watch unlinked). */
export function stopWatchLink() {
  linkEnabled = false;
  stopLinkMonitor();
  if (linkTimer) {
    clearTimeout(linkTimer);
    linkTimer = null;
  }
  setLinkStatus('idle');
}

// ─── Unlink started on the watch ───────────────────────────────
// The watch's own Unlink button asks the phone ("unlink_request"), or — when it unlinked
// while the phone was away — tells it afterwards ("unlinked"). Both arrive as messages on
// the telemetry characteristic, which the persistent link listens to outside sessions.

export type WatchUnlinkEvent = { type: 'request'; name?: string } | { type: 'unlinked' };

const unlinkListeners = new Set<(e: WatchUnlinkEvent) => void>();
let linkMonitorSub: { remove: () => void } | null = null;
let lastUnlinkEventAt = 0;

export function subscribeWatchUnlinkEvents(listener: (e: WatchUnlinkEvent) => void): () => void {
  unlinkListeners.add(listener);
  return () => {
    unlinkListeners.delete(listener);
  };
}

function stopLinkMonitor() {
  try {
    linkMonitorSub?.remove();
  } catch {}
  linkMonitorSub = null;
}

/** Listen for watch messages while connected outside a session. */
function monitorLinkMessages(device: Device) {
  // During a session the telemetry subscription owns this characteristic
  if (trackingService.getState().isActive) {
    stopLinkMonitor();
    return;
  }
  if (linkMonitorSub) return;
  try {
    linkMonitorSub = device.monitorCharacteristicForService(
      BLE_SERVICE_UUID,
      LIVE_TELEMETRY_CHAR_UUID,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        try {
          const p = JSON.parse(base64ToUtf8(characteristic.value));
          // The watch repeats some messages; one prompt at a time is enough
          if ((p?.t === 'unlink_request' || p?.t === 'unlinked') && Date.now() - lastUnlinkEventAt > 15_000) {
            lastUnlinkEventAt = Date.now();
            const event: WatchUnlinkEvent =
              p.t === 'unlink_request' ? { type: 'request', name: p.name } : { type: 'unlinked' };
            unlinkListeners.forEach((l) => l(event));
          }
        } catch {}
      }
    );
  } catch {
    linkMonitorSub = null;
  }
}

async function writeToLinkedWatch(payload: string): Promise<boolean> {
  const device = activeTelemetryDevice;
  if (!device) return false;
  try {
    await writeCommandToConfirmCharacteristic(device, payload);
    return true;
  } catch {
    return false;
  }
}

/** Answer the watch's unlink request (from its own Unlink button). */
export function replyToWatchUnlink(confirmed: boolean): Promise<boolean> {
  return writeToLinkedWatch(confirmed ? 'UNLINK_CONFIRMED' : 'UNLINK_DECLINED');
}

/** Tell the watch the phone handled its "unlinked while you were away" notice. */
export function ackWatchUnlinkNotice(): Promise<boolean> {
  return writeToLinkedWatch('UNLINK_NOTICE_ACK');
}
