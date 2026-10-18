/**
 * SmartAthlete Training Regime & Specific Sensor Reading Definitions
 *
 * Defines the mapping between each training regime (drill category) and the
 * specific sensor readings (telemetry channels) that are actively monitored.
 */

export type DrillCategory =
  | 'Warm-up'
  | 'Tactics'
  | 'Conditioning'
  | 'Scrimmage'
  | 'Cool-down';

export type MetricType =
  | 'heartRate'
  | 'steps'
  | 'distance'
  | 'jumps'
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
  'Warm-up': ['heartRate', 'steps'],
  Tactics: ['distance', 'playerLoad'],
  Conditioning: ['heartRate', 'speed', 'playerLoad'],
  Scrimmage: ['jumps', 'playerLoad', 'distance'],
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
    title: 'Warm-up / Activation',
    primaryReadingLabel: 'Heart Rate Ramp & Cadence',
    targetGuidance: 'Gradually elevate HR into Zone 1–2 (100–135 BPM) with steady cadence.',
    badgeColor: '#E65100',
    badgeBg: '#FFE0B2',
    icon: 'fire',
  },
  Tactics: {
    title: 'Tactics & Positioning',
    primaryReadingLabel: 'Court Distance & Low-Fatigue Load',
    targetGuidance: 'Focus on court coverage and positioning while keeping explosive fatigue low.',
    badgeColor: '#1565C0',
    badgeBg: '#BBDEFB',
    icon: 'basketball',
  },
  Conditioning: {
    title: 'Conditioning / High Intensity',
    primaryReadingLabel: 'Anaerobic Output & Pace',
    targetGuidance: 'Push into Zone 4–5 Anaerobic (> 160 BPM) and sustain high ground speed.',
    badgeColor: '#2E7D32',
    badgeBg: '#C8E6C9',
    icon: 'lightning-bolt',
  },
  Scrimmage: {
    title: 'Scrimmage / Match Play',
    primaryReadingLabel: 'Jump Contests & Game Intensity Load',
    targetGuidance: 'Track explosive jump contests, sprint transitions, and competitive match load.',
    badgeColor: '#6A1B9A',
    badgeBg: '#E1BEE7',
    icon: 'whistle',
  },
  'Cool-down': {
    title: 'Cool-down & Recovery',
    primaryReadingLabel: 'Heart Rate Recovery (HRR)',
    targetGuidance: 'Facilitate parasympathetic recovery. Aim for > 20 BPM drop within 2 minutes.',
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
  if (drill.targetMetrics && drill.targetMetrics.length > 0) {
    return drill.targetMetrics;
  }
  const category = (drill.category as DrillCategory) || 'Tactics';
  return REGIME_DEFAULT_METRICS[category] || ['heartRate', 'steps'];
}
