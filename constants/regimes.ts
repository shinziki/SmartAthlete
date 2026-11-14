/**
 * SmartAthlete Training Regime & Specific Sensor Reading Definitions
 *
 * Defines the mapping between each training regime (drill category) and the
 * specific sensor readings (telemetry channels) that are actively monitored.
 */

export type DrillCategory =
  | 'Warm-up'
  | 'Running'
  | 'Strength'
  | 'Jumping'
  | 'Agility'
  | 'Cool-down';

export const DRILL_CATEGORIES: DrillCategory[] = [
  'Warm-up',
  'Running',
  'Strength',
  'Jumping',
  'Agility',
  'Cool-down',
];

/** Drill types used before the drills were simplified, for sessions saved back then. */
const LEGACY_CATEGORIES: Record<string, DrillCategory> = {
  Tactics: 'Agility',
  Conditioning: 'Running',
  Scrimmage: 'Running',
};

/** Maps any stored drill type (including old ones) to a current one. */
export function normalizeCategory(category?: string | null): DrillCategory {
  if (category && (DRILL_CATEGORIES as string[]).includes(category)) {
    return category as DrillCategory;
  }
  return (category && LEGACY_CATEGORIES[category]) || 'Running';
}

export type MetricType =
  | 'heartRate'
  | 'steps'
  | 'distance'
  | 'jumps'
  | 'reps'
  | 'playerLoad'
  | 'speed'
  | 'recovery';

export interface MetricDefinition {
  key: MetricType;
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  bgColor: string;
  unit: string;
  description: string;
}

export const METRIC_DEFINITIONS: Record<MetricType, MetricDefinition> = {
  heartRate: {
    key: 'heartRate',
    label: 'Heart Rate',
    shortLabel: 'HR',
    icon: 'heart-pulse',
    color: '#E53935',
    bgColor: '#FFEBEE',
    unit: 'BPM',
    description: 'Real-time PPG heart rate & intensity zone',
  },
  steps: {
    key: 'steps',
    label: 'Tracked Steps',
    shortLabel: 'STEPS',
    icon: 'shoe-print',
    color: '#2E7D32',
    bgColor: '#E8F5E9',
    unit: 'steps',
    description: 'Accumulated foot strikes and cadence rate',
  },
  distance: {
    key: 'distance',
    label: 'Distance Covered',
    shortLabel: 'DISTANCE',
    icon: 'map-marker-distance',
    color: '#0284C7',
    bgColor: '#E0F2FE',
    unit: 'm',
    description: 'Ground meters covered from IMU stride estimation',
  },
  jumps: {
    key: 'jumps',
    label: 'Vertical Jumps',
    shortLabel: 'JUMPS',
    icon: 'human-male-height',
    color: '#8E24AA',
    bgColor: '#F3E5F5',
    unit: 'jumps',
    description: 'Vertical takeoff events detected by IMU acceleration',
  },
  reps: {
    key: 'reps',
    label: 'Repetitions',
    shortLabel: 'REPS',
    icon: 'counter',
    color: '#C2410C',
    bgColor: '#FFEDD5',
    unit: 'reps',
    description: 'Repetitions counted from the wrist accelerometer',
  },
  playerLoad: {
    key: 'playerLoad',
    label: 'Player Load',
    shortLabel: 'LOAD',
    icon: 'lightning-bolt',
    color: '#F59E0B',
    bgColor: '#FEF3C7',
    unit: 'AU',
    description: 'Tri-axial biomechanical load accumulation score',
  },
  speed: {
    key: 'speed',
    label: 'Speed / Pace',
    shortLabel: 'PACE',
    icon: 'speedometer',
    color: '#2563EB',
    bgColor: '#EFF6FF',
    unit: 'km/h',
    description: 'Current running speed and ground velocity',
  },
  recovery: {
    key: 'recovery',
    label: 'HR Recovery',
    shortLabel: 'HRR DROP',
    icon: 'arrow-down-bold-circle-outline',
    color: '#00838F',
    bgColor: '#E0F7FA',
    unit: 'BPM drop',
    description: 'Rate of heart rate deceleration post-exercise',
  },
};

export const REGIME_DEFAULT_METRICS: Record<DrillCategory, MetricType[]> = {
  'Warm-up': ['steps', 'heartRate'],
  Running: ['distance', 'speed', 'heartRate'],
  Strength: ['reps', 'heartRate', 'playerLoad'],
  Jumping: ['jumps', 'heartRate', 'playerLoad'],
  Agility: ['steps', 'distance', 'playerLoad'],
  'Cool-down': ['recovery', 'heartRate'],
};

export interface RegimeGuide {
  title: string;
  primaryReadingLabel: string;
  targetGuidance: string;
  badgeColor: string;
  badgeBg: string;
  icon: string;
}

export const REGIME_GUIDES: Record<DrillCategory, RegimeGuide> = {
  'Warm-up': {
    title: 'Warm-up',
    primaryReadingLabel: 'Steps & Heart Rate Ramp',
    targetGuidance: 'Raise your heart rate gradually into Zone 1–2 (100–135 BPM) with a steady step rhythm.',
    badgeColor: '#E65100',
    badgeBg: '#FFE0B2',
    icon: 'fire',
  },
  Running: {
    title: 'Running',
    primaryReadingLabel: 'Distance & Pace',
    targetGuidance: 'Swing your watch arm naturally so every step is counted. Hold the pace the drill asks for.',
    badgeColor: '#2E7D32',
    badgeBg: '#C8E6C9',
    icon: 'run-fast',
  },
  Strength: {
    title: 'Strength',
    primaryReadingLabel: 'Repetitions',
    targetGuidance: 'Use full, even reps at a steady rhythm so the watch can count each one.',
    badgeColor: '#C2410C',
    badgeBg: '#FFEDD5',
    icon: 'arm-flex',
  },
  Jumping: {
    title: 'Jumping',
    primaryReadingLabel: 'Jump Count',
    targetGuidance: 'Leave the ground fully on every jump and land softly. Reset between jumps.',
    badgeColor: '#6A1B9A',
    badgeBg: '#E1BEE7',
    icon: 'human-male-height',
  },
  Agility: {
    title: 'Agility',
    primaryReadingLabel: 'Slide Steps & Load',
    targetGuidance: 'Stay low and push off sideways. Slide steps are counted from the wrist accelerometer.',
    badgeColor: '#1565C0',
    badgeBg: '#BBDEFB',
    icon: 'arrow-left-right',
  },
  'Cool-down': {
    title: 'Cool-down & Recovery',
    primaryReadingLabel: 'Heart Rate Recovery (HRR)',
    targetGuidance: 'Let your heart rate come down. Aim for a drop of more than 20 BPM within 2 minutes.',
    badgeColor: '#00838F',
    badgeBg: '#B2EBF2',
    icon: 'weather-windy',
  },
};

/**
 * Resolves the active target metrics for a drill.
 * Uses explicit targetMetrics if present, otherwise falls back to the category default.
 */
export function getDrillTargetMetrics(drill?: {
  category?: DrillCategory | string;
  targetMetrics?: MetricType[];
} | null): MetricType[] {
  if (!drill) {
    return ['heartRate', 'steps', 'distance', 'playerLoad'];
  }
  // Sessions saved with an old drill type follow the readings of the type it maps to
  const known = (DRILL_CATEGORIES as string[]).includes(String(drill.category));
  if (known && drill.targetMetrics && drill.targetMetrics.length > 0) {
    return drill.targetMetrics;
  }
  return REGIME_DEFAULT_METRICS[normalizeCategory(drill.category)];
}
