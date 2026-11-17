import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSavedCoachEmail } from './coachSession';
import { findAccountByEmail } from './accountLookup';
import { maskFullName } from './privacy';
import { supabase } from './supabase';

import { DrillCategory, MetricType, normalizeCategory } from '@/constants/regimes';

// ─── Types ────────────────────────────────────────────────────

export type SessionType = 'training' | 'sc' | 'scrimmage';
export type LocationType = 'venue' | 'at_home';

export interface SessionDrill {
  id: string;
  name: string;
  durationMinutes: number;
  category: DrillCategory;
  targetMetrics?: MetricType[];
}

/** Sessions saved with an old drill type load as the current type it maps to. */
function normalizeDrills(raw: unknown): SessionDrill[] {
  if (!Array.isArray(raw)) return [];
  return (raw as SessionDrill[]).map((d) => {
    const category = normalizeCategory(d.category);
    return category === d.category ? d : { ...d, category, targetMetrics: undefined };
  });
}

export interface AcceptedAthlete {
  athleteId: number;
  athleteName: string;
  username?: string;
  status: 'accepted' | 'attended' | 'late';
  acceptedAt: string;
}

export interface DbSession {
  id: string | number;
  title: string;
  sessionType: SessionType;
  date: string; // YYYY-MM-DD
  startTime: string; // e.g. "4:00 PM"
  endTime: string; // e.g. "6:00 PM"
  locationType: LocationType;
  venueName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geofenceRadius?: number;
  drills: SessionDrill[];
  totalDurationMinutes: number;
  coachId?: number | null;
  coachName?: string | null;
  acceptedAthletes: AcceptedAthlete[];
  createdAt?: string;
}

export interface CreateSessionInput {
  title: string;
  sessionType: SessionType;
  date: Date;
  startTime: Date | null;
  endTime: Date | null;
  locationType: LocationType;
  venueName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geofenceRadius?: number;
  drills: SessionDrill[];
  totalDurationMinutes: number;
  coachId?: number | null;
  coachName?: string | null;
}

const STORAGE_KEY = '@smartathlete_sessions_v1';

// ─── Helpers ──────────────────────────────────────────────────

function formatDbDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDbTime(d: Date | null): string {
  if (!d) return 'TBD';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ─── Local Storage Fallback Cache ─────────────────────────────

async function getLocalSessions(): Promise<DbSession[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[sessionService] Failed to read local sessions:', err);
    return [];
  }
}

async function saveLocalSessions(sessions: DbSession[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.warn('[sessionService] Failed to save local sessions:', err);
  }
}

// ─── Offline Queue ────────────────────────────────────────────

const PENDING_CHECKINS_KEY = '@smartathlete_pending_checkins_v1';
const PENDING_METRICS_KEY = '@smartathlete_pending_metrics_v1';
const PENDING_PROGRESS_KEY = '@smartathlete_pending_progress_v1';
const ATHLETE_CACHE_KEY = '@smartathlete_athlete_profile_v1';
const NETWORK_TIMEOUT_MS = 8000;

type CompletedMetricsSummary = Parameters<typeof saveCompletedSessionMetrics>[0];

export interface PendingCheckIn {
  sessionId: string | number;
  athleteId: number;
  athleteName: string;
  username?: string;
  status: 'accepted' | 'late';
  /** Real time the athlete checked in (not the sync time). */
  acceptedAt: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
}

interface PendingMetrics {
  summary: CompletedMetricsSummary;
  athleteId?: number;
  queuedAt: string;
}

/** Live progress of one athlete in one session (tbl_session_progress). */
export interface SessionProgress {
  sessionId: number;
  athleteId: number;
  status: 'in_progress' | 'completed';
  drillsCompleted: number;
  totalDrills: number;
  currentDrill: string | null;
  elapsedSeconds: number;
  playerLoadAU: number;
  drillBreakdown: unknown[];
  /** When the phone recorded this snapshot */
  recordedAt: string;
  /** When the server received it (set by the database) */
  syncedAt?: string;
  /** Where the athlete is relative to the venue area (venue sessions only) */
  boundaryStatus?: BoundaryStatus | null;
  /** Distance (m) from the venue center at that time */
  boundaryMeters?: number | null;
}

export type BoundaryStatus = 'inside' | 'near_edge' | 'outside' | 'stopped';

// ─── Sync status (for the athlete's "synced / saved on phone" indicator) ───

export interface SyncStatus {
  /** Items stored on the phone waiting for internet */
  pending: number;
  /** Last time anything reached the server */
  lastSyncedAt: string | null;
}

let syncStatus: SyncStatus = { pending: 0, lastSyncedAt: null };
const syncListeners = new Set<(s: SyncStatus) => void>();

function setSyncStatus(patch: Partial<SyncStatus>) {
  syncStatus = { ...syncStatus, ...patch };
  syncListeners.forEach((l) => l(syncStatus));
}

export function subscribeSyncStatus(listener: (s: SyncStatus) => void): () => void {
  syncListeners.add(listener);
  listener(syncStatus);
  return () => {
    syncListeners.delete(listener);
  };
}

const progressKey = (p: { sessionId: number; athleteId: number }) => `${p.sessionId}:${p.athleteId}`;

function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || /tbl_session_progress/.test(error.message ?? ''));
}

async function upsertProgress(p: SessionProgress): Promise<{ ok: boolean; offline: boolean }> {
  const row: Record<string, unknown> = {
    session_id: p.sessionId,
    athlete_id: p.athleteId,
    status: p.status,
    drills_completed: p.drillsCompleted,
    total_drills: p.totalDrills,
    current_drill: p.currentDrill,
    elapsed_seconds: Math.round(p.elapsedSeconds),
    player_load_au: p.playerLoadAU,
    drill_breakdown: p.drillBreakdown,
    recorded_at: p.recordedAt,
  };
  if (p.boundaryStatus !== undefined) {
    row.boundary_status = p.boundaryStatus;
    row.boundary_meters = p.boundaryMeters == null ? null : Math.round(p.boundaryMeters);
  }
  const send = (r: Record<string, unknown>) =>
    withTimeout(
      supabase.from('tbl_session_progress').upsert(r, { onConflict: 'session_id,athlete_id' }) as PromiseLike<any>
    );
  try {
    let { error } = await send(row);
    if (error && /boundary_/.test(error.message ?? '')) {
      // Boundary columns not added yet (re-run supabase_session_progress.sql): send the rest
      const { boundary_status: _s, boundary_meters: _m, ...rest } = row;
      ({ error } = await send(rest));
    }
    if (!error) return { ok: true, offline: false };
    if (isMissingTable(error)) {
      // supabase_session_progress.sql not run yet: nothing to sync to, don't queue forever
      return { ok: true, offline: false };
    }
    if (isNetworkError(error)) return { ok: false, offline: true };
    console.warn('[sessionService] Dropping unsyncable progress:', error.message);
    return { ok: true, offline: false };
  } catch {
    return { ok: false, offline: true };
  }
}

/**
 * Uploads a progress snapshot. Without internet, the latest snapshot per session is kept
 * on the phone and sent by flushOfflineQueue() once the connection returns.
 */
export async function recordSessionProgress(p: SessionProgress): Promise<'synced' | 'pending'> {
  const res = await upsertProgress(p);
  const queued = await readList<SessionProgress>(PENDING_PROGRESS_KEY);
  const others = queued.filter((q) => progressKey(q) !== progressKey(p));
  if (res.ok) {
    // A newer snapshot reached the server; an older buffered one is no longer needed
    if (others.length !== queued.length) await writeList(PENDING_PROGRESS_KEY, others);
    setSyncStatus({ lastSyncedAt: new Date().toISOString(), pending: await getPendingSyncCount() });
    // Connection is back: push anything else that was buffered
    if ((await getPendingSyncCount()) > 0) flushOfflineQueue().catch(() => undefined);
    return 'synced';
  }
  await writeList(PENDING_PROGRESS_KEY, [...others, p]);
  setSyncStatus({ pending: await getPendingSyncCount() });
  return 'pending';
}

/** Progress rows for the given sessions, keyed "sessionId:athleteId" (coach view). */
// false once the server says tbl_session_progress doesn't exist (SQL not run yet)
let progressTableAvailable: boolean | null = null;

/** Whether live progress can be shown (null = not checked yet). */
export function isSessionProgressAvailable(): boolean | null {
  return progressTableAvailable;
}

export async function getSessionProgress(
  sessionIds: (string | number)[]
): Promise<Map<string, SessionProgress>> {
  const ids = sessionIds.map(String).filter((id) => /^\d+$/.test(id)).map(Number);
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from('tbl_session_progress').select('*').in('session_id', ids);
  if (error) {
    if (isMissingTable(error)) progressTableAvailable = false;
    else console.warn('[sessionService] Progress lookup failed:', error.message);
    return new Map();
  }
  progressTableAvailable = true;
  return new Map(
    (data ?? []).map((r: any) => {
      const p: SessionProgress = {
        sessionId: Number(r.session_id),
        athleteId: Number(r.athlete_id),
        status: r.status,
        drillsCompleted: r.drills_completed ?? 0,
        totalDrills: r.total_drills ?? 0,
        currentDrill: r.current_drill ?? null,
        elapsedSeconds: r.elapsed_seconds ?? 0,
        playerLoadAU: r.player_load_au ?? 0,
        drillBreakdown: r.drill_breakdown ?? [],
        recordedAt: r.recorded_at,
        syncedAt: r.synced_at,
        boundaryStatus: r.boundary_status ?? null,
        boundaryMeters: r.boundary_meters ?? null,
      };
      return [progressKey(p), p];
    })
  );
}

// ─── Saved results per athlete (coach roster) ─────────────────

export type SessionOutcome = 'completed' | 'ended_early' | 'left_venue';

export interface AthleteSessionResult {
  sessionId: number;
  athleteId: number;
  totalSeconds: number;
  /** Session Load (RPE × minutes); 0 when no RPE was given */
  playerLoadAU: number;
  sessionRpe: number | null;
  avgHeartRate: number;
  maxHeartRate: number;
  steps: number;
  meters: number;
  jumps: number;
  drillsDone: number;
  drillNames: { name: string; seconds: number }[];
  /** As recorded; null for results saved before end reasons existed */
  endReason: SessionOutcome | null;
  completedAt: string;
}

/**
 * Saved results for the given sessions, keyed "sessionId:athleteId" (latest per athlete).
 */
export async function getSessionResults(
  sessionIds: (string | number)[]
): Promise<Map<string, AthleteSessionResult>> {
  const ids = sessionIds.map(String).filter((id) => /^\d+$/.test(id)).map(Number);
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('tbl_session_metrics')
    .select('*')
    .in('session_id', ids)
    .order('completed_at', { ascending: true });
  if (error) {
    console.warn('[sessionService] Session results lookup failed:', error.message);
    return new Map();
  }
  const map = new Map<string, AthleteSessionResult>();
  for (const r of data ?? []) {
    const drills: any[] = Array.isArray(r.drill_breakdown) ? r.drill_breakdown : [];
    const result: AthleteSessionResult = {
      sessionId: Number(r.session_id),
      athleteId: Number(r.athlete_id),
      totalSeconds: Number(r.total_seconds) || 0,
      playerLoadAU: Number(r.player_load_au) || 0,
      sessionRpe: r.session_rpe != null ? Number(r.session_rpe) : null,
      avgHeartRate: Number(r.avg_heart_rate) || 0,
      maxHeartRate: Number(r.max_heart_rate) || 0,
      steps: Number(r.steps) || 0,
      meters: Number(r.meters) || 0,
      jumps: Number(r.jumps) || 0,
      drillsDone: drills.length,
      drillNames: drills.map((d) => ({ name: String(d.drillName ?? 'Drill'), seconds: Number(d.totalSeconds) || 0 })),
      endReason:
        r.end_reason === 'completed' || r.end_reason === 'ended_early' || r.end_reason === 'left_venue'
          ? r.end_reason
          : null,
      completedAt: r.completed_at,
    };
    // Rows come oldest first, so the latest result per athlete wins
    map.set(`${result.sessionId}:${result.athleteId}`, result);
  }
  return map;
}

/**
 * How a result ended. Results saved before end reasons were recorded are estimated:
 * every planned drill done means completed, otherwise stopped early.
 */
export function sessionOutcome(result: AthleteSessionResult, plannedDrills: number): SessionOutcome {
  if (result.endReason) return result.endReason;
  return plannedDrills > 0 && result.drillsDone >= plannedDrills ? 'completed' : 'ended_early';
}

/**
 * Each athlete's progress in sessions that are still running (latest per athlete), for the
 * coach's Athletes tab.
 */
export async function getLiveProgressByAthlete(
  options: { force?: boolean } = {}
): Promise<Map<number, SessionProgress>> {
  const sessions = await getUpcomingSessions(options);
  const running = sessions.filter((s) => !isSessionEnded(s)).map((s) => s.id);
  const byAthlete = new Map<number, SessionProgress>();
  for (const p of (await getSessionProgress(running)).values()) {
    const prev = byAthlete.get(p.athleteId);
    if (!prev || (p.syncedAt ?? '') > (prev.syncedAt ?? '')) byAthlete.set(p.athleteId, p);
  }
  return byAthlete;
}

/** A live session counts as "pending sync" once the phone has been quiet this long. */
export const PROGRESS_STALE_MS = 3 * 60_000;

export type AthleteSyncState = 'live' | 'pending' | 'synced';

export function athleteSyncState(p: SessionProgress, now: number = Date.now()): AthleteSyncState {
  if (p.status === 'completed') return 'synced';
  const last = p.syncedAt ? new Date(p.syncedAt).getTime() : 0;
  return now - last <= PROGRESS_STALE_MS ? 'live' : 'pending';
}

function isNetworkError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? '');
  return /network|fetch|timeout|timed out|offline|connection|ENOTFOUND|ECONN/i.test(msg);
}

function withTimeout<T>(p: PromiseLike<T>, ms = NETWORK_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Network timeout')), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function readList<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

async function writeList<T>(key: string, list: T[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(list));
  } catch (err) {
    console.warn('[sessionService] Failed to persist queue:', err);
  }
}

export function getPendingCheckIns(): Promise<PendingCheckIn[]> {
  return readList<PendingCheckIn>(PENDING_CHECKINS_KEY);
}

/** Number of check-ins, metric records and progress snapshots waiting to sync. */
export async function getPendingSyncCount(): Promise<number> {
  const [c, m, p] = await Promise.all([
    getPendingCheckIns(),
    readList<PendingMetrics>(PENDING_METRICS_KEY),
    readList<SessionProgress>(PENDING_PROGRESS_KEY),
  ]);
  return c.length + m.length + p.length;
}

async function enqueueCheckIn(item: PendingCheckIn): Promise<void> {
  const list = await getPendingCheckIns();
  const filtered = list.filter(
    (p) =>
      !(String(p.sessionId) === String(item.sessionId) && Number(p.athleteId) === Number(item.athleteId))
  );
  await writeList(PENDING_CHECKINS_KEY, [...filtered, item]);
}

let flushing = false;

/**
 * Uploads queued check-ins and session metrics. Safe to call repeatedly
 * (app foreground, screen focus, periodic timer). Items stay queued while offline.
 */
export async function flushOfflineQueue(): Promise<{ synced: number; remaining: number }> {
  if (flushing) return { synced: 0, remaining: await getPendingSyncCount() };
  flushing = true;
  let synced = 0;
  try {
    const checkIns = await getPendingCheckIns();
    const keptCheckIns: PendingCheckIn[] = [];
    let offline = false;
    for (const item of checkIns) {
      if (offline) {
        keptCheckIns.push(item);
        continue;
      }
      try {
        const { error } = await withTimeout(
          supabase.from('tbl_session_attendees').upsert(
            {
              session_id: item.sessionId,
              athlete_id: item.athleteId,
              athlete_name: maskFullName(item.athleteName),
              username: item.username || null,
              status: item.status,
              accepted_at: item.acceptedAt,
            },
            { onConflict: 'session_id,athlete_id' }
          )
        );
        if (!error) synced++;
        else if (isNetworkError(error)) {
          offline = true;
          keptCheckIns.push(item);
        } else {
          console.warn('[sessionService] Dropping unsyncable check-in:', error.message);
        }
      } catch {
        offline = true;
        keptCheckIns.push(item);
      }
    }
    await writeList(PENDING_CHECKINS_KEY, keptCheckIns);

    const metrics = await readList<PendingMetrics>(PENDING_METRICS_KEY);
    const keptMetrics: PendingMetrics[] = [];
    for (const item of metrics) {
      if (offline) {
        keptMetrics.push(item);
        continue;
      }
      const res = await insertSessionMetrics(item.summary, item.athleteId);
      if (res.success) synced++;
      else if (isNetworkError(res.error)) {
        offline = true;
        keptMetrics.push(item);
      } else {
        console.warn('[sessionService] Dropping unsyncable metrics:', res.error);
      }
    }
    await writeList(PENDING_METRICS_KEY, keptMetrics);

    // Progress last, so a "completed" status lands after its metrics
    const progress = await readList<SessionProgress>(PENDING_PROGRESS_KEY);
    const keptProgress: SessionProgress[] = [];
    for (const item of progress) {
      if (offline) {
        keptProgress.push(item);
        continue;
      }
      const res = await upsertProgress(item);
      if (res.ok) synced++;
      else {
        offline = true;
        keptProgress.push(item);
      }
    }
    // Keep anything recorded while this flush was running
    const latest = await readList<SessionProgress>(PENDING_PROGRESS_KEY);
    const handled = new Set(progress.map((q) => `${progressKey(q)}@${q.recordedAt}`));
    const added = latest.filter((q) => !handled.has(`${progressKey(q)}@${q.recordedAt}`));
    await writeList(PENDING_PROGRESS_KEY, [
      ...keptProgress.filter((k) => !added.some((a) => progressKey(a) === progressKey(k))),
      ...added,
    ]);

    // Synced check-ins change session rosters on the server
    if (synced > 0) invalidateSessionsCache();

    const remaining = keptCheckIns.length + keptMetrics.length + keptProgress.length + added.length;
    setSyncStatus({
      pending: remaining,
      ...(synced > 0 ? { lastSyncedAt: new Date().toISOString() } : {}),
    });
    return { synced, remaining };
  } finally {
    flushing = false;
  }
}

/**
 * Returns true when the session's scheduled end date/time has already passed.
 * Sessions with an unparseable/TBD end time are never considered ended.
 */
export function isSessionEnded(
  session: Pick<DbSession, 'date' | 'endTime'>,
  now: Date = new Date()
): boolean {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(session.date || '');
  const timeMatch = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i.exec(session.endTime || '');
  if (!dateMatch || !timeMatch) return false;

  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const meridiem = timeMatch[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;

  const end = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    hours,
    minutes,
    0,
    0
  );
  return now.getTime() >= end.getTime();
}

/** Minutes before the start time at which athlete check-in opens. */
export const CHECK_IN_WINDOW_MINUTES = 15;

function parseSessionDateTime(date: string, time: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  const timeMatch = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i.exec(time || '');
  if (!dateMatch || !timeMatch) return null;
  let hours = Number(timeMatch[1]);
  const meridiem = timeMatch[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    hours,
    Number(timeMatch[2])
  );
}

export type CheckInPhase = 'not_open' | 'open' | 'late' | 'ended';

/**
 * not_open: before (start - window); open: within window before start;
 * late: after start but before end; ended: after end.
 * Sessions with an unparseable start time are treated as 'open'.
 */
export function getCheckInPhase(
  session: Pick<DbSession, 'date' | 'startTime' | 'endTime'>,
  now: Date = new Date()
): { phase: CheckInPhase; opensAt: Date | null; startsAt: Date | null } {
  const startsAt = parseSessionDateTime(session.date, session.startTime);
  if (isSessionEnded(session, now)) return { phase: 'ended', opensAt: null, startsAt };
  if (!startsAt) return { phase: 'open', opensAt: null, startsAt: null };
  const opensAt = new Date(startsAt.getTime() - CHECK_IN_WINDOW_MINUTES * 60000);
  if (now < opensAt) return { phase: 'not_open', opensAt, startsAt };
  if (now < startsAt) return { phase: 'open', opensAt, startsAt };
  return { phase: 'late', opensAt, startsAt };
}

/**
 * Whether the athlete may start tracking a session now. Checking in (early) only confirms
 * attendance; tracking unlocks at the scheduled start time and closes when the session ends.
 */
export function getSessionStartGate(
  session: Pick<DbSession, 'date' | 'startTime' | 'endTime'> | null | undefined,
  now: Date = new Date()
): { canStart: boolean; reason: 'ok' | 'early' | 'ended'; startsAt: Date | null } {
  if (!session) return { canStart: true, reason: 'ok', startsAt: null };
  const { phase, startsAt } = getCheckInPhase(session, now);
  if (phase === 'ended') return { canStart: false, reason: 'ended', startsAt };
  if (startsAt && now < startsAt) return { canStart: false, reason: 'early', startsAt };
  return { canStart: true, reason: 'ok', startsAt };
}

/** "12:34" / "1:05:00" until `target`. */
export function formatCountdown(target: Date, now: Date = new Date()): string {
  const total = Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// ─── Session Service API ──────────────────────────────────────

/**
 * Creates a new session in Supabase tbl_sessions.
 * Falls back to local storage if table is not yet created.
 */
export async function createSession(input: CreateSessionInput): Promise<DbSession> {
  invalidateSessionsCache();
  const dateStr = formatDbDate(input.date);
  const startTimeStr = formatDbTime(input.startTime);
  const endTimeStr = formatDbTime(input.endTime);

  const newSessionRecord = {
    title: input.title.trim(),
    session_type: input.sessionType,
    date: dateStr,
    start_time: startTimeStr,
    end_time: endTimeStr,
    location_type: input.locationType,
    venue_name: input.locationType === 'venue' ? input.venueName?.trim() || null : null,
    latitude: input.locationType === 'venue' ? input.latitude ?? null : null,
    longitude: input.locationType === 'venue' ? input.longitude ?? null : null,
    geofence_radius: input.locationType === 'venue' ? input.geofenceRadius ?? 40 : null,
    drills: input.drills,
    total_duration_minutes: input.totalDurationMinutes,
    coach_id: input.coachId ?? null,
    coach_name: input.coachName ? maskFullName(input.coachName) : null,
  };

  try {
    const { data, error } = await supabase
      .from('tbl_sessions')
      .insert(newSessionRecord)
      .select('*')
      .single();

    if (!error && data) {
      const created: DbSession = {
        id: data.id,
        title: data.title,
        sessionType: data.session_type as SessionType,
        date: data.date,
        startTime: data.start_time,
        endTime: data.end_time,
        locationType: data.location_type as LocationType,
        venueName: data.venue_name,
        latitude: data.latitude,
        longitude: data.longitude,
        geofenceRadius: data.geofence_radius,
        drills: normalizeDrills(data.drills),
        totalDurationMinutes: data.total_duration_minutes || 0,
        coachId: data.coach_id,
        coachName: data.coach_name,
        acceptedAthletes: [],
        createdAt: data.created_at,
      };

      // Also update local cache
      const local = await getLocalSessions();
      await saveLocalSessions([created, ...local.filter((s) => s.id !== created.id)]);
      return created;
    }
  } catch (err) {
    console.warn('[sessionService] Supabase insert failed, using fallback:', err);
  }

  // Fallback: save to local persistent storage
  const fallbackSession: DbSession = {
    id: `local-${Date.now()}`,
    title: input.title.trim(),
    sessionType: input.sessionType,
    date: dateStr,
    startTime: startTimeStr,
    endTime: endTimeStr,
    locationType: input.locationType,
    venueName: input.locationType === 'venue' ? input.venueName?.trim() || 'Ormoc Venue' : null,
    latitude: input.locationType === 'venue' ? input.latitude ?? 11.0044 : null,
    longitude: input.locationType === 'venue' ? input.longitude ?? 124.6075 : null,
    geofenceRadius: input.geofenceRadius ?? 40,
    drills: input.drills,
    totalDurationMinutes: input.totalDurationMinutes,
    coachId: input.coachId ?? null,
    coachName: input.coachName ?? 'Coach',
    acceptedAthletes: [],
    createdAt: new Date().toISOString(),
  };

  const local = await getLocalSessions();
  await saveLocalSessions([fallbackSession, ...local]);
  return fallbackSession;
}

/**
 * Updates an existing session's details and drills.
 * Accepted athletes are kept; coach details are left unchanged.
 */
export async function updateSession(
  sessionId: string | number,
  input: CreateSessionInput
): Promise<DbSession> {
  invalidateSessionsCache();
  const changes = {
    title: input.title.trim(),
    session_type: input.sessionType,
    date: formatDbDate(input.date),
    start_time: formatDbTime(input.startTime),
    end_time: formatDbTime(input.endTime),
    location_type: input.locationType,
    venue_name: input.locationType === 'venue' ? input.venueName?.trim() || null : null,
    latitude: input.locationType === 'venue' ? input.latitude ?? null : null,
    longitude: input.locationType === 'venue' ? input.longitude ?? null : null,
    geofence_radius: input.locationType === 'venue' ? input.geofenceRadius ?? 40 : null,
    drills: input.drills,
    total_duration_minutes: input.totalDurationMinutes,
  };

  if (!String(sessionId).startsWith('local-')) {
    const { error } = await withTimeout(
      supabase.from('tbl_sessions').update(changes).eq('id', sessionId) as PromiseLike<any>
    );
    if (error) {
      throw new Error(error.message || 'Failed to update session.');
    }
  }

  const local = await getLocalSessions();
  const existing = local.find((s) => String(s.id) === String(sessionId));
  const updated: DbSession = {
    ...(existing as DbSession),
    id: sessionId,
    title: changes.title,
    sessionType: input.sessionType,
    date: changes.date,
    startTime: changes.start_time,
    endTime: changes.end_time,
    locationType: input.locationType,
    venueName: changes.venue_name,
    latitude: changes.latitude,
    longitude: changes.longitude,
    geofenceRadius: changes.geofence_radius ?? undefined,
    drills: input.drills,
    totalDurationMinutes: input.totalDurationMinutes,
    acceptedAthletes: existing?.acceptedAthletes || [],
  };
  await saveLocalSessions(
    existing
      ? local.map((s) => (String(s.id) === String(sessionId) ? updated : s))
      : [updated, ...local]
  );
  return updated;
}

// Several screens load sessions on focus, often at the same moment. Concurrent calls share
// one request, and results are reused briefly; every write clears the cache.
const SESSIONS_CACHE_TTL_MS = 15_000;
let sessionsCache: { at: number; data: DbSession[] } | null = null;
let sessionsInFlight: Promise<DbSession[]> | null = null;

/** Drops cached sessions so the next read goes to the server. */
export function invalidateSessionsCache(): void {
  sessionsCache = null;
  sessionsInFlight = null;
}

/**
 * Fetches all upcoming sessions (including accepted attendees roster with athlete IDs).
 * Pass `force` for pull-to-refresh to skip the short-lived cache.
 */
export function getUpcomingSessions(options: { force?: boolean } = {}): Promise<DbSession[]> {
  if (!options.force) {
    if (sessionsCache && Date.now() - sessionsCache.at < SESSIONS_CACHE_TTL_MS) {
      return Promise.resolve([...sessionsCache.data]);
    }
    if (sessionsInFlight) return sessionsInFlight.then((data) => [...data]);
  }

  const request = fetchSessions().then((data) => {
    // Skip caching if a write invalidated the cache while this was in flight
    if (sessionsInFlight === request) sessionsCache = { at: Date.now(), data };
    return data;
  });
  sessionsInFlight = request;
  request.finally(() => {
    if (sessionsInFlight === request) sessionsInFlight = null;
  }).catch(() => {});
  return request.then((data) => [...data]);
}

async function fetchSessions(): Promise<DbSession[]> {
  try {
    const { data: sessionRows, error } = await withTimeout(
      supabase.from('tbl_sessions').select('*').order('date', { ascending: false }) as PromiseLike<any>
    );

    if (!error && sessionRows && sessionRows.length > 0) {
      // Fetch all attendees
      const sessionIds = sessionRows.map((s: any) => s.id);
      const { data: attendeeRows } = await withTimeout(
        supabase
          .from('tbl_session_attendees')
          .select('*')
          .in('session_id', sessionIds) as PromiseLike<any>
      );

      const attendeesBySession: Record<string | number, AcceptedAthlete[]> = {};
      (attendeeRows || []).forEach((row: any) => {
        if (!attendeesBySession[row.session_id]) {
          attendeesBySession[row.session_id] = [];
        }
        attendeesBySession[row.session_id].push({
          athleteId: Number(row.athlete_id),
          athleteName: row.athlete_name,
          username: row.username,
          status: row.status || 'accepted',
          acceptedAt: row.accepted_at,
        });
      });

      // Keep check-ins that haven't synced yet visible as accepted
      (await getPendingCheckIns()).forEach((p) => {
        const list = (attendeesBySession[p.sessionId] ||= []);
        if (!list.some((a) => Number(a.athleteId) === Number(p.athleteId))) {
          list.push({
            athleteId: p.athleteId,
            athleteName: p.athleteName,
            username: p.username,
            status: p.status,
            acceptedAt: p.acceptedAt,
          });
        }
      });

      const parsedSessions: DbSession[] = sessionRows.map((data: any) => ({
        id: data.id,
        title: data.title,
        sessionType: data.session_type as SessionType,
        date: data.date,
        startTime: data.start_time,
        endTime: data.end_time,
        locationType: data.location_type as LocationType,
        venueName: data.venue_name,
        latitude: data.latitude,
        longitude: data.longitude,
        geofenceRadius: data.geofence_radius,
        drills: normalizeDrills(data.drills),
        totalDurationMinutes: data.total_duration_minutes || 0,
        coachId: data.coach_id,
        coachName: data.coach_name,
        acceptedAthletes: attendeesBySession[data.id] || [],
        createdAt: data.created_at,
      }));

      // Cache locally
      await saveLocalSessions(parsedSessions);
      return parsedSessions;
    }
  } catch (err) {
    console.warn('[sessionService] Supabase fetch failed, checking local storage:', err);
  }

  // Fallback to local storage
  return getLocalSessions();
}

// ─── Sessions the athlete already finished ───────────────────

const FINISHED_SESSIONS_KEY = '@smartathlete_finished_sessions_v1';

/**
 * Records on this phone that the athlete finished a session (completed, or ended
 * early). Works offline and takes effect immediately, before the results upload.
 */
export async function markSessionFinished(
  sessionId: string | number,
  athleteId?: number
): Promise<void> {
  if (!/^\d+$/.test(String(sessionId))) return; // placeholder runs aren't a real session
  const entry = `${athleteId ?? '*'}:${sessionId}`;
  const list = await readList<string>(FINISHED_SESSIONS_KEY);
  if (!list.includes(entry)) await writeList(FINISHED_SESSIONS_KEY, [...list, entry].slice(-200));
}

/** Finished sessions known on this phone: the local list plus results waiting to upload. */
export async function getLocalFinishedSessionIds(athleteId?: number): Promise<Set<string>> {
  const [local, pending] = await Promise.all([
    readList<string>(FINISHED_SESSIONS_KEY),
    readList<PendingMetrics>(PENDING_METRICS_KEY),
  ]);
  const ids = new Set<string>();
  for (const entry of local) {
    const [who, sid] = entry.split(':');
    if (who === '*' || athleteId == null || Number(who) === athleteId) ids.add(sid);
  }
  for (const p of pending) {
    if (athleteId == null || p.athleteId == null || p.athleteId === athleteId) {
      ids.add(String(p.summary.sessionId));
    }
  }
  return ids;
}

/** Every session this athlete finished: uploaded history plus what's only on the phone. */
export async function getFinishedSessionIds(athleteId?: number): Promise<Set<string>> {
  const resolvedId = athleteId ?? (await getCurrentAthleteRecord())?.id;
  const [local, history] = await Promise.all([
    getLocalFinishedSessionIds(resolvedId),
    fetchAthleteSessionHistory(resolvedId).catch(() => ({ data: [] as SessionMetricRecord[] })),
  ]);
  history.data.forEach((h) => h.sessionId != null && local.add(String(h.sessionId)));
  return local;
}

/** Soonest first, by date then start time. */
export function compareSessionsBySchedule(a: DbSession, b: DbSession): number {
  const at = parseSessionDateTime(a.date, a.startTime)?.getTime() ?? Date.parse(a.date);
  const bt = parseSessionDateTime(b.date, b.startTime)?.getTime() ?? Date.parse(b.date);
  return (at || 0) - (bt || 0);
}

/**
 * The athlete's next session: not ended, and not one they already finished (completed
 * or ended early), so a finished session is never offered for check-in or tracking again.
 */
export async function getNextSessionForAthlete(
  options: { force?: boolean; athleteId?: number } = {}
): Promise<DbSession | null> {
  const [sessions, finished] = await Promise.all([
    getUpcomingSessions({ force: options.force }),
    getFinishedSessionIds(options.athleteId),
  ]);
  return (
    sessions
      .filter((s) => !isSessionEnded(s) && !finished.has(String(s.id)))
      .sort(compareSessionsBySchedule)[0] ?? null
  );
}

/**
 * Returns the most relevant upcoming session (e.g. for athlete home / check-in).
 */
export async function getLatestUpcomingSession(
  options: { force?: boolean } = {}
): Promise<DbSession | null> {
  const sessions = await getUpcomingSessions(options);
  if (!sessions || sessions.length === 0) return null;
  // Sessions whose end time has passed are automatically ended.
  return sessions.find((s) => !isSessionEnded(s)) ?? null;
}

/**
 * Athlete accepts a session. Records the acceptance with their athlete ID number.
 */
export async function acceptSession(
  sessionId: string | number,
  athlete: {
    athleteId: number;
    athleteName: string;
    username?: string;
    status?: 'accepted' | 'late';
  },
  location?: { latitude: number; longitude: number; accuracy?: number | null }
): Promise<{ success: boolean; session: DbSession | null; message?: string; pending?: boolean }> {
  invalidateSessionsCache();
  const acceptedAt = new Date().toISOString();
  const status = athlete.status || 'accepted';
  let pending = false;

  // Try Supabase first if not a local-only id
  const isLocalId = String(sessionId).startsWith('local-');
  if (!isLocalId) {
    try {
      const { error } = await withTimeout(
        supabase.from('tbl_session_attendees').upsert(
          {
            session_id: sessionId,
            athlete_id: athlete.athleteId,
            athlete_name: maskFullName(athlete.athleteName),
            username: athlete.username || null,
            status,
            accepted_at: acceptedAt,
          },
          { onConflict: 'session_id,athlete_id' }
        )
      );

      if (!error) {
        // Refetch sessions to get updated state
        const updatedSessions = await getUpcomingSessions();
        const updated = updatedSessions.find((s) => s.id === sessionId) || null;
        return { success: true, session: updated };
      }
      if (isNetworkError(error)) pending = true;
    } catch (err) {
      console.warn('[sessionService] Supabase attendee upsert failed, queuing offline:', err);
      pending = true;
    }

    if (pending) {
      await enqueueCheckIn({
        sessionId,
        athleteId: athlete.athleteId,
        athleteName: athlete.athleteName,
        username: athlete.username,
        status,
        acceptedAt,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        accuracy: location?.accuracy ?? null,
      });
    }
  }

  // Update local storage fallback
  const local = await getLocalSessions();
  let updatedSession: DbSession | null = null;

  const updatedList = local.map((s) => {
    if (s.id === sessionId) {
      const existing = s.acceptedAthletes || [];
      const alreadyIn = existing.some((a) => Number(a.athleteId) === Number(athlete.athleteId));
      let newAccepted: AcceptedAthlete[];

      if (alreadyIn) {
        newAccepted = existing;
      } else {
        newAccepted = [
          ...existing,
          {
            athleteId: athlete.athleteId,
            athleteName: athlete.athleteName,
            username: athlete.username,
            status,
            acceptedAt,
          },
        ];
      }

      updatedSession = { ...s, acceptedAthletes: newAccepted };
      return updatedSession;
    }
    return s;
  });

  await saveLocalSessions(updatedList);
  return { success: true, session: updatedSession, pending };
}

/**
 * Deletes a session completely from the database and local cache.
 */
export async function deleteSession(
  sessionId: string | number
): Promise<{ success: boolean; error?: string }> {
  invalidateSessionsCache();
  try {
    // 1. Delete from Supabase if connected
    if (typeof sessionId === 'number' || (typeof sessionId === 'string' && !sessionId.startsWith('local_'))) {
      await supabase
        .from('tbl_session_attendees')
        .delete()
        .eq('session_id', sessionId);

      const { error } = await supabase
        .from('tbl_sessions')
        .delete()
        .eq('id', sessionId);

      if (error) {
        console.warn('[sessionService] Supabase deleteSession error:', error);
      }
    }
  } catch (err: any) {
    console.warn('[sessionService] Error deleting session from Supabase:', err);
  }

  // 2. Remove from local storage cache
  try {
    const local = await getLocalSessions();
    const updated = local.filter((s) => String(s.id) !== String(sessionId));
    await saveLocalSessions(updated);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to remove session from local storage' };
  }
}

/**
 * Allows an athlete to cancel / withdraw their acceptance for a session.
 */
export async function cancelSessionAcceptance(
  sessionId: string | number,
  athleteId: number
): Promise<{ success: boolean; session?: DbSession | null; error?: string }> {
  invalidateSessionsCache();
  // Drop any not-yet-synced check-in for this session/athlete
  const queued = await getPendingCheckIns();
  await writeList(
    PENDING_CHECKINS_KEY,
    queued.filter(
      (p) =>
        !(String(p.sessionId) === String(sessionId) && Number(p.athleteId) === Number(athleteId))
    )
  );
  try {
    if (typeof sessionId === 'number' || (typeof sessionId === 'string' && !sessionId.startsWith('local_'))) {
      await supabase
        .from('tbl_session_attendees')
        .delete()
        .eq('session_id', sessionId)
        .eq('athlete_id', athleteId);
    }
  } catch (err) {
    console.warn('[sessionService] Supabase cancelSessionAcceptance failed:', err);
  }

  // Update local storage
  const local = await getLocalSessions();
  let updatedSession: DbSession | null = null;

  const updatedList = local.map((s) => {
    if (String(s.id) === String(sessionId)) {
      const remaining = (s.acceptedAthletes || []).filter(
        (a) => Number(a.athleteId) !== Number(athleteId)
      );
      updatedSession = { ...s, acceptedAthletes: remaining };
      return updatedSession;
    }
    return s;
  });

  await saveLocalSessions(updatedList);
  return { success: true, session: updatedSession };
}

/**
 * Checks if a specific athlete has accepted the session.
 */
export function hasAthleteAccepted(
  session: DbSession | null,
  athleteId: number | null | undefined
): boolean {
  if (!session || !athleteId) return false;
  return (session.acceptedAthletes || []).some(
    (a) => Number(a.athleteId) === Number(athleteId)
  );
}

/**
 * Retrieves the currently logged-in athlete's record from tbl_athletes,
 * including their integer ID number (e.g. id: 2).
 */
// The signed-in athlete's record rarely changes; reuse it briefly across screens
export interface AthleteRecord {
  id: number;
  userId?: string;
  fullName: string;
  username: string;
  email: string;
  /** Jersey number assigned by the coach, or null */
  jerseyNumber: string | null;
}

/** "#23" when a jersey number is assigned, otherwise "Athlete ID #12". */
export function athleteLabel(athlete: { id: number; jerseyNumber?: string | null } | null | undefined): string {
  if (!athlete) return 'Athlete ID #—';
  return athlete.jerseyNumber ? `#${athlete.jerseyNumber}` : `Athlete ID #${athlete.id}`;
}

// Short so a number the coach just assigned shows up soon; pull-to-refresh forces a reload
const RECORD_CACHE_TTL_MS = 60_000;
let athleteRecordCache: { userId: string; at: number; record: AthleteRecord } | null = null;

/** Call after the athlete's profile changes (or on sign-out). */
export function invalidateAthleteRecordCache(): void {
  athleteRecordCache = null;
}

export async function getCurrentAthleteRecord(
  options: { force?: boolean } = {}
): Promise<AthleteRecord | null> {
  try {
    // getSession reads the stored session; getUser would add a network round-trip per call
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    if (!user || !user.email) return await getCachedAthlete();

    if (
      !options.force &&
      athleteRecordCache?.userId === user.id &&
      Date.now() - athleteRecordCache.at < RECORD_CACHE_TTL_MS
    ) {
      return athleteRecordCache.record;
    }

    const { data, error } = await withTimeout(
      // '*' so this works before and after the jersey_number column exists
      findAccountByEmail('tbl_athletes', user.email, '*')
    );

    if (!error && data) {
      // The table only holds masked names; the real ones live in Auth user data
      const meta = user.user_metadata ?? {};
      const first = meta.firstName || data.firstName || '';
      const last = meta.lastName || data.lastName || '';
      const fullName = `${first} ${last}`.trim() || data.username || 'Athlete';
      const record: AthleteRecord = {
        id: Number(data.id),
        userId: user.id,
        fullName,
        username: data.username || '',
        email: user.email,
        jerseyNumber: data.jersey_number ?? null,
      };
      athleteRecordCache = { userId: user.id, at: Date.now(), record };
      try {
        await AsyncStorage.setItem(ATHLETE_CACHE_KEY, JSON.stringify(record));
      } catch {}
      return record;
    }
  } catch (err) {
    console.warn('[sessionService] Failed to load athlete record (offline?):', err);
  }

  return getCachedAthlete();
}

async function getCachedAthlete(): Promise<AthleteRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(ATHLETE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    return { ...cached, jerseyNumber: cached.jerseyNumber ?? null };
  } catch {
    return null;
  }
}

/**
 * Saves a completed tracking session. If the device is offline the record is
 * queued locally and uploaded by flushOfflineQueue() once a connection returns.
 */
export async function saveCompletedSessionMetrics(
  summary: {
    sessionId: string | number;
    sessionTitle: string;
    totalSeconds: number;
    steps: number;
    meters: number;
    jumps: number;
    avgHeartRate: number;
    maxHeartRate: number;
    playerLoadAU: number;
    sessionRpe?: number | null;
    caloriesBurned: number;
    watchName: string;
    completedAt: string;
    drillBreakdown: unknown[];
    endReason?: string;
  },
  athleteId?: number
): Promise<{ success: boolean; error?: string; queued?: boolean }> {
  const res = await insertSessionMetrics(summary, athleteId);
  if (!res.success && isNetworkError(res.error)) {
    const resolvedId = athleteId ?? (await getCachedAthlete())?.id;
    const list = await readList<PendingMetrics>(PENDING_METRICS_KEY);
    list.push({ summary, athleteId: resolvedId, queuedAt: new Date().toISOString() });
    await writeList(PENDING_METRICS_KEY, list);
    return { success: true, queued: true };
  }
  return res;
}

/**
 * Saves a completed tracking session (including Player Load AU) to tbl_session_metrics.
 */
async function insertSessionMetrics(
  summary: CompletedMetricsSummary,
  athleteId?: number
): Promise<{ success: boolean; error?: string }> {
  try {
    let resolvedAthleteId = athleteId;
    if (!resolvedAthleteId) {
      const athlete = await getCurrentAthleteRecord();
      resolvedAthleteId = athlete?.id;
    }

    let validSessionId: number | null = /^\d+$/.test(String(summary.sessionId))
      ? Number(summary.sessionId)
      : null;
    if (validSessionId === null) {
      const latest = await getLatestUpcomingSession();
      if (latest && /^\d+$/.test(String(latest.id))) {
        validSessionId = Number(latest.id);
      }
    }

    const row: Record<string, unknown> = {
      session_id: validSessionId,
      athlete_id: resolvedAthleteId ?? null,
      session_title: summary.sessionTitle,
      player_load_au: summary.playerLoadAU,
      total_seconds: summary.totalSeconds,
      steps: summary.steps,
      meters: summary.meters,
      jumps: summary.jumps,
      avg_heart_rate: summary.avgHeartRate,
      max_heart_rate: summary.maxHeartRate,
      calories_burned: summary.caloriesBurned,
      watch_name: summary.watchName,
      drill_breakdown: summary.drillBreakdown,
      completed_at: summary.completedAt,
    };

    // Columns added by later migrations; dropped from the insert if not there yet
    // (supabase_session_rpe.sql, supabase_session_end_reason.sql)
    const optional: Record<string, unknown> = {
      session_rpe: summary.sessionRpe ?? null,
      end_reason: summary.endReason ?? null,
    };
    let { error } = await supabase.from('tbl_session_metrics').insert({ ...row, ...optional });
    for (let i = 0; error && i < 2; i++) {
      const message = error.message ?? '';
      const missing = Object.keys(optional).find((k) => message.includes(k));
      if (!missing) break;
      delete optional[missing];
      ({ error } = await supabase.from('tbl_session_metrics').insert({ ...row, ...optional }));
    }

    if (error) {
      console.warn('[sessionService] Failed to save session metrics:', error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.warn('[sessionService] Error saving session metrics:', err);
    return { success: false, error: err?.message || 'Unknown error' };
  }
}

export interface SessionMetricRecord {
  id: number;
  sessionId: number | null;
  sessionTitle: string;
  playerLoadAU: number;
  sessionRpe: number | null;
  totalSeconds: number;
  steps: number;
  meters: number;
  jumps: number;
  avgHeartRate: number;
  maxHeartRate: number;
  caloriesBurned: number;
  watchName: string;
  completedAt: string;
}

/**
 * Fetches the current athlete's completed sessions from tbl_session_metrics (newest first).
 */
export async function fetchAthleteSessionHistory(
  athleteId?: number
): Promise<{ data: SessionMetricRecord[]; error?: string }> {
  try {
    let resolvedAthleteId = athleteId;
    if (!resolvedAthleteId) {
      const athlete = await getCurrentAthleteRecord();
      resolvedAthleteId = athlete?.id;
    }
    if (!resolvedAthleteId) return { data: [] };

    const { data, error } = await supabase
      .from('tbl_session_metrics')
      .select('*')
      .eq('athlete_id', resolvedAthleteId)
      .order('completed_at', { ascending: false });

    if (error) return { data: [], error: error.message };

    return {
      data: (data ?? []).map((r: any) => ({
        id: Number(r.id),
        sessionId: r.session_id != null ? Number(r.session_id) : null,
        sessionTitle: r.session_title || 'Training session',
        playerLoadAU: Number(r.player_load_au) || 0,
        sessionRpe: r.session_rpe != null ? Number(r.session_rpe) : null,
        totalSeconds: Number(r.total_seconds) || 0,
        steps: Number(r.steps) || 0,
        meters: Number(r.meters) || 0,
        jumps: Number(r.jumps) || 0,
        avgHeartRate: Number(r.avg_heart_rate) || 0,
        maxHeartRate: Number(r.max_heart_rate) || 0,
        caloriesBurned: Number(r.calories_burned) || 0,
        watchName: r.watch_name || '',
        completedAt: r.completed_at || r.created_at,
      })),
    };
  } catch (err: any) {
    return { data: [], error: err?.message || 'Unknown error' };
  }
}

/**
 * Retrieves the currently logged-in coach's record from tbl_coaches.
 */
export async function getCurrentCoachRecord(): Promise<{
  id: number;
  fullName: string;
  username: string;
  email: string;
} | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const login = session?.user?.email || (await getSavedCoachEmail());

    if (!login) return null;

    const { data, error } = await findAccountByEmail(
      'tbl_coaches',
      login,
      'id, firstName, middleName, lastName, username, email'
    );

    if (!error && data) {
      // Real names come from Auth; without a session only the masked table values exist
      const meta = session?.user?.user_metadata ?? {};
      const first = meta.firstName || data.firstName || '';
      const last = meta.lastName || data.lastName || '';
      const fullName = `${first} ${last}`.trim() || data.username || 'Coach';
      return {
        id: Number(data.id),
        fullName,
        username: data.username || '',
        email: session?.user?.email || (login.includes('@') ? login : data.email || ''),
      };
    }
  } catch (err) {
    console.warn('[sessionService] Failed to load coach record:', err);
  }

  return null;
}
