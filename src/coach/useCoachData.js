import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { acwrOf, computeFatigue, historyDaysOf, toFatigueRow } from './fatigue'

const DAY = 86400000
/** Background refresh while the portal is open (new alerts reach the bell). */
const REFRESH_MS = 2 * 60000
export const readinessBadge = { 'High load': 'red', Elevated: 'amber', Optimal: 'green', Undertraining: 'blue', 'Building baseline': 'teal', 'No data': 'gray' }

const initials = (a) => ((a.firstName?.[0] || '') + (a.lastName?.[0] || '')).toUpperCase() || '?'
const ageOf = (b) => (b ? Math.floor((Date.now() - new Date(b).getTime()) / (365.25 * DAY)) : null)
export const dayKey = (d) => new Date(d).toLocaleDateString('en-CA')
const round = (n, p = 0) => (n == null ? null : Number(n.toFixed(p)))

// ACWR zones (same as Mobile/lib/workload.ts): < under = Undertraining,
// under–optimal = Optimal, optimal–elevated = Elevated, > elevated = High load.
export const DEFAULT_SETTINGS = { under: 0.8, optimal: 1.3, elevated: 1.5, acuteDays: 7, chronicDays: 28 }
const SETTINGS_KEY = 'smartathlete.coach.settings'
export const loadSettings = () => {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) } } catch { return DEFAULT_SETTINGS }
}
export const saveSettings = (s) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))

export function readinessOf(acwr, s = DEFAULT_SETTINGS) {
  if (acwr == null) return 'No data'
  if (acwr < s.under) return 'Undertraining'
  if (acwr <= s.optimal) return 'Optimal'
  if (acwr <= s.elevated) return 'Elevated'
  return 'High load'
}

/** Bar color class for an ACWR value ('' = optimal). */
export function acwrBarClass(acwr, s = DEFAULT_SETTINGS) {
  return { 'High load': 'danger', Elevated: 'warn', Undertraining: 'under' }[readinessOf(acwr, s)] || ''
}

/** Metric rows belonging to a session (by id, or by same-day for rows with no session_id). */
export function metricsForSession(session, metrics) {
  return metrics.filter((m) =>
    m.session_id != null
      ? m.session_id === session.id
      : dayKey(m.completed_at || m.created_at) === session.date
  )
}

/** Derive everything the coach pages display from the raw Supabase rows. */
export function derive({ athletes, sessions, metrics, injuries = [], progress = [] }, cfg = DEFAULT_SETTINGS) {
  const now = Date.now()
  const A = cfg.acuteDays * DAY
  const C = cfg.chronicDays * DAY
  const stamp = (m) => new Date(m.completed_at || m.created_at).getTime()
  const inRange = (m, from, to) => stamp(m) >= from && stamp(m) <= to

  const roster = athletes.map((a) => {
    const mine = metrics.filter((m) => m.athlete_id === a.id)
    const acute = mine.filter((m) => inRange(m, now - A, now)).reduce((s, m) => s + (+m.player_load_au || 0), 0)
    const chronicTotal = mine.filter((m) => inRange(m, now - C, now)).reduce((s, m) => s + (+m.player_load_au || 0), 0)
    const chronic = chronicTotal / (cfg.chronicDays / cfg.acuteDays)
    // Same 28-day rule as the mobile app: no ACWR until a full chronic window of history
    const rows = mine.map(toFatigueRow)
    const acwr = acwrOf(rows, now, cfg.acuteDays, cfg.chronicDays)
    const baselineDays = Math.min(historyDaysOf(rows, now), cfg.chronicDays)
    const prior = mine.filter((m) => inRange(m, now - 2 * A, now - A)).reduce((s, m) => s + (+m.player_load_au || 0), 0)
    const trend = acute > prior * 1.1 && acute > 0 ? 'rising' : 'steady'
    const rd = acwr == null && mine.length > 0 ? 'Building baseline' : readinessOf(acwr, cfg)
    const fatigue = computeFatigue(rows, now, acwr)
    return {
      ...a,
      injuries: injuries.filter((i) => i.athlete_id === a.id),
      name: `${a.firstName} ${a.lastName}`,
      short: `${a.firstName?.[0] || ''}. ${a.lastName}`,
      ini: initials(a),
      age: ageOf(a.birthdate),
      sessionsWk: mine.filter((m) => inRange(m, now - 7 * DAY, now)).length,
      totalSessions: mine.length,
      avgLoad: mine.length ? mine.reduce((s, m) => s + (+m.player_load_au || 0), 0) / mine.length : 0,
      load7: acute, acute, chronic, acwr, baselineDays, trend, readiness: rd, fatigue,
      focus: fatigue.level === 'high' || fatigue.level === 'moderate'
        ? fatigue.recommendation
        : { 'High load': 'Reduce load', Elevated: 'Monitor closely', Undertraining: 'Build load gradually', 'No data': 'Record a session', 'Building baseline': `Building baseline (day ${baselineDays}/${cfg.chronicDays})` }[rd] || 'Normal progression',
    }
  })

  // Notification Module (web): the same alerts the apps send. `key` stays the same while
  // the alert lasts (the top-bar bell remembers which ones were seen); `page` is where a
  // click on it goes.
  const byId = Object.fromEntries(roster.map((r) => [r.id, r]))
  const STALE = 10 * 60000
  const alerts = [
    ...roster.filter((r) => r.readiness === 'High load').map((r) => ({
      key: `high_load:${r.id}`, page: 'load',
      kind: 'high_load', icon: 'bi-exclamation-triangle-fill', color: 'red', athlete: r,
      title: 'Training load unusually high', text: `ACWR ${r.acwr?.toFixed(2)} — consider reducing load.`,
    })),
    ...roster.filter((r) => r.fatigue.level === 'high').map((r) => ({
      key: `recovery:${r.id}`, page: 'load',
      kind: 'recovery', icon: 'bi-battery-half', color: 'amber', athlete: r,
      title: 'Recovery may be needed', text: `Fatigue ${r.fatigue.score}/100 — ${r.fatigue.recommendation}`,
    })),
    ...progress.filter((p) => { const age = now - new Date(p.synced_at).getTime(); return p.status === 'in_progress' && age > STALE && age < DAY }).map((p) => ({
      key: `sync:${p.athlete_id}:${p.session_id}`, page: 'sessions',
      kind: 'sync', icon: 'bi-cloud-arrow-up', color: 'blue', athlete: byId[p.athlete_id],
      title: 'Wearable sync pending', text: `No data received for ${Math.round((now - new Date(p.synced_at).getTime()) / 60000)} min — the watch data is waiting on the athlete's phone.`,
    })),
  ]

  // last 7 calendar days of team load
  const weekly = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - (6 - i) * DAY)
    const key = dayKey(d)
    const au = metrics.filter((m) => dayKey(m.completed_at || m.created_at) === key).reduce((s, m) => s + (+m.player_load_au || 0), 0)
    return { day: d.toLocaleDateString('en-US', { weekday: 'short' }), au: round(au, 1) }
  })

  const weekMetrics = metrics.filter((m) => inRange(m, now - 7 * DAY, now))
  const withAcwr = roster.filter((r) => r.acwr != null)
  const teamAcwr = withAcwr.length ? withAcwr.reduce((s, r) => s + r.acwr, 0) / withAcwr.length : null
  const counts = { Undertraining: 0, Optimal: 0, Elevated: 0, 'High load': 0, 'Building baseline': 0, 'No data': 0 }
  roster.forEach((r) => { counts[r.readiness]++ })

  const todayKey = dayKey(now)
  const sessionRows = sessions.map((s) => {
    const recs = metricsForSession(s, metrics)
    const present = new Set(recs.map((r) => r.athlete_id)).size
    return { ...s, present, recorded: recs.length, status: s.date >= todayKey && !recs.length ? 'Upcoming' : 'Completed' }
  })

  return {
    roster, weekly, counts, teamAcwr, alerts,
    avgSessionLoad: weekMetrics.length ? weekMetrics.reduce((s, m) => s + (+m.player_load_au || 0), 0) / weekMetrics.length : 0,
    activeWk: roster.filter((r) => r.sessionsWk > 0).length,
    flagged: roster.filter((r) => r.readiness === 'High load'),
    sessionRows,
    sessionsThisWeek: sessions.filter((s) => { const t = new Date(s.date).getTime(); return t >= now - 7 * DAY && t <= now + 7 * DAY }).length,
  }
}

function isMissingColumn(error) {
  return !!error && (error.code === '42703' || error.code === 'PGRST204' || /column/.test(error.message ?? ''))
}

/** Assigns an athlete's team (coach only). Throws a readable error. */
export async function saveTeam(athleteId, team) {
  const value = (team ?? '').trim() || null
  const { data, error } = await supabase.from('tbl_athletes').update({ team: value }).eq('id', athleteId).select('id')
  if (error) {
    if (isMissingColumn(error)) throw new Error('Teams need the database update (supabase_athlete_profile.sql) first.')
    throw new Error(error.message || 'Could not save the team.')
  }
  if (!data || data.length === 0) throw new Error('You do not have permission to change this athlete.')
}

function isMissingJerseyColumn(error) {
  return !!error && (error.code === '42703' || error.code === 'PGRST204' || /jersey_number/.test(error.message ?? ''))
}

/** Valid basketball numbers: 0, 00 and 1-99 (no other leading zeros). */
export const JERSEY_NUMBER_PATTERN = /^(0|00|[1-9][0-9]?)$/

/** Assigns (or clears, with null) an athlete's jersey number; throws a readable error. */
export async function saveJerseyNumber(athleteId, jerseyNumber) {
  const value = (jerseyNumber ?? '').trim() || null
  if (value !== null && !JERSEY_NUMBER_PATTERN.test(value)) throw new Error('Use 0, 00, or a number from 1 to 99.')
  const { data, error } = await supabase.from('tbl_athletes').update({ jersey_number: value }).eq('id', athleteId).select('id')
  if (error) {
    if (error.code === '23505') throw new Error(`#${value} is already taken by another athlete.`)
    if (isMissingJerseyColumn(error)) throw new Error('Jersey numbers need the database update (supabase_jersey_numbers.sql) first.')
    throw new Error(error.message || 'Could not save the jersey number.')
  }
  // An update blocked by row-level security succeeds but changes no rows
  if (!data || data.length === 0) throw new Error('You do not have permission to change this athlete.')
}

export function useCoachData(cfg = DEFAULT_SETTINGS) {
  const [state, setState] = useState({ loading: true, error: null, raw: null })

  // `silent`: background refresh (no spinner; a failed one keeps the data on screen)
  const load = useCallback(async (opts) => {
    const silent = opts?.silent === true
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }))
    const athleteCols = 'id, firstName, middleName, lastName, username, birthdate, gender, email, role'
    const profileCols = 'team, position, height_cm, weight_kg, injury_consent'
    const [a0, s, m, inj, pr, rn] = await Promise.all([
      supabase.from('tbl_athletes').select(`${athleteCols}, jersey_number, ${profileCols}`).order('lastName'),
      supabase.from('tbl_sessions').select('*').order('date', { ascending: false }),
      supabase.from('tbl_session_metrics').select('*').order('completed_at', { ascending: false }),
      // Only rows the athlete chose to share come back (row-level security)
      supabase.from('tbl_athlete_injuries').select('*').order('injured_on', { ascending: false }),
      supabase.from('tbl_session_progress').select('session_id, athlete_id, status, synced_at').eq('status', 'in_progress'),
      // tbl_athletes only holds masked names ("J*****"); the real ones come from Auth,
      // for coaches only (Mobile/supabase_athlete_names.sql)
      supabase.rpc('sa_athlete_names'),
    ])
    // Older databases: fall back step by step (supabase_athlete_profile.sql, supabase_jersey_numbers.sql)
    let a = a0
    if (isMissingColumn(a.error)) a = await supabase.from('tbl_athletes').select(`${athleteCols}, jersey_number`).order('lastName')
    if (isMissingColumn(a.error)) a = await supabase.from('tbl_athletes').select(athleteCols).order('lastName')
    const error = a.error || s.error || m.error
    if (error) {
      if (silent) return
      return setState({ loading: false, error: error.message, raw: null })
    }
    if (rn.error) console.warn('Real athlete names unavailable (run supabase_athlete_names.sql):', rn.error.message)
    const real = new Map((Array.isArray(rn.data) ? rn.data : []).map((r) => [Number(r.athlete_id), r]))
    const athletes = (a.data || []).map((row) => {
      const r = real.get(Number(row.id))
      if (!r) return row
      return {
        ...row,
        firstName: r.first_name || row.firstName,
        middleName: r.middle_name || row.middleName,
        lastName: r.last_name || row.lastName,
      }
    }).sort((x, y) => (x.lastName || '').localeCompare(y.lastName || '') || (x.firstName || '').localeCompare(y.firstName || ''))
    setState({
      loading: false,
      error: null,
      raw: {
        athletes, sessions: s.data || [], metrics: m.data || [],
        injuries: inj.error ? [] : inj.data || [], progress: pr.error ? [] : pr.data || [],
      },
    })
  }, [])

  useEffect(() => { load() }, [load]) // eslint-disable-line

  // Keeps alerts (the top-bar bell) current while the portal stays open: a quiet refresh
  // every couple of minutes, only while the tab is visible
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) load({ silent: true }).catch(() => {})
    }, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  return { ...state, reload: load, data: state.raw ? { ...state.raw, ...derive(state.raw, cfg) } : null }
}
