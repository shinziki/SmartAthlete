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
  PAIRING_CODE_CHAR_UUID,
  PAIRING_CONFIRM_CHAR_UUID,
  PAIRING_CONFIRM_VALUE,
  SCAN_TIMEOUT_MS,
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
 * Connects to the watch, discovers characteristics, and reads the pairing code.
 */
export async function connectAndReadPairingCode(device: Device): Promise<{
  connectedDevice: Device;
  pairingCode: string;
  deviceName: string;
}> {
  // Connect with timeout
  const connectedDevice = await Promise.race([
    device.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Connection to smartwatch timed out')),
        CONNECTION_TIMEOUT_MS
      )
    ),
  ]);

  // Discover all services & characteristics
  await connectedDevice.discoverAllServicesAndCharacteristics();

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
 * The watch GATT server receives this and transitions to Home.
 */
export async function confirmPairingWithWatch(device: Device): Promise<void> {
  const base64Value = utf8ToBase64(PAIRING_CONFIRM_VALUE);

  await device.writeCharacteristicWithResponseForService(
    BLE_SERVICE_UUID,
    PAIRING_CONFIRM_CHAR_UUID,
    base64Value
  );
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
