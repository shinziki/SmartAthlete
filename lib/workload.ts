/**
 * Training-load formulas (manuscript §3.10.4 – §3.10.5).
 *
 *  Session Load (AU) = RPE (CR-10) × T (session duration, minutes)       [CS-07]
 *  Acute Load        = (1/7)  × Σ Lᵢ over the last 7 days                [CS-09]
 *  Chronic Load      = (1/28) × Σ Lᵢ over the last 28 days               [CS-10]
 *  ACWR              = Acute Load ÷ Chronic Load
 *
 * Lᵢ is the daily Session Load (sum of that day's sessions), 0 on rest days.
 *
 * ACWR needs a full chronic window: it is only reported once 28 calendar days have
 * passed since the athlete's first recorded session (rest days included). Before that
 * the 28-day window is mostly days before the athlete started, which deflates the chronic
 * load and inflates the ratio (a brand-new athlete would always read ~4.0).
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

// ─── Session intensity ───────────────────────────────────────

export type IntensityKey = 'low' | 'moderate' | 'high' | 'very_high';

export interface SessionIntensity {
  key: IntensityKey;
  label: string;
  color: string;
  /** What the level is based on, e.g. "RPE 6 · Hard+" or "Avg HR 152 bpm" */
  detail: string;
}

const INTENSITY: Record<IntensityKey, { label: string; color: string }> = {
  low: { label: 'Low', color: '#22C55E' },
  moderate: { label: 'Moderate', color: '#EAB308' },
  high: { label: 'High', color: '#F97316' },
  very_high: { label: 'Very high', color: '#EF4444' },
};

/**
 * How hard one session was. Uses the athlete's session RPE (CR-10) when given — the
 * standard measure of perceived intensity — otherwise falls back to average heart rate.
 * Returns null when neither is available.
 */
export function getSessionIntensity(session: {
  sessionRpe?: number | null;
  avgHeartRate?: number | null;
}): SessionIntensity | null {
  const rpe = session.sessionRpe;
  if (rpe != null && !isNaN(rpe)) {
    const r = clampRpe(Math.round(rpe));
    const key: IntensityKey = r <= 2 ? 'low' : r <= 4 ? 'moderate' : r <= 6 ? 'high' : 'very_high';
    return { key, ...INTENSITY[key], detail: `RPE ${r} · ${RPE_LABELS[r]}` };
  }
  const hr = session.avgHeartRate ?? 0;
  if (hr > 30) {
    const key: IntensityKey = hr < 120 ? 'low' : hr < 145 ? 'moderate' : hr < 165 ? 'high' : 'very_high';
    return { key, ...INTENSITY[key], detail: `Avg HR ${Math.round(hr)} bpm` };
  }
  return null;
}

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
  /** Acute ÷ Chronic; null until the 28-day baseline is complete or when chronic load is 0 */
  acwr: number | null;
  /** Days of history so far, counting from the first session (capped at 28) */
  baselineDays: number;
  /** 28 days have passed since the first session, so ACWR is meaningful */
  baselineComplete: boolean;
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

/**
 * Days of training history at `now`, counting the first session's day as day 1 and every
 * calendar day after it (rest days too). 0 if there is no session yet.
 */
export function historyDays(firstSessionAt: string | number | null | undefined, now: number = Date.now()): number {
  if (firstSessionAt == null) return 0;
  const first = new Date(firstSessionAt).getTime();
  if (isNaN(first) || first > now) return 0;
  return Math.round((startOfDay(now) - startOfDay(first)) / DAY_MS) + 1;
}

/** Earliest completedAt among the entries (ISO string), or null. */
export function firstSessionAt(entries: LoadEntry[]): string | null {
  let best: number | null = null;
  for (const e of entries) {
    const t = new Date(e.completedAt).getTime();
    if (!isNaN(t) && (best === null || t < best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/**
 * Workload at `now`. `historyStart` is the athlete's first session ever; pass it when
 * `entries` only covers recent weeks. By default the earliest entry is used.
 */
export function computeWorkload(
  entries: LoadEntry[],
  now: number = Date.now(),
  historyStart?: string | number | null
): WorkloadResult {
  // Only sessions up to `now` count (e.g. ACWR as it stood at the end of a past week)
  const upToNow = entries.filter((e) => new Date(e.completedAt).getTime() <= now);
  const daily = buildDailyLoads(upToNow, CHRONIC_DAYS, now);
  const acuteTotal = daily.slice(0, ACUTE_DAYS).reduce((a, b) => a + b, 0);
  const chronicTotal = daily.reduce((a, b) => a + b, 0);
  const acuteLoad = acuteTotal / ACUTE_DAYS;
  const chronicLoad = chronicTotal / CHRONIC_DAYS;
  const days = historyDays(historyStart ?? firstSessionAt(upToNow), now);
  const baselineComplete = days >= CHRONIC_DAYS;
  return {
    acuteTotal,
    chronicTotal,
    acuteLoad,
    chronicLoad,
    acwr: baselineComplete && chronicLoad > 0 ? acuteLoad / chronicLoad : null,
    baselineDays: Math.min(days, CHRONIC_DAYS),
    baselineComplete,
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

/** Short zone names for pills and legends. */
export const ACWR_SHORT_LABELS: Record<AcwrZoneKey, string> = {
  undertraining: 'Under',
  optimal: 'Optimal',
  elevated: 'Elevated',
  high: 'High',
};

/** Legend rows. Colors come from getAcwrZone, so there is only one place to change them. */
export const ACWR_LEGEND = [
  { label: 'Under', range: '< 0.8', sample: 0.5 },
  { label: 'Optimal', range: '0.8–1.3', sample: 1.0 },
  { label: 'Elevated', range: '1.3–1.5', sample: 1.4 },
  { label: 'High', range: '> 1.5', sample: 1.8 },
].map((z) => ({ ...z, color: getAcwrZone(z.sample).color }));

/** Ring color for today's readiness label: green / orange / red (grey when no data). */
export function getReadinessColor(label: string): string {
  if (label === 'Good') return '#10B981';
  if (label === 'Moderate') return '#F59E0B';
  if (label === 'Low') return '#EF4444';
  return '#9E9E9E';
}