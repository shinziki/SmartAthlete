import { useState } from 'react'
import { PageHeader, StatRow, Badge, Avatar } from './ui'
import { readinessBadge, metricsForSession } from './useCoachData'

const acwrColor = (v) => (v == null ? '' : v >= 1.5 ? 'danger' : v >= 1.3 ? 'warn' : '')
const fmt = (n, p = 1) => (n == null ? '—' : Number(n).toFixed(p))
const readinessEl = (r) => <Badge color={readinessBadge[r]} dot>{r}</Badge>
const Empty = ({ cols, text }) => (
  <tr><td colSpan={cols} className="text-center text-muted py-4">{text}</td></tr>
)
const niceDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const timeOf = (t) => (t ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—')
const cleanTime = (t) => (t || '—').replace(/\?/g, ' ')

const Select = ({ value, onChange, options }) => (
  <select className="form-select sa-select" value={value} onChange={(e) => onChange(e.target.value)}>
    {options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
  </select>
)

/* ------------------------------ Dashboard ------------------------------ */
export function Dashboard({ d, go }) {
  const max = Math.max(1, ...d.weekly.map((x) => x.au))
  const total = d.roster.length || 1
  const rd = [
    { label: 'Ready', color: '#10a37f', n: d.counts.Ready },
    { label: 'Moderate', color: '#f5a623', n: d.counts.Moderate },
    { label: 'Watch — high load', color: '#dc3545', n: d.counts.Watch },
    { label: 'No data', color: '#9ca3af', n: d.counts['No data'] },
  ]
  const attention = [...d.roster].sort((a, b) => (b.acwr ?? -1) - (a.acwr ?? -1)).slice(0, 5)
  return (
    <>
      <PageHeader crumb="Dashboard" title="Team overview" />
      <StatRow items={[
        { label: 'Active this week', value: `${d.activeWk}/${d.roster.length}`, note: '≥1 recorded session', noteClass: 'text-sa' },
        { label: 'Avg session load', value: `${fmt(d.avgSessionLoad)} AU`, note: 'last 7 days' },
        { label: 'Team ACWR', value: fmt(d.teamAcwr, 2), note: d.teamAcwr == null ? 'not enough data' : d.teamAcwr >= 1.3 ? '● watch zone' : '● balanced', noteClass: d.teamAcwr >= 1.3 ? 'text-warn' : 'text-sa' },
        { label: 'Flagged athletes', value: d.flagged.length, note: 'high load', noteClass: d.flagged.length ? 'text-danger-sa' : 'text-sa' },
      ]} />

      <div className="row g-3 mb-3">
        <div className="col-lg-7">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title">Weekly training load — team</div>
            <div className="sa-card-sub mb-3">Player load in arbitrary units (AU), last 7 days</div>
            <div className="sa-bars">
              {d.weekly.map((x, i) => (
                <div className="sa-bar-col" key={i}>
                  <div className="sa-bar-val">{x.au}</div>
                  <div className="sa-bar" style={{ height: `${Math.max(3, (x.au / max) * 120)}px` }} title={`${x.au} AU`} />
                  <div className="sa-bar-lab">{x.day}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-lg-5">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title">Readiness distribution</div>
            <div className="sa-card-sub mb-3">Decision-support estimate</div>
            {rd.map((r) => (
              <div className="mb-3" key={r.label}>
                <div className="d-flex justify-content-between fw-semibold small mb-1"><span>{r.label}</span><span>{r.n}</span></div>
                <div className="sa-progress"><span style={{ width: `${(r.n / total) * 100}%`, background: r.color }} /></div>
              </div>
            ))}
            <div className="sa-foot">Estimates from workload signals (ACWR). Not a medical assessment.</div>
          </div>
        </div>
      </div>

      <div className="sa-card p-3">
        <div className="d-flex justify-content-between mb-2">
          <div className="sa-card-title">Athletes needing attention</div>
          <a href="#athletes" className="sa-link small" onClick={(e) => { e.preventDefault(); go('athletes') }}>View all athletes →</a>
        </div>
        <div className="table-responsive">
          <table className="table sa-table">
            <thead><tr><th>Athlete</th><th>Gender</th><th>Sessions (wk)</th><th>Load 7d (AU)</th><th>ACWR</th><th>Readiness</th></tr></thead>
            <tbody>
              {attention.length === 0 && <Empty cols={6} text="No athletes registered yet." />}
              {attention.map((a) => (
                <tr key={a.id}>
                  <td><div className="d-flex align-items-center gap-2"><Avatar ini={a.ini} small /><span className="sa-link">{a.name}</span></div></td>
                  <td>{a.gender || '—'}</td>
                  <td className="text-warn fw-semibold">{a.sessionsWk}</td>
                  <td>{fmt(a.load7)}</td>
                  <td>{fmt(a.acwr, 2)}</td>
                  <td>{readinessEl(a.readiness)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ------------------------------ Athletes ------------------------------ */
export function Athletes({ d }) {
  const [gender, setGender] = useState('All')
  const rows = d.roster.filter((a) => gender === 'All' || a.gender === gender)
  const genders = ['All', ...new Set(d.roster.map((a) => a.gender).filter(Boolean))]
  return (
    <>
      <PageHeader crumb="Athletes" title="Roster">
        <Select value={gender} onChange={setGender} options={genders.map((g) => ({ value: g, label: g === 'All' ? 'Filter: All genders' : g }))} />
      </PageHeader>
      <StatRow items={[
        { label: 'Roster', value: d.roster.length, note: 'registered athletes' },
        { label: 'Recorded sessions', value: d.metrics.length, note: 'all time', noteClass: 'text-sa' },
        { label: 'Active this week', value: d.activeWk, note: '≥1 session' },
        { label: 'Flagged', value: d.flagged.length, note: 'high load', noteClass: 'text-danger-sa' },
      ]} />
      <div className="sa-card p-3">
        <div className="table-responsive">
          <table className="table sa-table">
            <thead><tr><th>Athlete</th><th>Username</th><th>Gender</th><th>Age</th><th>Email</th><th>Sessions</th><th>Avg load</th><th>Readiness</th></tr></thead>
            <tbody>
              {rows.length === 0 && <Empty cols={8} text="No athletes found." />}
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><div className="d-flex align-items-center gap-2"><Avatar ini={a.ini} small />{a.name}</div></td>
                  <td>{a.username}</td>
                  <td>{a.gender || '—'}</td>
                  <td className={a.age != null && a.age < 18 ? 'text-danger-sa' : ''}>{a.age ?? '—'}</td>
                  <td>{a.email}</td>
                  <td>{a.totalSessions}</td>
                  <td className="text-warn fw-semibold">{fmt(a.avgLoad)} AU</td>
                  <td>{readinessEl(a.readiness)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ------------------------------ Sessions ------------------------------ */
const typeBadge = { training: 'blue', conditioning: 'blue', 'strength': 'blue', scrimmage: 'teal' }
const statusBadge = { Upcoming: 'amber', Completed: 'green' }
const typeLabel = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ') : '—')

export function Sessions({ d }) {
  const months = [...new Set(d.sessionRows.map((s) => s.date?.slice(0, 7)))].filter(Boolean)
  const [month, setMonth] = useState('all')
  const rows = d.sessionRows.filter((s) => month === 'all' || s.date?.startsWith(month))
  const monthLabel = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const rosterSize = d.roster.length
  const done = rows.filter((s) => s.status === 'Completed')
  const avgAtt = done.length && rosterSize ? Math.round((done.reduce((s, r) => s + r.present, 0) / (done.length * rosterSize)) * 100) : 0
  return (
    <>
      <PageHeader crumb="Sessions" title="Training sessions">
        <Select value={month} onChange={setMonth} options={[{ value: 'all', label: 'All months' }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))]} />
      </PageHeader>
      <StatRow items={[
        { label: 'This week', value: d.sessionsThisWeek, note: 'sessions' },
        { label: 'Avg attendance', value: `${avgAtt}%`, note: 'recorded athletes / roster', noteClass: 'text-sa' },
        { label: 'Recorded athletes', value: d.metrics.length, note: 'device-sessions' },
        { label: 'Total sessions', value: d.sessions.length, note: 'created by coaches' },
      ]} />
      <div className="sa-card p-3">
        <div className="table-responsive">
          <table className="table sa-table">
            <thead><tr><th>Date</th><th>Session</th><th>Type</th><th>Venue</th><th>Time</th><th>Duration</th><th>Attendance</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <Empty cols={8} text="No sessions yet." />}
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="sa-link">{niceDate(s.date)}</td>
                  <td>{s.title}</td>
                  <td><Badge color={typeBadge[s.session_type] || 'blue'}>{typeLabel(s.session_type)}</Badge></td>
                  <td>{s.venue_name || typeLabel(s.location_type)}</td>
                  <td>{cleanTime(s.start_time)} – {cleanTime(s.end_time)}</td>
                  <td>{s.total_duration_minutes ? `${s.total_duration_minutes} min` : '—'}</td>
                  <td>{s.status === 'Upcoming' ? '—' : `${s.present}/${rosterSize}`}</td>
                  <td><Badge color={statusBadge[s.status]}>{s.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ---------------------------- Load & Fatigue ---------------------------- */
const trendEl = (t) =>
  t === 'rising'
    ? <span className="text-danger-sa fw-semibold"><i className="bi bi-caret-up-fill me-1" />rising</span>
    : <span className="text-muted"><i className="bi bi-arrow-right me-1" />steady</span>

export function LoadFatigue({ d }) {
  const bars = d.roster.filter((a) => a.acwr != null)
  const max = Math.max(1.6, ...bars.map((a) => a.acwr))
  return (
    <>
      <PageHeader crumb="Load & Fatigue" title="Load & fatigue" />
      <div className="row g-3 mb-3">
        <div className="col-lg-8">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title">Athlete ACWR — team view</div>
            <div className="sa-card-sub mb-3">Acute (7-day) vs chronic (28-day) workload ratio</div>
            {bars.length === 0 ? (
              <div className="text-muted text-center py-5">No recorded sessions in the last 28 days.</div>
            ) : (
              <div className="sa-bars">
                {bars.map((a) => (
                  <div className="sa-bar-col" key={a.id}>
                    <div className="sa-bar-val">{a.acwr.toFixed(2)}</div>
                    <div className={`sa-bar ${acwrColor(a.acwr)}`} style={{ height: `${(a.acwr / max) * 120}px` }} />
                    <div className="sa-bar-lab">{a.ini}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="col-lg-4">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title">How to read ACWR</div>
            <div className="sa-card-sub mb-3">Guidance for coaching decisions</div>
            <div className="d-flex align-items-center gap-2 mb-2"><Badge color="teal">&lt;1.0</Badge><span>Ready — workload at or below baseline.</span></div>
            <div className="d-flex align-items-center gap-2 mb-2"><Badge color="amber">1.0–1.3</Badge><span>Moderate — workload rising at a sustainable rate.</span></div>
            <div className="d-flex align-items-center gap-2 mb-3"><Badge color="red">≥1.3</Badge><span>Watch — consider lighter volume or added recovery.</span></div>
            <div className="sa-foot">ACWR values are coaching decision-support estimates, not medical assessments.</div>
          </div>
        </div>
      </div>
      <div className="sa-card p-3">
        <div className="table-responsive">
          <table className="table sa-table">
            <thead><tr><th>Athlete</th><th>Acute (7d)</th><th>Chronic (28d avg/wk)</th><th>ACWR</th><th>Trend</th><th>Readiness</th><th>Suggested focus</th></tr></thead>
            <tbody>
              {d.roster.length === 0 && <Empty cols={7} text="No athletes registered yet." />}
              {d.roster.map((a) => (
                <tr key={a.id}>
                  <td><div className="d-flex align-items-center gap-2"><Avatar ini={a.ini} small />{a.short}</div></td>
                  <td>{fmt(a.acute)} AU</td>
                  <td>{fmt(a.chronic)} AU</td>
                  <td className="fw-semibold">{fmt(a.acwr, 2)}</td>
                  <td>{trendEl(a.trend)}</td>
                  <td>{readinessEl(a.readiness)}</td>
                  <td>{a.focus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ------------------------------ Attendance ------------------------------ */
export function Attendance({ d }) {
  const list = d.sessionRows
  const [sel, setSel] = useState('')
  const session = list.find((s) => String(s.id) === sel) || list.find((s) => s.recorded > 0) || list[0]
  const recs = session ? metricsForSession(session, d.metrics) : []
  const byId = Object.fromEntries(d.roster.map((a) => [a.id, a]))
  const present = new Set(recs.map((r) => r.athlete_id)).size
  const avgHr = recs.length ? Math.round(recs.reduce((s, r) => s + (r.avg_heart_rate || 0), 0) / recs.length) : null
  return (
    <>
      <PageHeader crumb="Attendance" title="Attendance">
        {session && (
          <Select
            value={String(session.id)}
            onChange={setSel}
            options={list.map((s) => ({ value: String(s.id), label: `${niceDate(s.date)} — ${s.title}` }))}
          />
        )}
      </PageHeader>
      <StatRow items={[
        { label: 'Present', value: `${present}/${d.roster.length}`, note: d.roster.length ? `${Math.round((present / d.roster.length) * 100)}%` : '—', noteClass: 'text-sa' },
        { label: 'Watch recordings', value: recs.length, note: 'device data synced' },
        { label: 'Absent', value: Math.max(0, d.roster.length - present), note: 'no recording' },
        { label: 'Avg heart rate', value: avgHr ?? '—', note: 'bpm' },
      ]} />
      <div className="sa-card p-3">
        <div className="table-responsive">
          <table className="table sa-table">
            <thead><tr><th>Athlete</th><th>Recorded at</th><th>Device</th><th>Duration</th><th>Avg HR</th><th>Load (AU)</th><th>Status</th></tr></thead>
            <tbody>
              {!session && <Empty cols={7} text="No sessions yet." />}
              {session && recs.length === 0 && <Empty cols={7} text="No athlete recordings for this session." />}
              {recs.map((r) => {
                const a = byId[r.athlete_id]
                return (
                  <tr key={r.id}>
                    <td><div className="d-flex align-items-center gap-2"><Avatar ini={a?.ini || '?'} small />{a?.short || `Athlete #${r.athlete_id}`}</div></td>
                    <td>{timeOf(r.completed_at || r.created_at)}</td>
                    <td><Badge color="teal">{r.watch_name || 'Device'}</Badge></td>
                    <td>{r.total_seconds != null ? `${Math.floor(r.total_seconds / 60)}m ${r.total_seconds % 60}s` : '—'}</td>
                    <td>{r.avg_heart_rate ?? '—'}</td>
                    <td>{fmt(r.player_load_au)}</td>
                    <td><Badge color="green">Present</Badge></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="sa-foot mt-2">Attendance is inferred from smartwatch session recordings synced to Supabase.</div>
      </div>
    </>
  )
}

/* ------------------------------ Placeholder ------------------------------ */
export function Placeholder({ title, icon }) {
  return (
    <>
      <PageHeader crumb={title} title={title} />
      <div className="sa-card p-5 text-center text-muted">
        <i className={`bi ${icon} fs-1 text-sa`} />
        <p className="mt-2 mb-0">{title} will be available in a future release.</p>
      </div>
    </>
  )
}
