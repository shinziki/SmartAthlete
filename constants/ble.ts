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

// Notify characteristic: UTF-8 response ("ACCEPTED" / "DECLINED")
// The watch sends this back after the watch user accepts or declines the link.
export const PAIRING_RESPONSE_CHAR_UUID = '0000FFB4-0000-1000-8000-00805F9B34FB';

// Read + Notify characteristic: JSON live telemetry packet from watch
// e.g. {"secs": 15, "steps": 24, "meters": 18.7, "jumps": 1, "bpm": 128, "moving": true, "paused": false, "drill": 0}
export const LIVE_TELEMETRY_CHAR_UUID = '0000FFB5-0000-1000-8000-00805F9B34FB';

// ─── Configuration Constants ───────────────────────────────────
export const SCAN_TIMEOUT_MS = 15_000;
export const CONNECTION_TIMEOUT_MS = 10_000;
export const PAIRING_CONFIRM_VALUE = 'CONFIRMED';
export const PAIRING_ACCEPTED = 'ACCEPTED';
export const PAIRING_DECLINED = 'DECLINED';
export const WATCH_RESPONSE_TIMEOUT_MS = 60_000;
export const UNLINK_REQUEST_VALUE = 'UNLINK';
export const UNLINK_PREFIX = 'UNLINK:';

// ─── Session Control Commands ─────────────────────────────────
export const SESSION_PAUSE_CMD = 'PAUSE_SESSION';
export const SESSION_RESUME_CMD = 'RESUME_SESSION';
export const SESSION_END_CMD = 'END_SESSION';
export const SESSION_NEXT_DRILL_CMD = 'NEXT_DRILL';

// ─── Ping / Connection Test Commands ───────────────────────────
export const PING_CMD = 'PING';
export const PONG_RESP = 'PONG';
export const PING_TIMEOUT_MS = 3_500;

