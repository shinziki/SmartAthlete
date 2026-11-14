/**
 * SmartAthlete Watch Sensor Profiles
 *
 * Each drill type runs on exactly one sensor profile. The phone sends the
 * profile to the watch (WORKOUT command) and the watch switches its sensors to
 * the ones that measure that kind of movement accurately.
 *
 * Keep the keys in sync with SensorProfile.kt in the Wear OS app.
 */

import { DrillCategory, normalizeCategory } from './regimes';

export type SensorProfile = 'run' | 'lateral' | 'reps' | 'jump' | 'recovery' | 'stationary' | 'game';

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
    sensors: 'Step counter · cadence & speed · heart rate',
  },
  lateral: {
    key: 'lateral',
    label: 'Lateral',
    icon: 'arrow-left-right',
    sensors: 'Accelerometer slide steps · heart rate · load',
  },
  reps: {
    key: 'reps',
    label: 'Reps',
    icon: 'counter',
    sensors: 'Accelerometer rep counter · heart rate · load (steps off)',
  },
  jump: {
    key: 'jump',
    label: 'Jumping',
    icon: 'human-male-height',
    sensors: 'Accelerometer jump detection · heart rate · load',
  },
  recovery: {
    key: 'recovery',
    label: 'Recovery',
    icon: 'heart-pulse',
    sensors: 'Heart-rate recovery · step counter',
  },
  // Not used by a drill type; kept so older sessions and watch builds still resolve
  stationary: {
    key: 'stationary',
    label: 'Stationary',
    icon: 'human',
    sensors: 'Heart rate · load (steps off)',
  },
  game: {
    key: 'game',
    label: 'Mixed',
    icon: 'run',
    sensors: 'Step counter · jump detection · heart rate · load',
  },
};

/** The watch sensors each drill type runs on. */
export const CATEGORY_SENSOR_PROFILE: Record<DrillCategory, SensorProfile> = {
  'Warm-up': 'run',
  Running: 'run',
  Strength: 'reps',
  Jumping: 'jump',
  Agility: 'lateral',
  'Cool-down': 'recovery',
};

/**
 * Resolves which watch sensor profile a drill needs: an explicit profile if the
 * drill carries one, otherwise the profile of its drill type.
 */
export function resolveSensorProfile(drill?: {
  name?: string;
  category?: DrillCategory | string;
  sensorProfile?: SensorProfile;
} | null): SensorProfile {
  if (drill?.sensorProfile && SENSOR_PROFILES[drill.sensorProfile]) {
    return drill.sensorProfile;
  }
  return CATEGORY_SENSOR_PROFILE[normalizeCategory(drill?.category)];
}
