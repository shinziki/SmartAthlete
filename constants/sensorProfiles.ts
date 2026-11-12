/**
 * SmartAthlete Watch Sensor Profiles
 *
 * Each workout running on the phone is resolved to a sensor profile. The phone
 * sends the profile to the watch (WORKOUT command) and the watch switches its
 * sensors to the ones that measure that kind of movement accurately.
 *
 * Keep the keys in sync with SensorProfile.kt in the Wear OS app.
 */

import { DrillCategory } from './regimes';

export type SensorProfile = 'run' | 'lateral' | 'stationary' | 'jump' | 'game' | 'recovery';

export interface SensorProfileInfo {
  key: SensorProfile;
  label: string;
  icon: string;
  /** Watch sensors used while this profile is active */
  sensors: string;
}

export const SENSOR_PROFILES: Record<SensorProfile, SensorProfileInfo> = {
  run: {
    key: 'run',
    label: 'Running',
    icon: 'run-fast',
    sensors: 'Step counter · cadence stride · HR · accelerometer load',
  },
  lateral: {
    key: 'lateral',
    label: 'Lateral',
    icon: 'arrow-left-right',
    sensors: 'Accelerometer slide steps · HR · accelerometer load',
  },
  stationary: {
    key: 'stationary',
    label: 'Stationary',
    icon: 'basketball',
    sensors: 'HR · accelerometer load (steps off to ignore arm motion)',
  },
  jump: {
    key: 'jump',
    label: 'Jumping',
    icon: 'human-male-height',
    sensors: 'Accelerometer jump detection · step counter · HR',
  },
  game: {
    key: 'game',
    label: 'Game play',
    icon: 'whistle',
    sensors: 'Step counter · jump detection · HR · accelerometer load',
  },
  recovery: {
    key: 'recovery',
    label: 'Recovery',
    icon: 'heart-pulse',
    sensors: 'HR recovery · step counter',
  },
};

const CATEGORY_DEFAULT_PROFILE: Record<DrillCategory, SensorProfile> = {
  'Warm-up': 'run',
  Tactics: 'game',
  Conditioning: 'run',
  Scrimmage: 'game',
  'Cool-down': 'recovery',
};

/** Ordered: the first matching rule wins, so specific movements beat generic words. */
const NAME_RULES: [RegExp, SensorProfile][] = [
  [/plyo|pogo|hop|jump|rebound|box/i, 'jump'],
  [/slide|shuffle/i, 'lateral'],
  [/static|foam|breath|ball handling|dribbl|free throw|shoot|debrief|hydrate|stationary/i, 'stationary'],
  [/walk|cool/i, 'recovery'],
  [/sprint|suicide|jog|run|17s|lap|dynamic|layup|pass and move/i, 'run'],
  [/scrimmage|\d-on-\d|game|shell|closeout|stops|pick-and-roll|drive|transition|dominoes|reaction/i, 'game'],
];

/**
 * Resolves which watch sensor profile a workout needs, from an explicit
 * profile, the workout name, or the drill category (in that order).
 */
export function resolveSensorProfile(drill?: {
  name?: string;
  category?: DrillCategory | string;
  sensorProfile?: SensorProfile;
} | null): SensorProfile {
  if (drill?.sensorProfile && SENSOR_PROFILES[drill.sensorProfile]) {
    return drill.sensorProfile;
  }
  const name = drill?.name ?? '';
  for (const [pattern, profile] of NAME_RULES) {
    if (pattern.test(name)) return profile;
  }
  return CATEGORY_DEFAULT_PROFILE[drill?.category as DrillCategory] ?? 'game';
}
