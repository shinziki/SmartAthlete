import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSavedCoachEmail } from './coachSession';
import { supabase } from './supabase';

import { MetricType } from '@/constants/regimes';

// ─── Types ────────────────────────────────────────────────────

export type SessionType = 'training' | 'sc' | 'scrimmage';
export type LocationType = 'venue' | 'at_home';

export interface SessionDrill {
  id: string;
  name: string;
  durationMinutes: number;
  category: 'Warm-up' | 'Tactics' | 'Conditioning' | 'Scrimmage' | 'Cool-down';
  targetMetrics?: MetricType[];
}

export interface AcceptedAthlete {
  athleteId: number;
  athleteName: string;
  username?: string;
  status: 'accepted' | 'attended';
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

// ─── Session Service API ──────────────────────────────────────

/**
 * Creates a new session in Supabase tbl_sessions.
 * Falls back to local storage if table is not yet created.
 */
export async function createSession(input: CreateSessionInput): Promise<DbSession> {
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
    coach_name: input.coachName ?? null,
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
        drills: (data.drills as SessionDrill[]) || [],
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
 * Fetches all upcoming sessions (including accepted attendees roster with athlete IDs).
 */
export async function getUpcomingSessions(): Promise<DbSession[]> {
  try {
    const { data: sessionRows, error } = await supabase
      .from('tbl_sessions')
      .select('*')
      .order('date', { ascending: false });

    if (!error && sessionRows && sessionRows.length > 0) {
      // Fetch all attendees
      const sessionIds = sessionRows.map((s) => s.id);
      const { data: attendeeRows } = await supabase
        .from('tbl_session_attendees')
        .select('*')
        .in('session_id', sessionIds);

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

      const parsedSessions: DbSession[] = sessionRows.map((data) => ({
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
        drills: (data.drills as SessionDrill[]) || [],
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

/**
 * Returns the most relevant upcoming session (e.g. for athlete home / check-in).
 */
export async function getLatestUpcomingSession(): Promise<DbSession | null> {
  const sessions = await getUpcomingSessions();
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
  }
): Promise<{ success: boolean; session: DbSession | null; message?: string }> {
  const acceptedAt = new Date().toISOString();

  // Try Supabase first if not a local-only id
  const isLocalId = String(sessionId).startsWith('local-');
  if (!isLocalId) {
    try {
      const { error } = await supabase.from('tbl_session_attendees').upsert(
        {
          session_id: sessionId,
          athlete_id: athlete.athleteId,
          athlete_name: athlete.athleteName,
          username: athlete.username || null,
          status: 'accepted',
          accepted_at: acceptedAt,
        },
        { onConflict: 'session_id,athlete_id' }
      );

      if (!error) {
        // Refetch sessions to get updated state
        const updatedSessions = await getUpcomingSessions();
        const updated = updatedSessions.find((s) => s.id === sessionId) || null;
        return { success: true, session: updated };
      }
    } catch (err) {
      console.warn('[sessionService] Supabase attendee upsert failed, using local:', err);
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
            status: 'accepted',
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
  return { success: true, session: updatedSession };
}

/**
 * Deletes a session completely from the database and local cache.
 */
export async function deleteSession(
  sessionId: string | number
): Promise<{ success: boolean; error?: string }> {
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
export async function getCurrentAthleteRecord(): Promise<{
  id: number;
  userId?: string;
  fullName: string;
  username: string;
  email: string;
} | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !user.email) return null;

    const { data, error } = await supabase
      .from('tbl_athletes')
      .select('id, firstName, middleName, lastName, username, email')
      .ilike('email', user.email)
      .maybeSingle();

    if (!error && data) {
      const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.username || 'Athlete';
      return {
        id: Number(data.id),
        userId: user.id,
        fullName,
        username: data.username || '',
        email: data.email || user.email,
      };
    }
  } catch (err) {
    console.warn('[sessionService] Failed to load athlete record:', err);
  }

  return null;
}

/**
 * Saves a completed tracking session (including Player Load AU) to tbl_session_metrics.
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
    caloriesBurned: number;
    watchName: string;
    completedAt: string;
    drillBreakdown: unknown[];
  },
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

    const { error } = await supabase.from('tbl_session_metrics').insert({
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
    });

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
      data: { user },
    } = await supabase.auth.getUser();

    const email = user?.email || (await getSavedCoachEmail());

    if (!email) return null;

    const { data, error } = await supabase
      .from('tbl_coaches')
      .select('id, firstName, middleName, lastName, username, email')
      .ilike('email', email)
      .maybeSingle();

    if (!error && data) {
      const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.username || 'Coach';
      return {
        id: Number(data.id),
        fullName,
        username: data.username || '',
        email: data.email || email,
      };
    }
  } catch (err) {
    console.warn('[sessionService] Failed to load coach record:', err);
  }

  return null;
}
