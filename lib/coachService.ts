import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────

export type Readiness = 'ready' | 'moderate' | 'watch' | 'nodata';

export interface AthleteSummary {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  initials: string;
  username: string;
  gender: string;
  /** Player Load (AU) of the most recent completed session, or null */
  lastLoadAu: number | null;
  /** Total AU in the last 7 days */
  acuteLoad: number;
  /** Average weekly AU over the last 28 days */
  chronicLoad: number;
  /** Acute:Chronic Workload Ratio, null when not computable */
  acwr: number | null;
  readiness: Readiness;
  sessionsLast7: number;
}

export interface TeamOverview {
  athletes: AthleteSummary[];
  /** % of expected athlete-session attendance over the last 7 days, null if no sessions */
  attendancePct: number | null;
  attendanceDelta: number | null;
  avgLoad: number | null;
  avgLoadDeltaPct: number | null;
  teamAcwr: number | null;
  readinessCounts: Record<Readiness, number>;
  flagged: AthleteSummary[];
}

// ─── Helpers ──────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

function initialsOf(first: string, last: string, fallback: string): string {
  const a = (first || '').trim().charAt(0);
  const b = (last || '').trim().charAt(0);
  const out = `${a}${b}`.toUpperCase();
  return out || fallback.slice(0, 2).toUpperCase() || '?';
}

export function classifyAcwr(acwr: number | null, hasData: boolean): Readiness {
  if (!hasData) return 'nodata';
  if (acwr === null) return 'ready';
  if (acwr > 1.5) return 'watch';
  if (acwr > 1.3 || acwr < 0.8) return 'moderate';
  return 'ready';
}

function formatDbDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ─── API ──────────────────────────────────────────────────────

export async function getTeamOverview(): Promise<TeamOverview> {
  const now = Date.now();
  const since28 = new Date(now - 28 * DAY).toISOString();

  const [athRes, metRes] = await Promise.all([
    supabase.from('tbl_athletes').select('id, firstName, lastName, username, gender'),
    supabase
      .from('tbl_session_metrics')
      .select('athlete_id, session_id, player_load_au, completed_at')
      .gte('completed_at', since28)
      .order('completed_at', { ascending: false }),
  ]);

  if (athRes.error) throw athRes.error;
  const athleteRows = athRes.data ?? [];
  // Metrics table may not exist yet — degrade gracefully.
  const metricRows = metRes.error ? [] : metRes.data ?? [];

  const byAthlete = new Map<number, typeof metricRows>();
  for (const m of metricRows) {
    const list = byAthlete.get(m.athlete_id) ?? [];
    list.push(m);
    byAthlete.set(m.athlete_id, list);
  }

  const athletes: AthleteSummary[] = athleteRows.map((a: any) => {
    const rows = byAthlete.get(a.id) ?? [];
    const acuteRows = rows.filter((r) => now - new Date(r.completed_at).getTime() <= 7 * DAY);
    const acute = sum(acuteRows.map((r) => r.player_load_au || 0));
    const chronic = sum(rows.map((r) => r.player_load_au || 0)) / 4;
    const acwr = chronic > 0 ? acute / chronic : null;
    const first = a.firstName ?? '';
    const last = a.lastName ?? '';
    const username = a.username ?? '';
    return {
      id: a.id,
      firstName: first,
      lastName: last,
      fullName: `${first} ${last}`.trim() || username || 'Athlete',
      initials: initialsOf(first, last, username),
      username,
      gender: a.gender ?? '',
      lastLoadAu: rows.length ? Math.round(rows[0].player_load_au || 0) : null,
      acuteLoad: Math.round(acute),
      chronicLoad: Math.round(chronic),
      acwr,
      readiness: classifyAcwr(acwr, rows.length > 0),
      sessionsLast7: acuteRows.length,
    };
  });

  // Sort: watch first, then by last load desc
  const order: Record<Readiness, number> = { watch: 0, moderate: 1, ready: 2, nodata: 3 };
  athletes.sort(
    (x, y) =>
      order[x.readiness] - order[y.readiness] ||
      (y.lastLoadAu ?? -1) - (x.lastLoadAu ?? -1) ||
      x.fullName.localeCompare(y.fullName)
  );

  // Team stats
  const thisWeek = metricRows.filter((r) => now - new Date(r.completed_at).getTime() <= 7 * DAY);
  const lastWeek = metricRows.filter((r) => {
    const age = now - new Date(r.completed_at).getTime();
    return age > 7 * DAY && age <= 14 * DAY;
  });
  const avg = (rows: typeof metricRows) =>
    rows.length ? sum(rows.map((r) => r.player_load_au || 0)) / rows.length : null;
  const avgThis = avg(thisWeek);
  const avgLast = avg(lastWeek);

  // Attendance: sessions held in the last 7 / previous 7 days
  let attendancePct: number | null = null;
  let attendanceDelta: number | null = null;
  try {
    const todayStr = formatDbDate(new Date(now));
    const { data: sessions } = await supabase
      .from('tbl_sessions')
      .select('id, date')
      .gte('date', formatDbDate(new Date(now - 14 * DAY)))
      .lte('date', todayStr);
    const total = athletes.length;
    const pct = (from: number, to: number): number | null => {
      const ids = (sessions ?? [])
        .filter((s: any) => {
          const t = new Date(`${s.date}T00:00:00`).getTime();
          return now - t >= from && now - t < to;
        })
        .map((s: any) => s.id);
      if (!ids.length || !total) return null;
      const attended = metricRows.filter((m) => ids.includes(m.session_id)).length;
      return Math.min(100, Math.round((attended / (ids.length * total)) * 100));
    };
    attendancePct = pct(-DAY, 7 * DAY);
    const prev = pct(7 * DAY, 14 * DAY);
    if (attendancePct !== null && prev !== null) attendanceDelta = attendancePct - prev;
  } catch {
    /* sessions table unavailable */
  }

  const readinessCounts: Record<Readiness, number> = { ready: 0, moderate: 0, watch: 0, nodata: 0 };
  athletes.forEach((a) => readinessCounts[a.readiness]++);

  const acwrs = athletes.map((a) => a.acwr).filter((v): v is number => v !== null);
  const teamAcwr = acwrs.length ? sum(acwrs) / acwrs.length : null;

  return {
    athletes,
    attendancePct,
    attendanceDelta,
    avgLoad: avgThis !== null ? Math.round(avgThis) : null,
    avgLoadDeltaPct:
      avgThis !== null && avgLast ? Math.round(((avgThis - avgLast) / avgLast) * 100) : null,
    teamAcwr,
    readinessCounts,
    flagged: athletes.filter((a) => a.readiness === 'watch'),
  };
}
