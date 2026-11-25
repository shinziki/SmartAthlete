import { useEffect, useRef, useState } from 'react'
import { PageHeader, StatRow, Badge, Avatar } from './ui'
import { FATIGUE_LEVELS } from './fatigue'
import { readinessBadge, readinessOf, acwrBarClass, metricsForSession, saveJerseyNumber, saveTeam, JERSEY_NUMBER_PATTERN } from './useCoachData'
import { cleanTime, niceDate, statusBadge, typeBadge, typeLabel } from './format'
import { SessionDetail } from './SessionDetail'

const acwrColor = (v) => (v == null ? '' : acwrBarClass(v))
const teamZoneClass = { 'High load': 'text-danger-sa', Elevated: 'text-warn', Undertraining: 'text-warn', Optimal: 'text-sa' }
const fmt = (n, p = 1) => (n == null ? '—' : Number(n).toFixed(p))
const readinessEl = (r) => <Badge color={readinessBadge[r]} dot>{r}</Badge>
const fatigueEl = (f) => (
  <span title={f.factors.map((x) => `${x.label}: ${x.points}/${x.max} — ${x.detail}`).join(String.fromCharCode(10))}>
    <Badge color={FATIGUE_LEVELS[f.level].badge} dot>{f.score != null ? `${f.score} · ${f.label}` : f.label}</Badge>
  </span>
)
const Empty = ({ cols, text }) => (
  <tr><td colSpan={cols} className="text-center text-muted py-4">{text}</td></tr>
)
const timeOf = (t) => (t ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—')

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
    { label: 'Optimal (0.80–1.30)', color: '#10a37f', n: d.counts.Optimal },
    { label: 'Elevated (1.31–1.50)', color: '#f5a623', n: d.counts.Elevated },
    { label: 'High load (above 1.50)', color: '#dc3545', n: d.counts['High load'] },
    { label: 'Undertraining (below 0.80)', color: '#2196f3', n: d.counts.Undertraining },
    { label: 'Building baseline (< 28 days)', color: '#14b8a6', n: d.counts['Building baseline'] },
    { label: 'No data', color: '#9ca3af', n: d.counts['No data'] },
  ]
  const attention = [...d.roster].sort((a, b) => (b.fatigue.score ?? -1) - (a.fatigue.score ?? -1) || (b.acwr ?? -1) - (a.acwr ?? -1)).slice(0, 5)
  return (
    <>
      <PageHeader crumb="Dashboard" title="Team overview" />
      <StatRow items={[
        { label: 'Active this week', value: `${d.activeWk}/${d.roster.length}`, note: '≥1 recorded session', noteClass: 'text-sa' },
        { label: 'Avg session load', value: `${fmt(d.avgSessionLoad)} AU`, note: 'last 7 days' },
        { label: 'Team ACWR', value: fmt(d.teamAcwr, 2), note: d.teamAcwr == null ? 'not enough data' : `● ${readinessOf(d.teamAcwr).toLowerCase()}`, noteClass: teamZoneClass[readinessOf(d.teamAcwr)] || '' },
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

      <div className="sa-card p-3 mb-3">
        <div className="d-flex justify-content-between mb-2">
          <div className="sa-card-title"><i className="bi bi-bell-fill me-2 text-sa" />Alerts</div>
          <span className="small text-muted">{d.alerts.length} active</span>
        </div>
        {d.alerts.length === 0 && <div className="text-muted small py-2">No alerts: no athlete has unusually high load, needs recovery or has data waiting to sync.</div>}
        {d.alerts.slice(0, 8).map((al, i) => (
          <div key={i} className="d-flex align-items-start gap-2 py-2 border-top">
            <Badge color={al.color}><i className={`bi ${al.icon}`} /></Badge>
            <div className="flex-grow-1">
              <div className="fw-semibold small">{al.title}{al.athlete ? ` — ${al.athlete.name}` : ''}</div>
              <div className="small text-muted">{al.text}</div>
            </div>
          </div>
        ))}
        {d.alerts.length > 8 && <div className="small text-muted mt-1">+{d.alerts.length - 8} more</div>}
      </div>

      <div className="sa-card p-3">
        <div className="d-flex justify-content-between mb-2">
          <div className="sa-card-title">Athletes needing attention</div>
          <a href="#athletes" className="sa-link small" onClick={(e) => { e.preventDefault(); go('athletes') }}>View all athletes →</a>
        </div>
        <div className="table-responsive">
          <table className="table sa-table">
            <thead><tr><th>Athlete</th><th>Gender</th><th>Sessions (wk)</th><th>Load 7d (AU)</th><th>ACWR</th><th>Readiness</th><th>Fatigue</th></tr></thead>
            <tbody>
              {attention.length === 0 && <Empty cols={7} text="No athletes registered yet." />}
              {attention.map((a) => (
                <tr key={a.id}>
                  <td><div className="d-flex align-items-center gap-2"><Avatar ini={a.ini} small /><span className="sa-link">{a.name}</span></div></td>
                  <td>{a.gender || '—'}</td>
                  <td className="text-warn fw-semibold">{a.sessionsWk}</td>
                  <td>{fmt(a.load7)}</td>
                  <td>{fmt(a.acwr, 2)}</td>
                  <td>{readinessEl(a.readiness)}</td>
                  <td>{fatigueEl(a.fatigue)}</td>
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

/** Jersey number cell: click to assign/change, Enter saves, Esc cancels, empty clears. */
function JerseyCell({ athlete, roster, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const current = athlete.jersey_number ?? null
  const v = value.trim()
  const holder = v ? roster.find((r) => r.jersey_number === v && r.id !== athlete.id) : null
  const problem = v && !JERSEY_NUMBER_PATTERN.test(v)
    ? 'Use 0, 00, or 1–99'
    : holder ? `Worn by ${holder.name}` : error

  const start = () => { setValue(current ?? ''); setError(null); setEditing(true) }
  const save = async () => {
    if (holder || (v && !JERSEY_NUMBER_PATTERN.test(v))) return
    if ((v || null) === current) { setEditing(false); return }
    setSaving(true); setError(null)
    try {
      await saveJerseyNumber(athlete.id, v || null)
      setEditing(false)
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <button type="button" className="btn btn-sm btn-outline-secondary fw-bold" onClick={start}
        title={current ? 'Change jersey number' : 'Assign jersey number'}>
        {current ? `#${current}` : '#—'}
      </button>
    )
  }
  return (
    <div style={{ minWidth: 110 }}>
      <div className="input-group input-group-sm">
        <span className="input-group-text">#</span>
        <input
          className={`form-control ${problem ? 'is-invalid' : ''}`}
          value={value}
          autoFocus
          inputMode="numeric"
          maxLength={2}
          disabled={saving}
          placeholder="—"
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          onBlur={() => { if (!saving && !problem) save() }}
        />
      </div>
      {problem && <div className="small text-danger mt-1">{problem}</div>}
    </div>
  )
}

/** Team cell: click to assign or change the athlete's team. */
function TeamCell({ athlete, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const current = athlete.team ?? null
  const save = async () => {
    if ((value.trim() || null) === current) { setEditing(false); return }
    setSaving(true); setError(null)
    try { await saveTeam(athlete.id, value); setEditing(false); onSaved?.() } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  if (!editing) {
    return (
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setValue(current ?? ''); setError(null); setEditing(true) }}>
        {current || 'Assign'}
      </button>
    )
  }
  return (
    <div style={{ minWidth: 150 }}>
      <input className={`form-control form-control-sm ${error ? 'is-invalid' : ''}`} value={value} autoFocus disabled={saving}
        placeholder="e.g. Men's Varsity" maxLength={40}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        onBlur={() => { if (!saving) save() }} />
      {error && <div className="small text-danger mt-1">{error}</div>}
    </div>
  )
}

const injuryText = (list) => list.map((i) => `${i.injury}${i.body_part ? ` (${i.body_part})` : ''}${i.injured_on ? ` · ${i.injured_on}` : ''} · ${i.status}`).join(String.fromCharCode(10))

export function Athletes({ d, onChanged }) {
  const [gender, setGender] = useState('All')
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase().replace(/^#/, '')
  const rows = d.roster
    .filter((a) => gender === 'All' || a.gender === gender)
    .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.username || '').toLowerCase().includes(q) || (a.team || '').toLowerCase().includes(q) || a.jersey_number === q)
  const genders = ['All', ...new Set(d.roster.map((a) => a.gender).filter(Boolean))]
  return (
    <>
      <PageHeader crumb="Athletes" title="Roster">
        <input className="form-control sa-select" style={{ maxWidth: 220 }} placeholder="Search name, team or #number" value={query} onChange={(e) => setQuery(e.target.value)} />
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
            <thead><tr><th>#</th><th>Athlete</th><th>Team</th><th>Position</th><th>Ht / Wt</th><th>Gender</th><th>Age</th><th>Injuries</th><th>Sessions</th><th>Avg load</th><th>Readiness</th></tr></thead>
            <tbody>
              {rows.length === 0 && <Empty cols={11} text="No athletes found." />}
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><JerseyCell athlete={a} roster={d.roster} onSaved={onChanged} /></td>
                  <td><div className="d-flex align-items-center gap-2"><Avatar ini={a.ini} small /><div>{a.name}<div className="small text-muted">{a.username}</div></div></div></td>
                  <td><TeamCell athlete={a} onSaved={onChanged} /></td>
                  <td>{a.position || '—'}</td>
                  <td className="text-nowrap">{a.height_cm ? `${a.height_cm} cm` : '—'} / {a.weight_kg ? `${a.weight_kg} kg` : '—'}</td>
                  <td>{a.gender || '—'}</td>
                  <td className={a.age != null && a.age < 18 ? 'text-danger-sa' : ''}>{a.age ?? '—'}</td>
                  <td>
                    {!a.injury_consent
                      ? <span className="text-muted small">Not shared</span>
                      : a.injuries.length === 0
                        ? <span className="text-muted small">None</span>
                        : <span title={injuryText(a.injuries)}><Badge color={a.injuries.some((i) => i.status === 'recovering') ? 'red' : 'amber'}>{a.injuries.length} listed</Badge></span>}
                  </td>
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

/** The session open in the detail view, from the address (#session-12), or null. */
const sessionIdFromHash = () => (window.location.hash.match(/^#session-(\d+)$/) || [])[1] || null

export function Sessions({ d }) {
  const months = [...new Set(d.sessionRows.map((s) => s.date?.slice(0, 7)))].filter(Boolean)
  const [month, setMonth] = useState('all')

  // Detail view: its own address, so the browser's Back button returns to the list and a
  // reload keeps the session open
  const [openId, setOpenId] = useState(sessionIdFromHash)
  const pushed = useRef(false)
  const listScroll = useRef(0)
  useEffect(() => {
    const onPop = () => setOpenId(sessionIdFromHash())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  // Back on the list: where it was scrolled to
  const wasOpen = useRef(!!openId)
  useEffect(() => {
    // 'instant': Bootstrap makes page scrolling smooth, which would animate these jumps.
    // The list is already on the page here, so no need to wait for a frame.
    if (openId) window.scrollTo({ top: 0, behavior: 'instant' })
    else if (wasOpen.current) window.scrollTo({ top: listScroll.current, behavior: 'instant' })
    wasOpen.current = !!openId
  }, [openId])
  const openSession = (id) => {
    listScroll.current = window.scrollY
    window.history.pushState(null, '', `#session-${id}`)
    pushed.current = true
    setOpenId(String(id))
  }
  const closeSession = () => {
    if (pushed.current) {
      pushed.current = false
      window.history.back() // popstate closes it
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setOpenId(null)
    }
  }

  if (openId) {
    return <SessionDetail d={d} session={d.sessionRows.find((s) => String(s.id) === openId)} onBack={closeSession} />
  }

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
            <thead><tr><th>Date</th><th>Session</th><th>Type</th><th>Venue</th><th>Time</th><th>Duration</th><th>Attendance</th><th>Status</th><th aria-label="Open" /></tr></thead>
            <tbody>
              {rows.length === 0 && <Empty cols={9} text="No sessions yet." />}
              {rows.map((s) => (
                <tr key={s.id} className="sa-row-link" onClick={() => openSession(s.id)}>
                  <td>{niceDate(s.date)}</td>
                  {/* A real button for the keyboard; its click reaches the row */}
                  <td><button className="sa-linkbtn" aria-label={`Open ${s.title}, ${niceDate(s.date)}`}>{s.title}</button></td>
                  <td><Badge color={typeBadge[s.session_type] || 'blue'}>{typeLabel(s.session_type)}</Badge></td>
                  <td>{s.venue_name || typeLabel(s.location_type)}</td>
                  <td>{cleanTime(s.start_time)} – {cleanTime(s.end_time)}</td>
                  <td>{s.total_duration_minutes ? `${s.total_duration_minutes} min` : '—'}</td>
                  <td>{s.status === 'Upcoming' ? '—' : `${s.present}/${rosterSize}`}</td>
                  <td><Badge color={statusBadge[s.status]}>{s.status}</Badge></td>
                  <td className="text-end"><i className="bi bi-chevron-right sa-row-chev" aria-hidden="true" /></td>
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
              <div className="text-muted text-center py-5">No athlete has 28 days of history yet: ACWR appears once the baseline is complete.</div>
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
            <div className="d-flex align-items-center gap-2 mb-2"><Badge color="blue">&lt;0.80</Badge><span>Undertraining — load is below the athlete's usual level.</span></div>
            <div className="d-flex align-items-center gap-2 mb-2"><Badge color="green">0.80–1.30</Badge><span>Optimal — load is in the target range.</span></div>
            <div className="d-flex align-items-center gap-2 mb-2"><Badge color="amber">1.31–1.50</Badge><span>Elevated — monitor closely.</span></div>
            <div className="d-flex align-items-center gap-2 mb-3"><Badge color="red">&gt;1.50</Badge><span>High load — reduce load.</span></div>
            <div className="sa-card-sub mb-2"><b>Fatigue estimate (0–100)</b> combines training load (ACWR), drops in movement intensity and accelerations, heart-rate trends and rest days, each compared with the athlete's own usual level. ≥60 = recovery may be needed.</div>
            <div className="sa-foot">ACWR and fatigue values are coaching decision-support estimates, not medical assessments.</div>
          </div>
        </div>
      </div>
      <div className="sa-card p-3">
        <div className="table-responsive">
          <table className="table sa-table">
            <thead><tr><th>Athlete</th><th>Acute (7d)</th><th>Chronic (28d avg/wk)</th><th>ACWR</th><th>Trend</th><th>Readiness</th><th>Fatigue</th><th>Training recommendation</th></tr></thead>
            <tbody>
              {d.roster.length === 0 && <Empty cols={8} text="No athletes registered yet." />}
              {d.roster.map((a) => (
                <tr key={a.id}>
                  <td><div className="d-flex align-items-center gap-2"><Avatar ini={a.ini} small />{a.short}</div></td>
                  <td>{fmt(a.acute)} AU</td>
                  <td>{fmt(a.chronic)} AU</td>
                  <td className="fw-semibold">{fmt(a.acwr, 2)}</td>
                  <td>{trendEl(a.trend)}</td>
                  <td>{readinessEl(a.readiness)}</td>
                  <td>{fatigueEl(a.fatigue)}</td>
                  <td className="small">{a.focus}</td>
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
