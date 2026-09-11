/**
 * SmartAthlete BLE Manager
 *
 * Full BLE client for scanning, connecting, reading the pairing code,
 * and sending confirmation to the Wear OS GATT server.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, State } from 'react-native-ble-plx';
import {
  BLE_SERVICE_UUID,
  CONNECTION_TIMEOUT_MS,
  DEVICE_NAME_CHAR_UUID,
  PAIRING_ACCEPTED,
  PAIRING_CODE_CHAR_UUID,
  PAIRING_CONFIRM_CHAR_UUID,
  PAIRING_CONFIRM_VALUE,
  PAIRING_DECLINED,
  PAIRING_RESPONSE_CHAR_UUID,
  SCAN_TIMEOUT_MS,
  UNLINK_PREFIX,
  UNLINK_REQUEST_VALUE,
  WATCH_RESPONSE_TIMEOUT_MS,
} from '@/constants/ble';

let bleManagerInstance: BleManager | null = null;

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

  return {
    connectedDevice,
    pairingCode,
    deviceName,
  };
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
  clientLabel: string = 'Athlete App'
): Promise<void> {
  const payload = clientLabel ? `${PAIRING_CONFIRM_VALUE}:${clientLabel}` : PAIRING_CONFIRM_VALUE;
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
): Promise<'ACCEPTED' | 'DECLINED'> {
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
        const connectedList = await manager.connectedDevices([BLE_SERVICE_UUID]);
        const found = connectedList.find((d) => d.id === watchNodeId);
        device = found || (await manager.connectToDevice(watchNodeId!));
      } else {
        device = await Promise.race([
          manager.connectToDevice(watchNodeId!),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Direct connection timeout')), 6000)
          ),
        ]);
      }
      await device.discoverAllServicesAndCharacteristics();
      if (Platform.OS === 'android') {
        try {
          await device.requestMTU(512);
        } catch {}
      }
      return device;
    } catch (directErr) {
      console.log('Direct connection failed, scanning for watch nearby:', directErr);
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
      [BLE_SERVICE_UUID],
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
          if (isDirectId && scannedDevice.id !== watchNodeId) {
            return;
          }

          resolved = true;
          cleanup();
          onStatusUpdate?.(`Found ${scannedDevice.name || 'watch'}! Connecting…`);

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
            resolve(connectedDevice);
          } catch (connErr: any) {
            reject(new Error(connErr.message || 'Failed to connect to watch.'));
          }
        }
      }
    );
  });
}

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
    return result;
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
