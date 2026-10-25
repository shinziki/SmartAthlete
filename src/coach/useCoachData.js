import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const DAY = 86400000
export const readinessBadge = { Watch: 'red', Moderate: 'amber', Ready: 'green', 'No data': 'blue' }

const initials = (a) => ((a.firstName?.[0] || '') + (a.lastName?.[0] || '')).toUpperCase() || '?'
const ageOf = (b) => (b ? Math.floor((Date.now() - new Date(b).getTime()) / (365.25 * DAY)) : null)
export const dayKey = (d) => new Date(d).toLocaleDateString('en-CA')
const round = (n, p = 0) => (n == null ? null : Number(n.toFixed(p)))

export const DEFAULT_SETTINGS = { watch: 1.3, moderate: 1.0, acuteDays: 7, chronicDays: 28 }
const SETTINGS_KEY = 'smartathlete.coach.settings'
export const loadSettings = () => {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) } } catch { return DEFAULT_SETTINGS }
}
export const saveSettings = (s) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))

export function readinessOf(acwr, s = DEFAULT_SETTINGS) {
  if (acwr == null) return 'No data'
  if (acwr >= s.watch) return 'Watch'
  if (acwr >= s.moderate) return 'Moderate'
  return 'Ready'
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
export function derive({ athletes, sessions, metrics }, cfg = DEFAULT_SETTINGS) {
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
    const acwr = chronic > 0 ? acute / chronic : null
    const prior = mine.filter((m) => inRange(m, now - 2 * A, now - A)).reduce((s, m) => s + (+m.player_load_au || 0), 0)
    const trend = acute > prior * 1.1 && acute > 0 ? 'rising' : 'steady'
    const rd = readinessOf(acwr, cfg)
    return {
      ...a,
      name: `${a.firstName} ${a.lastName}`,
      short: `${a.firstName?.[0] || ''}. ${a.lastName}`,
      ini: initials(a),
      age: ageOf(a.birthdate),
      sessionsWk: mine.filter((m) => inRange(m, now - 7 * DAY, now)).length,
      totalSessions: mine.length,
      avgLoad: mine.length ? mine.reduce((s, m) => s + (+m.player_load_au || 0), 0) / mine.length : 0,
      load7: acute, acute, chronic, acwr, trend, readiness: rd,
      focus: rd === 'Watch' ? 'Reduce volume' : rd === 'No data' ? 'Record a session' : 'Normal progression',
    }
  })

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
  const counts = { Ready: 0, Moderate: 0, Watch: 0, 'No data': 0 }
  roster.forEach((r) => { counts[r.readiness]++ })

  const todayKey = dayKey(now)
  const sessionRows = sessions.map((s) => {
    const recs = metricsForSession(s, metrics)
    const present = new Set(recs.map((r) => r.athlete_id)).size
    return { ...s, present, recorded: recs.length, status: s.date >= todayKey && !recs.length ? 'Upcoming' : 'Completed' }
  })

  return {
    roster, weekly, counts, teamAcwr,
    avgSessionLoad: weekMetrics.length ? weekMetrics.reduce((s, m) => s + (+m.player_load_au || 0), 0) / weekMetrics.length : 0,
    activeWk: roster.filter((r) => r.sessionsWk > 0).length,
    flagged: roster.filter((r) => r.readiness === 'Watch'),
    sessionRows,
    sessionsThisWeek: sessions.filter((s) => { const t = new Date(s.date).getTime(); return t >= now - 7 * DAY && t <= now + 7 * DAY }).length,
  }
}

export function useCoachData(cfg = DEFAULT_SETTINGS) {
  const [state, setState] = useState({ loading: true, error: null, raw: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    const [a, s, m] = await Promise.all([
      supabase.from('tbl_athletes').select('id, firstName, middleName, lastName, username, birthdate, gender, email, role').order('lastName'),
      supabase.from('tbl_sessions').select('*').order('date', { ascending: false }),
      supabase.from('tbl_session_metrics').select('*').order('completed_at', { ascending: false }),
    ])
    const error = a.error || s.error || m.error
    if (error) return setState({ loading: false, error: error.message, raw: null })
    setState({ loading: false, error: null, raw: { athletes: a.data || [], sessions: s.data || [], metrics: m.data || [] } })
  }, [])

  useEffect(() => { load() }, [load]) // eslint-disable-line

  return { ...state, reload: load, data: state.raw ? { ...state.raw, ...derive(state.raw, cfg) } : null }
}
