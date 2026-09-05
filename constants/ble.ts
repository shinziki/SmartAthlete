/**
 * SmartAthlete BLE Constants
 *
 * Shared Bluetooth Low Energy UUIDs and configuration.
 * Both the React Native Mobile App and the Android Wear OS app
 * use these exact UUIDs for GATT service discovery and pairing.
 */

// ─── Custom BLE Service UUID ────────────────────────────────────
// The Wear OS app advertises this GATT service so the phone can discover it.
export const BLE_SERVICE_UUID = '0000FFAA-0000-1000-8000-00805F9B34FB';

// ─── BLE Characteristic UUIDs ───────────────────────────────────
// Readable characteristic: UTF-8 device name (e.g. "SmartAthlete Watch")
export const DEVICE_NAME_CHAR_UUID = '0000FFB1-0000-1000-8000-00805F9B34FB';

// Readable characteristic: UTF-8 6-digit pairing code (e.g. "849215")
export const PAIRING_CODE_CHAR_UUID = '0000FFB2-0000-1000-8000-00805F9B34FB';

// Writable characteristic: UTF-8 confirmation ("CONFIRMED")
// Written by the phone after the athlete confirms pairing.
export const PAIRING_CONFIRM_CHAR_UUID = '0000FFB3-0000-1000-8000-00805F9B34FB';

// ─── Configuration Constants ───────────────────────────────────
export const SCAN_TIMEOUT_MS = 15_000;
export const CONNECTION_TIMEOUT_MS = 10_000;
export const PAIRING_CONFIRM_VALUE = 'CONFIRMED';
