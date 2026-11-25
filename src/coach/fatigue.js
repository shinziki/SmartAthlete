/**
 * Fatigue estimate (decision support, NOT a medical diagnosis).
 * Same formulas as Mobile/lib/fatigue.ts — keep the two in step.
 *
 *   Training load accumulation   ACWR (7-day vs 28-day load)                       30 pts
 *   Reduced movement intensity   metres + jumps per minute, last 3 vs baseline     20 pts
 *   Declining acceleration       accelerations + sprints per minute, same           20 pts
 *   Heart-rate trend             HR recovery after drills falling / avg HR rising  15 pts
 *   Recovery intervals           rest days in the last week, hours since last      15 pts
 *
 * Indicators without data are left out and the score is scaled to the rest.
 */

const DAY = 86400000
const RECENT = 3
const BASELINE_DAYS = 28

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const valid = (xs) => xs.filter((v) => v != null && Number.isFinite(v))
function changePct(recent, baseline) {
  const r = mean(valid(recent))
  const b = mean(valid(baseline))
  if (r == null || b == null || b <= 0) return null
  return ((r - b) / b) * 100
}
const perMin = (count, secs) => (count == null || secs < 60 ? null : count / (secs / 60))
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

export const FATIGUE_LEVELS = {
  low: { label: 'Low', color: '#10b981', badge: 'green' },
  moderate: { label: 'Moderate', color: '#f59e0b', badge: 'amber' },
  high: { label: 'High', color: '#ef4444', badge: 'red' },
  nodata: { label: 'No data', color: '#9ca3af', badge: 'gray' },
}

export const fatigueLevelOf = (score) => (score == null ? 'nodata' : score >= 60 ? 'high' : score >= 35 ? 'moderate' : 'low')

/** Average heart-rate recovery across a session's drills (bpm), or null. */
export function hrRecoveryOf(drills) {
  const xs = (Array.isArray(drills) ? drills : []).map((d) => Number(d?.hrRecoveryDrop) || 0).filter((v) => v > 0)
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

/**
 * ACWR with daily averages: (acute total / acuteDays) ÷ (chronic total / chronicDays).
 * null until chronicDays (28) have passed since the first session — same rule as
 * Mobile/lib/workload.ts, so web and mobile show the same numbers.
 */
export function acwrOf(rows, now = Date.now(), acuteDays = 7, chronicDays = 28) {
  const upTo = rows.filter((r) => r.t <= now)
  if (!upTo.length) return null
  const today = startOfDay(now)
  if (historyDaysOf(rows, now) < chronicDays) return null
  let acute = 0, chronic = 0
  for (const r of upTo) {
    const ago = Math.round((today - startOfDay(r.t)) / DAY)
    if (ago < acuteDays) acute += r.load
    if (ago < chronicDays) chronic += r.load
  }
  return chronic > 0 ? (acute / acuteDays) / (chronic / chronicDays) : null
}

/** Days of history at `now`, counting the first session's day as day 1 (0 = none). */
export function historyDaysOf(rows, now = Date.now()) {
  const ts = rows.map((r) => r.t).filter((t) => !isNaN(t) && t <= now)
  if (!ts.length) return 0
  return Math.round((startOfDay(now) - startOfDay(Math.min(...ts))) / DAY) + 1
}

/** Shapes a tbl_session_metrics row for the fatigue estimate. */
export const toFatigueRow = (m) => ({
  t: new Date(m.completed_at || m.created_at).getTime(),
  load: +m.player_load_au || 0,
  totalSeconds: +m.total_seconds || 0,
  meters: +m.meters || 0,
  jumps: +m.jumps || 0,
  avgHeartRate: +m.avg_heart_rate || null,
  sprints: m.sprints ?? null,
  accelerations: m.accelerations ?? null,
  hrRecovery: hrRecoveryOf(m.drill_breakdown),
})

/** acwr: pass the ACWR the page already shows so both agree (default: computed here). */
export function computeFatigue(rowsIn, now = Date.now(), acwr = undefined) {
  const rows = rowsIn.filter((r) => !isNaN(r.t) && r.t <= now).sort((a, b) => b.t - a.t)
  const none = (recommendation) => ({ score: null, level: 'nodata', ...FATIGUE_LEVELS.nodata, factors: [], recommendation })
  if (!rows.length) return none('Record a session to get a fatigue estimate.')

  const factors = []
  const a = acwr !== undefined ? acwr : acwrOf(rows, now)
  if (a != null) {
    factors.push({
      key: 'load', label: 'Training load', max: 30,
      points: a > 1.5 ? 30 : a > 1.3 ? 18 : a < 0.8 ? 0 : a > 1.15 ? 8 : 0,
      detail: `ACWR ${a.toFixed(2)}${a > 1.5 ? ' (well above usual)' : a > 1.3 ? ' (above usual)' : ''}`,
    })
  }

  const recent = rows.slice(0, RECENT)
  const baseline = rows.slice(RECENT).filter((r) => now - r.t <= BASELINE_DAYS * DAY)
  if (baseline.length >= 2) {
    const intensity = (r) => (r.totalSeconds >= 60 ? (r.meters + (r.jumps || 0) * 10) / (r.totalSeconds / 60) : null)
    const dI = changePct(recent.map(intensity), baseline.map(intensity))
    if (dI != null) {
      const drop = -dI
      factors.push({ key: 'intensity', label: 'Movement intensity', max: 20,
        points: drop >= 25 ? 20 : drop >= 15 ? 14 : drop >= 8 ? 7 : 0,
        detail: drop >= 8 ? `Down ${Math.round(drop)}% vs usual` : 'In the usual range' })
    }
    const accel = (r) => (r.accelerations == null && r.sprints == null ? null : perMin((r.accelerations ?? 0) + (r.sprints ?? 0), r.totalSeconds))
    const dA = changePct(recent.map(accel), baseline.map(accel))
    if (dA != null) {
      const drop = -dA
      factors.push({ key: 'acceleration', label: 'Accelerations', max: 20,
        points: drop >= 30 ? 20 : drop >= 18 ? 13 : drop >= 10 ? 6 : 0,
        detail: drop >= 10 ? `Down ${Math.round(drop)}% vs usual` : 'In the usual range' })
    }
    const dRec = changePct(recent.map((r) => r.hrRecovery), baseline.map((r) => r.hrRecovery))
    const hrOf = (r) => (r.avgHeartRate && r.avgHeartRate > 30 ? r.avgHeartRate : null)
    const dHr = changePct(recent.map(hrOf), baseline.map(hrOf))
    if (dRec != null || dHr != null) {
      const recDrop = dRec != null ? -dRec : 0
      const hrUp = dHr ?? 0
      let points = recDrop >= 30 ? 10 : recDrop >= 15 ? 6 : 0
      points += hrUp >= 8 ? 5 : hrUp >= 4 ? 3 : 0
      const parts = []
      if (recDrop >= 15) parts.push(`HR recovery down ${Math.round(recDrop)}%`)
      if (hrUp >= 4) parts.push(`avg HR up ${Math.round(hrUp)}%`)
      factors.push({ key: 'heartRate', label: 'Heart-rate trend', max: 15, points: Math.min(15, points), detail: parts.join(', ') || 'In the usual range' })
    }
  }

  const trained = new Set(rows.filter((r) => now - r.t < 7 * DAY).map((r) => new Date(r.t).toDateString()))
  const restDays = 7 - trained.size
  const hours = (now - rows[0].t) / 3600000
  if (trained.size > 0) {
    let points = restDays === 0 ? 10 : restDays === 1 ? 6 : 0
    points += hours < 12 ? 5 : hours < 24 ? 2 : 0
    factors.push({ key: 'recovery', label: 'Recovery time', max: 15, points: Math.min(15, points),
      detail: `${restDays} rest day${restDays === 1 ? '' : 's'} this week · last session ${hours < 24 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`} ago` })
  }

  const maxPts = factors.reduce((s, f) => s + f.max, 0)
  if (maxPts < 30) return { ...none('Keep recording sessions: the estimate needs a few weeks of data.'), factors }
  const score = Math.round((factors.reduce((s, f) => s + f.points, 0) / maxPts) * 100)
  const level = fatigueLevelOf(score)
  return { score, level, ...FATIGUE_LEVELS[level], factors, recommendation: recommendationFor(level, factors) }
}

/** Rule-based training recommendation (the coach decides). */
export function recommendationFor(level, factors) {
  const top = [...factors].sort((a, b) => b.points / b.max - a.points / a.max)[0]
  if (level === 'high') {
    if (top?.key === 'load') return 'Recovery may be needed: reduce volume 20–30% or add a rest day.'
    if (top?.key === 'recovery') return 'Recovery may be needed: schedule a rest or light day.'
    return 'Recovery may be needed: keep the next session light and short.'
  }
  if (level === 'moderate') {
    if (top?.key === 'intensity' || top?.key === 'acceleration') return 'Output is dropping: monitor and limit high-intensity drills.'
    return 'Monitor closely: avoid big increases in load this week.'
  }
  if (level === 'low') return 'Normal training can continue.'
  return 'Record a session to get a fatigue estimate.'
}
