import { useMemo, useState } from 'react'
import { PageHeader, StatRow, Badge, Avatar } from './ui'
import { computeFatigue, toFatigueRow, FATIGUE_LEVELS } from './fatigue'
import { metricsForSession } from './useCoachData'

const fmt = (n, p = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toFixed(p))
const stamp = (m) => new Date(m.completed_at || m.created_at).getTime()
const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0)

/** Period ranges, oldest first: last 8 weeks (Mon–Sun) or last 6 months. */
function periods(kind, now = new Date()) {
  const out = []
  if (kind === 'week') {
    const mon = new Date(now); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7))
    for (let i = 7; i >= 0; i--) {
      const from = new Date(mon); from.setDate(mon.getDate() - i * 7)
      const to = new Date(from); to.setDate(from.getDate() + 7)
      out.push({ from: +from, to: +to, label: from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) })
    }
  } else {
    for (let i = 5; i >= 0; i--) {
      const from = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      out.push({ from: +from, to: +to, label: from.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) })
    }
  }
  return out
}

const METRICS = {
  load: { label: 'Training load', unit: 'AU', of: (rows) => Math.round(sum(rows, (m) => +m.player_load_au)) },
  distance: { label: 'Distance covered', unit: 'km', of: (rows) => +(sum(rows, (m) => +m.meters) / 1000).toFixed(1) },
  sprints: { label: 'Sprint count', unit: '', of: (rows) => (rows.some((m) => m.sprints != null) ? sum(rows, (m) => +m.sprints) : null) },
  jumps: { label: 'Jump count', unit: '', of: (rows) => sum(rows, (m) => +m.jumps) },
  intensity: {
    label: 'Movement intensity', unit: 'm/min',
    of: (rows) => { const s = sum(rows, (m) => +m.total_seconds); return s >= 60 ? Math.round(sum(rows, (m) => +m.meters) / (s / 60)) : null },
  },
  heartRate: {
    label: 'Average heart rate', unit: 'bpm',
    of: (rows) => { const hr = rows.filter((m) => +m.avg_heart_rate > 30); return hr.length ? Math.round(sum(hr, (m) => +m.avg_heart_rate) / hr.length) : null },
  },
  fatigue: { label: 'Fatigue trend (team avg)', unit: '/100', of: null },
}

function Bars({ items, color = '', unit = '' }) {
  const max = Math.max(1, ...items.map((x) => x.value ?? 0))
  return (
    <div className="sa-bars">
      {items.map((x, i) => (
        <div className="sa-bar-col" key={i}>
          <div className="sa-bar-val">{x.value ?? '—'}</div>
          <div className={`sa-bar ${x.cls ?? color}`} style={{ height: `${Math.max(3, ((x.value ?? 0) / max) * 120)}px` }} title={`${x.value ?? '—'} ${unit}`} />
          <div className="sa-bar-lab">{x.label}</div>
        </div>
      ))}
    </div>
  )
}

const fatigueCls = (v) => (v == null ? '' : v >= 60 ? 'danger' : v >= 35 ? 'warn' : '')

export function Analytics({ d }) {
  const [kind, setKind] = useState('week')
  const [metric, setMetric] = useState('load')
  const [team, setTeam] = useState('All')
  const [sortKey, setSortKey] = useState('load')
  const [picked, setPicked] = useState([])

  const teams = ['All', ...new Set(d.roster.map((a) => a.team).filter(Boolean))]
  const roster = d.roster.filter((a) => team === 'All' || a.team === team)
  const ids = new Set(roster.map((a) => a.id))
  const metrics = d.metrics.filter((m) => ids.has(m.athlete_id))
  const ranges = useMemo(() => periods(kind), [kind])
  const cur = ranges[ranges.length - 1]
  const inRange = (r) => (m) => stamp(m) >= r.from && stamp(m) < r.to
  const curRows = metrics.filter(inRange(cur))

  // ── Performance / fatigue trends ──
  const trend = ranges.map((r) => {
    if (metric === 'fatigue') {
      const end = Math.min(r.to - 1, Date.now())
      const scores = roster
        .map((a) => computeFatigue(metrics.filter((m) => m.athlete_id === a.id).map(toFatigueRow), end).score)
        .filter((v) => v != null)
      const v = scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null
      return { label: r.label, value: v, cls: fatigueCls(v) }
    }
    return { label: r.label, value: METRICS[metric].of(metrics.filter(inRange(r))) }
  })

  // ── Training consistency: share of periods each athlete trained in ──
  const consistency = roster.map((a) => {
    const mine = metrics.filter((m) => m.athlete_id === a.id)
    const active = ranges.filter((r) => mine.some(inRange(r))).length
    return { a, active, pct: Math.round((active / ranges.length) * 100), sessions: mine.filter((m) => stamp(m) >= ranges[0].from).length }
  }).sort((x, y) => y.pct - x.pct || y.sessions - x.sessions)
  const teamConsistency = consistency.length ? Math.round(consistency.reduce((s, c) => s + c.pct, 0) / consistency.length) : 0

  // ── Workload distribution: by athlete and by drill type (current period) ──
  const totalLoad = sum(curRows, (m) => +m.player_load_au)
  const byAthlete = roster
    .map((a) => ({ a, load: sum(curRows.filter((m) => m.athlete_id === a.id), (m) => +m.player_load_au) }))
    .filter((x) => x.load > 0)
    .sort((x, y) => y.load - x.load)
  const byDrill = {}
  curRows.forEach((m) => (Array.isArray(m.drill_breakdown) ? m.drill_breakdown : []).forEach((dr) => {
    const k = dr.category || 'Other'
    byDrill[k] = byDrill[k] || { minutes: 0, sprints: 0, jumps: 0 }
    byDrill[k].minutes += (+dr.totalSeconds || 0) / 60
    byDrill[k].sprints += +dr.sprints || 0
    byDrill[k].jumps += +dr.jumps || 0
  }))
  const drillRows = Object.entries(byDrill).sort((x, y) => y[1].minutes - x[1].minutes)
  const drillMinutes = drillRows.reduce((s, [, v]) => s + v.minutes, 0)

  // ── Comparative athlete metrics (selected period) ──
  const compare = roster.map((a) => {
    const rows = curRows.filter((m) => m.athlete_id === a.id)
    const n = rows.length
    const secs = sum(rows, (m) => +m.total_seconds)
    const hasSprints = rows.some((m) => m.sprints != null)
    return {
      a, n,
      load: Math.round(sum(rows, (m) => +m.player_load_au)),
      distance: n ? sum(rows, (m) => +m.meters) / 1000 : null,
      sprints: hasSprints ? sum(rows, (m) => +m.sprints) : null,
      jumps: n ? sum(rows, (m) => +m.jumps) : null,
      intensity: secs >= 60 ? sum(rows, (m) => +m.meters) / (secs / 60) : null,
      topSpeed: rows.reduce((mx, m) => Math.max(mx, +m.max_speed_kmh || 0), 0) || null,
      hr: METRICS.heartRate.of(rows),
      fatigue: a.fatigue.score,
    }
  }).sort((x, y) => (y[sortKey] ?? -1) - (x[sortKey] ?? -1))
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-4)))
  const pickedRows = compare.filter((c) => picked.includes(c.a.id))

  // ── Session summaries ──
  const summaries = d.sessionRows
    .filter((s) => s.recorded > 0)
    .slice(0, 10)
    .map((s) => {
      const recs = metricsForSession(s, metrics)
      const n = recs.length || 1
      const avg = (f) => sum(recs, f) / n
      const top = [...recs].sort((x, y) => (+y.meters || 0) - (+x.meters || 0))[0]
      const topName = top ? d.roster.find((a) => a.id === top.athlete_id)?.short : null
      const notes = []
      if (top && topName) notes.push(`Most distance: ${topName} (${Math.round(top.meters)} m)`)
      const hrRecs = recs.filter((m) => +m.avg_heart_rate > 30)
      if (hrRecs.length) notes.push(`Avg HR ${Math.round(sum(hrRecs, (m) => +m.avg_heart_rate) / hrRecs.length)} bpm`)
      const early = recs.filter((m) => m.end_reason && m.end_reason !== 'completed').length
      if (early) notes.push(`${early} ended early`)
      return {
        s, athletes: new Set(recs.map((m) => m.athlete_id)).size,
        distance: avg((m) => +m.meters), sprints: recs.some((m) => m.sprints != null) ? sum(recs, (m) => +m.sprints) : null,
        jumps: sum(recs, (m) => +m.jumps), load: avg((m) => +m.player_load_au), notes,
      }
    })

  const sortTh = (key, label) => (
    <th role="button" onClick={() => setSortKey(key)} className={sortKey === key ? 'text-sa' : ''}>
      {label}{sortKey === key && <i className="bi bi-caret-down-fill ms-1" />}
    </th>
  )
  const periodName = kind === 'week' ? 'this week' : 'this month'
  const fatigueSeries = true // coaches see every metric

  return (
    <>
      <PageHeader crumb="Analytics" title="Performance analytics">
        <select className="form-select sa-select" value={team} onChange={(e) => setTeam(e.target.value)}>
          {teams.map((t) => <option key={t} value={t}>{t === 'All' ? 'All teams' : t}</option>)}
        </select>
        <div className="btn-group">
          <button className={`btn btn-sm ${kind === 'week' ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => setKind('week')}>Weekly</button>
          <button className={`btn btn-sm ${kind === 'month' ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => setKind('month')}>Monthly</button>
        </div>
      </PageHeader>

      <StatRow items={[
        { label: 'Distance covered', value: `${fmt(sum(curRows, (m) => +m.meters) / 1000, 1)} km`, note: periodName },
        { label: 'Sprint count', value: METRICS.sprints.of(curRows) ?? '—', note: periodName },
        { label: 'Jump count', value: sum(curRows, (m) => +m.jumps), note: periodName },
        { label: 'Training consistency', value: `${teamConsistency}%`, note: `${kind === 'week' ? 'weeks' : 'months'} with ≥1 session`, noteClass: 'text-sa' },
      ]} />

      <div className="row g-3 mb-3">
        <div className="col-lg-8">
          <div className="sa-card p-3 h-100">
            <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div>
                <div className="sa-card-title">{METRICS[metric].label} — {kind === 'week' ? 'weekly' : 'monthly'}</div>
                <div className="sa-card-sub">{team === 'All' ? 'Whole team' : team}{METRICS[metric].unit ? ` · ${METRICS[metric].unit}` : ''}</div>
              </div>
              <select className="form-select form-select-sm" style={{ maxWidth: 200 }} value={metric} onChange={(e) => setMetric(e.target.value)}>
                {Object.entries(METRICS).filter(([k]) => k !== 'fatigue' || fatigueSeries).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <Bars items={trend} unit={METRICS[metric].unit} />
            {metric === 'sprints' && <div className="sa-foot mt-2">Sprints (≥14 km/h for 1.5 s, wrist-estimated) are counted on sessions recorded with the latest app version.</div>}
            {metric === 'fatigue' && <div className="sa-foot mt-2">Average fatigue estimate at the end of each period. Decision-support estimate, not a medical assessment.</div>}
          </div>
        </div>
        <div className="col-lg-4">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title">Workload distribution</div>
            <div className="sa-card-sub mb-3">Share of team load {periodName}</div>
            {byAthlete.length === 0 && <div className="text-muted small">No load recorded {periodName}.</div>}
            {byAthlete.slice(0, 8).map((x) => (
              <div className="mb-2" key={x.a.id}>
                <div className="d-flex justify-content-between small fw-semibold mb-1"><span>{x.a.short}</span><span>{Math.round((x.load / totalLoad) * 100)}%</span></div>
                <div className="sa-progress"><span style={{ width: `${(x.load / totalLoad) * 100}%`, background: '#10a37f' }} /></div>
              </div>
            ))}
            {drillRows.length > 0 && (
              <>
                <div className="sa-card-sub mt-3 mb-2">Training time by drill type</div>
                {drillRows.map(([k, v]) => (
                  <div className="mb-2" key={k}>
                    <div className="d-flex justify-content-between small fw-semibold mb-1"><span>{k}</span><span>{Math.round(v.minutes)} min</span></div>
                    <div className="sa-progress"><span style={{ width: `${(v.minutes / drillMinutes) * 100}%`, background: '#2196f3' }} /></div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="sa-card p-3 mb-3">
        <div className="d-flex flex-wrap justify-content-between mb-2 gap-2">
          <div>
            <div className="sa-card-title">Comparative athlete metrics</div>
            <div className="sa-card-sub">{periodName} · click a column to sort · tick up to 4 athletes to compare</div>
          </div>
        </div>
        {pickedRows.length >= 2 && (
          <div className="row g-2 mb-3">
            {[['distance', 'Distance (km)', 1], ['sprints', 'Sprints', 0], ['jumps', 'Jumps', 0], ['intensity', 'Intensity (m/min)', 0], ['load', 'Load (AU)', 0]].map(([k, label, p]) => {
              const max = Math.max(1, ...pickedRows.map((c) => c[k] ?? 0))
              return (
                <div className="col-md" key={k}>
                  <div className="small fw-semibold mb-1">{label}</div>
                  {pickedRows.map((c) => (
                    <div key={c.a.id} className="mb-1">
                      <div className="d-flex justify-content-between small"><span>{c.a.short}</span><span>{fmt(c[k], p)}</span></div>
                      <div className="sa-progress"><span style={{ width: `${((c[k] ?? 0) / max) * 100}%`, background: '#10a37f' }} /></div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
        <div className="table-responsive">
          <table className="table sa-table">
            <thead><tr>
              <th />
              <th>Athlete</th>
              {sortTh('n', 'Sessions')}
              {sortTh('distance', 'Distance (km)')}
              {sortTh('sprints', 'Sprints')}
              {sortTh('jumps', 'Jumps')}
              {sortTh('intensity', 'Intensity (m/min)')}
              {sortTh('topSpeed', 'Top speed')}
              {sortTh('hr', 'Avg HR')}
              {sortTh('load', 'Load (AU)')}
              {fatigueSeries && sortTh('fatigue', 'Fatigue')}
            </tr></thead>
            <tbody>
              {compare.length === 0 && <tr><td colSpan={11} className="text-center text-muted py-4">No athletes.</td></tr>}
              {compare.map((c) => (
                <tr key={c.a.id}>
                  <td><input type="checkbox" className="form-check-input" checked={picked.includes(c.a.id)} onChange={() => toggle(c.a.id)} /></td>
                  <td><div className="d-flex align-items-center gap-2"><Avatar ini={c.a.ini} src={c.a.photo} small />{c.a.short}</div></td>
                  <td>{c.n}</td>
                  <td>{fmt(c.distance, 2)}</td>
                  <td>{fmt(c.sprints)}</td>
                  <td>{fmt(c.jumps)}</td>
                  <td>{fmt(c.intensity)}</td>
                  <td>{c.topSpeed ? `${fmt(c.topSpeed, 1)} km/h` : '—'}</td>
                  <td>{fmt(c.hr)}</td>
                  <td className="fw-semibold">{c.load}</td>
                  {fatigueSeries && <td>{c.fatigue != null ? <Badge color={FATIGUE_LEVELS[c.a.fatigue.level].badge}>{c.fatigue}</Badge> : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-5">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title">Training consistency</div>
            <div className="sa-card-sub mb-3">{kind === 'week' ? 'Weeks' : 'Months'} with at least one session (last {ranges.length})</div>
            {consistency.length === 0 && <div className="text-muted small">No athletes.</div>}
            {consistency.slice(0, 12).map((c) => (
              <div className="mb-2" key={c.a.id}>
                <div className="d-flex justify-content-between small fw-semibold mb-1"><span>{c.a.short}</span><span>{c.active}/{ranges.length} · {c.sessions} sessions</span></div>
                <div className="sa-progress"><span style={{ width: `${c.pct}%`, background: c.pct >= 75 ? '#10a37f' : c.pct >= 40 ? '#f5a623' : '#dc3545' }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="col-lg-7">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title">Session summaries</div>
            <div className="sa-card-sub mb-2">Latest recorded sessions</div>
            <div className="table-responsive">
              <table className="table sa-table">
                <thead><tr><th>Session</th><th>Athletes</th><th>Avg distance</th><th>Sprints</th><th>Jumps</th><th>Avg load</th></tr></thead>
                <tbody>
                  {summaries.length === 0 && <tr><td colSpan={6} className="text-center text-muted py-4">No recorded sessions yet.</td></tr>}
                  {summaries.map((x) => (
                    <tr key={x.s.id}>
                      <td>
                        <div className="fw-semibold">{x.s.title}</div>
                        <div className="small text-muted">{new Date(x.s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{x.notes.length ? ` · ${x.notes.join(' · ')}` : ''}</div>
                      </td>
                      <td>{x.athletes}</td>
                      <td>{Math.round(x.distance)} m</td>
                      <td>{x.sprints ?? '—'}</td>
                      <td>{x.jumps}</td>
                      <td>{fmt(x.load)} AU</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
