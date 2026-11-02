/**
 * Training-load formulas (manuscript §3.10.4 – §3.10.5).
 *
 *  Session Load (AU) = RPE (CR-10) × T (session duration, minutes)       [CS-07]
 *  Acute Load        = (1/7)  × Σ Lᵢ over the last 7 days                [CS-09]
 *  Chronic Load      = (1/28) × Σ Lᵢ over the last 28 days               [CS-10]
 *  ACWR              = Acute Load ÷ Chronic Load
 *
 * Lᵢ is the daily Session Load (sum of that day's sessions), 0 on rest days.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const ACUTE_DAYS = 7;
export const CHRONIC_DAYS = 28;

export type AcwrZoneKey = 'undertraining' | 'optimal' | 'elevated' | 'high';

export interface AcwrZone {
  key: AcwrZoneKey;
  label: string;
  color: string;
}

/** CR-10 RPE scale labels (0–10). */
export const RPE_LABELS: Record<number, string> = {
  0: 'Rest',
  1: 'Very easy',
  2: 'Easy',
  3: 'Moderate',
  4: 'Somewhat hard',
  5: 'Hard',
  6: 'Hard+',
  7: 'Very hard',
  8: 'Very hard+',
  9: 'Extremely hard',
  10: 'Maximal',
};

export function clampRpe(rpe: number): number {
  if (!Number.isFinite(rpe)) return 0;
  return Math.min(10, Math.max(0, rpe));
}

/** Session Load (AU) = RPE × duration in minutes. e.g. RPE 6 × 90 min = 540 AU. */
export function computeSessionLoadAU(rpe: number, durationMinutes: number): number {
  const t = Number.isFinite(durationMinutes) ? Math.max(0, durationMinutes) : 0;
  return Math.round(clampRpe(rpe) * t * 10) / 10;
}

export interface LoadEntry {
  /** ISO timestamp (or anything Date can parse) the session was completed */
  completedAt: string;
  /** Session Load in AU */
  load: number;
}

export interface WorkloadResult {
  /** Σ Lᵢ over the last 7 days */
  acuteTotal: number;
  /** Σ Lᵢ over the last 28 days */
  chronicTotal: number;
  /** (1/7) × Σ Lᵢ */
  acuteLoad: number;
  /** (1/28) × Σ Lᵢ */
  chronicLoad: number;
  /** Acute ÷ Chronic, null when chronic load is 0 */
  acwr: number | null;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Daily Session Loads for the last `days` days; index 0 = today, missing days = 0. */
export function buildDailyLoads(
  entries: LoadEntry[],
  days: number = CHRONIC_DAYS,
  now: number = Date.now()
): number[] {
  const daily = new Array<number>(days).fill(0);
  const today = startOfDay(now);
  for (const e of entries) {
    const t = new Date(e.completedAt).getTime();
    if (isNaN(t)) continue;
    const ago = Math.round((today - startOfDay(t)) / DAY_MS);
    if (ago >= 0 && ago < days) daily[ago] += e.load || 0;
  }
  return daily;
}

export function computeWorkload(entries: LoadEntry[], now: number = Date.now()): WorkloadResult {
  const daily = buildDailyLoads(entries, CHRONIC_DAYS, now);
  const acuteTotal = daily.slice(0, ACUTE_DAYS).reduce((a, b) => a + b, 0);
  const chronicTotal = daily.reduce((a, b) => a + b, 0);
  const acuteLoad = acuteTotal / ACUTE_DAYS;
  const chronicLoad = chronicTotal / CHRONIC_DAYS;
  return {
    acuteTotal,
    chronicTotal,
    acuteLoad,
    chronicLoad,
    acwr: chronicLoad > 0 ? acuteLoad / chronicLoad : null,
  };
}

/** Table 3.4 interpretation zones. */
export function getAcwrZone(acwr: number | null): AcwrZone {
  if (acwr === null) return { key: 'optimal', label: 'No data', color: '#9E9E9E' };
  if (acwr < 0.8) return { key: 'undertraining', label: 'Undertraining / detraining', color: '#2196F3' };
  if (acwr <= 1.3) return { key: 'optimal', label: 'Optimal loading', color: '#10B981' };
  if (acwr <= 1.5) return { key: 'elevated', label: 'Elevated load', color: '#F59E0B' };
  return { key: 'high', label: 'High load', color: '#EF4444' };
}
