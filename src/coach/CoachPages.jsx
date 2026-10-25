import { PageHeader, StatRow, Badge, Avatar } from './ui'
import {
  weeklyLoad, readiness, athletes, acwrTeam, sessions, attendance, readinessBadge,
} from './data'

const acwrColor = (v) => (v > 1.5 ? 'danger' : v >= 1.3 ? 'warn' : '')
const readinessBadgeEl = (r) => (
  <Badge color={readinessBadge[r]} dot>{r}</Badge>
)

const PeriodSelect = ({ options }) => (
  <select className="form-select sa-select" defaultValue={options[0]}>
    {options.map((o) => <option key={o}>{o}</option>)}
  </select>
)

/* ------------------------------ Dashboard ------------------------------ */
export function Dashboard({ go }) {
  const max = Math.max(...weeklyLoad.map((d) => d.au))
  const total = readiness.reduce((a, r) => a + r.count, 0)
  return (
    <>
      <PageHeader crumb="Dashboard" title="Team overview">
        <PeriodSelect options={['This week', 'Last week', 'This month']} />
        <button className="btn btn-sa">Export report</button>
      </PageHeader>

      <StatRow items={[
        { label: 'Attendance', value: '92%', note: '8% vs last wk', noteClass: 'text-sa', icon: 'bi-caret-up-fill' },
        { label: 'Avg session load', value: '418 AU', note: '4%', noteClass: 'text-sa', icon: 'bi-caret-up-fill' },
        { label: 'Team ACWR', value: '1.18', note: '● watch zone', noteClass: 'text-warn' },
        { label: 'Flagged athletes', value: '2', note: 'high load', noteClass: 'text-danger-sa' },
      ]} />

      <div className="row g-3 mb-3">
        <div className="col-lg-7">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title">Weekly training load — team</div>
            <div className="sa-card-sub mb-3">Session load in arbitrary units (AU)</div>
            <div className="sa-bars">
              {weeklyLoad.map((d) => (
                <div className="sa-bar-col" key={d.day}>
                  <div className="sa-bar-val">{d.au}</div>
                  <div className="sa-bar" style={{ height: `${(d.au / max) * 120}px` }} title={`${d.au} AU`} />
                  <div className="sa-bar-lab">{d.day}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-lg-5">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title">Readiness distribution</div>
            <div className="sa-card-sub mb-3">Decision-support estimate</div>
            {readiness.map((r) => (
              <div className="mb-3" key={r.label}>
                <div className="d-flex justify-content-between fw-semibold small mb-1">
                  <span>{r.label}</span><span>{r.count}</span>
                </div>
                <div className="sa-progress">
                  <span style={{ width: `${(r.count / total) * 100}%`, background: r.color }} />
                </div>
              </div>
            ))}
            <div className="sa-foot">Estimates from movement + workload signals. Not a medical assessment.</div>
          </div>
        </div>
      </div>

      <div className="sa-card p-3">
        <div className="d-flex justify-content-between mb-2">
          <div className="sa-card-title">Athletes needing attention</div>
          <a href="#athletes" className="sa-link small" onClick={(e) => { e.preventDefault(); go('athletes') }}>
            View all athletes →
          </a>
        </div>
        <div className="table-responsive">
          <table className="table sa-table">
            <thead>
              <tr><th>Athlete</th><th>Position</th><th>Sessions (wk)</th><th>Load (AU)</th><th>ACWR</th><th>Readiness</th></tr>
            </thead>
            <tbody>
              {athletes.slice(0, 4).map((a) => (
                <tr key={a.name}>
                  <td><div className="d-flex align-items-center gap-2"><Avatar ini={a.ini} small /><span className="sa-link">{a.name}</span></div></td>
                  <td>{a.pos}</td>
                  <td className="text-warn fw-semibold">{a.sessions}</td>
                  <td>{a.load}</td>
                  <td>{a.acwr.toFixed(2)}</td>
                  <td>{readinessBadgeEl(a.readiness)}</td>
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
export function Athletes() {
  return (
    <>
      <PageHeader crumb="Athletes" title="Roster">
        <PeriodSelect options={['Filter: All positions', 'Guard', 'Forward', 'Center']} />
        <button className="btn btn-sa"><i className="bi bi-plus-lg me-1" />Add athlete</button>
      </PageHeader>
      <StatRow items={[
        { label: 'Roster', value: '12', note: 'athletes' },
        { label: 'Consents on file', value: '12/12', note: 'incl. parental', noteClass: 'text-sa' },
        { label: 'Active this week', value: '11', note: '≥1 session' },
        { label: 'Flagged', value: '2', note: 'high load', noteClass: 'text-danger-sa' },
      ]} />
      <div className="sa-card p-3">
        <div className="table-responsive">
          <table className="table sa-table">
            <thead>
              <tr><th>Athlete</th><th>Pos</th><th>#</th><th>Age</th><th>Consent</th><th>Device</th><th>Avg load</th><th>Readiness</th></tr>
            </thead>
            <tbody>
              {athletes.map((a) => (
                <tr key={a.name}>
                  <td><div className="d-flex align-items-center gap-2"><Avatar ini={a.ini} small />{a.name}</div></td>
                  <td>{a.pos}</td>
                  <td>{a.no}</td>
                  <td className={a.age < 18 ? 'text-danger-sa' : 'text-warn'}>{a.age}</td>
                  <td><Badge color="teal">{a.consent}</Badge></td>
                  <td>{a.device}</td>
                  <td className="text-warn fw-semibold">{a.load} AU</td>
                  <td>{readinessBadgeEl(a.readiness)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sa-foot mt-2">Enrollment requires a signed consent form on file before device assignment (BR-03).</div>
      </div>
    </>
  )
}

/* ------------------------------ Sessions ------------------------------ */
const typeBadge = { 'S&C': 'blue', Training: 'blue', Scrimmage: 'teal' }
const statusBadge = { Upcoming: 'amber', Completed: 'green' }

export function Sessions() {
  return (
    <>
      <PageHeader crumb="Sessions" title="Training sessions">
        <PeriodSelect options={['July 2026', 'June 2026']} />
        <button className="btn btn-sa"><i className="bi bi-plus-lg me-1" />New session</button>
      </PageHeader>
      <StatRow items={[
        { label: 'This week', value: '5', note: 'sessions' },
        { label: 'Avg attendance', value: '92%', note: '8%', noteClass: 'text-sa', icon: 'bi-caret-up-fill' },
        { label: 'Recorded athletes', value: '34', note: 'device-sessions' },
        { label: 'Pending sync', value: '0', note: 'all synced', noteClass: 'text-sa' },
      ]} />
      <div className="sa-card p-3">
        <div className="table-responsive">
          <table className="table sa-table">
            <thead>
              <tr><th>Date</th><th>Session</th><th>Type</th><th>Venue</th><th>Time</th><th>Attendance</th><th>Status</th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.date}>
                  <td className="sa-link">{s.date}</td>
                  <td>{s.name}</td>
                  <td><Badge color={typeBadge[s.type]}>{s.type}</Badge></td>
                  <td>{s.venue}</td>
                  <td>{s.time}</td>
                  <td>{s.attendance}</td>
                  <td><Badge color={statusBadge[s.status]}>{s.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sa-foot mt-2">Wearables record Training and S&amp;C sessions only; scrimmages are attendance-only (BR-08).</div>
      </div>
    </>
  )
}

/* ---------------------------- Load & Fatigue ---------------------------- */
const trendEl = (t) =>
  t === 'rising'
    ? <span className="text-danger-sa fw-semibold"><i className="bi bi-caret-up-fill me-1" />rising</span>
    : <span className="text-muted"><i className="bi bi-arrow-right me-1" />steady</span>

export function LoadFatigue() {
  const max = 1.6
  return (
    <>
      <PageHeader crumb="Load & Fatigue" title="Load & fatigue">
        <PeriodSelect options={['This week', 'Last 4 weeks']} />
      </PageHeader>
      <div className="row g-3 mb-3">
        <div className="col-lg-8">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title">Athlete ACWR — team view</div>
            <div className="sa-card-sub mb-3">Acute (7-day) vs chronic (28-day) workload ratio</div>
            <div className="sa-bars">
              {acwrTeam.map((d) => (
                <div className="sa-bar-col" key={d.k}>
                  <div className="sa-bar-val">{d.v.toFixed(2)}</div>
                  <div className={`sa-bar ${acwrColor(d.v)}`} style={{ height: `${(d.v / max) * 120}px` }} />
                  <div className="sa-bar-lab">{d.k}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title">How to read ACWR</div>
            <div className="sa-card-sub mb-3">Guidance for coaching decisions</div>
            <div className="d-flex align-items-center gap-2 mb-2"><Badge color="teal">0.8–1.3</Badge><span>Balanced zone — workload rising at a sustainable rate.</span></div>
            <div className="d-flex align-items-center gap-2 mb-2"><Badge color="amber">1.3–1.5</Badge><span>Watch zone — consider lighter volume or added recovery.</span></div>
            <div className="d-flex align-items-center gap-2 mb-3"><Badge color="red">&gt;1.5</Badge><span>High spike — review this athlete's plan before next session.</span></div>
            <div className="sa-foot">ACWR are coaching decision-support estimates, not medical assessments (BR-05).</div>
          </div>
        </div>
      </div>
      <div className="sa-card p-3">
        <div className="table-responsive">
          <table className="table sa-table">
            <thead>
              <tr><th>Athlete</th><th>Acute (7d)</th><th>Chronic (28d)</th><th>ACWR</th><th>Trend</th><th>Readiness</th><th>Suggested focus</th></tr>
            </thead>
            <tbody>
              {athletes.slice(0, 4).map((a) => (
                <tr key={a.name}>
                  <td><div className="d-flex align-items-center gap-2"><Avatar ini={a.ini} small />{a.short}</div></td>
                  <td>{a.acute} AU</td>
                  <td>{a.chronic} AU</td>
                  <td className="fw-semibold">{a.acwr.toFixed(2)}</td>
                  <td>{trendEl(a.trend)}</td>
                  <td>{readinessBadgeEl(a.readiness)}</td>
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
const statusColor = { Present: 'green', Late: 'amber' }

export function Attendance() {
  return (
    <>
      <PageHeader crumb="Attendance" title="Attendance">
        <PeriodSelect options={['Jul 22 — Full-court transition drills', 'Jul 21 — Half-court sets & shooting']} />
        <button className="btn btn-sa btn-sa-orange"><i className="bi bi-download me-1" />Export log</button>
      </PageHeader>
      <StatRow items={[
        { label: 'Present', value: '12/12', note: '100%', noteClass: 'text-danger-sa' },
        { label: 'Geofence check-ins', value: '11', note: 'automatic' },
        { label: 'Manual overrides', value: '1', note: 'flagged in report' },
        { label: 'Late', value: '1', note: '>15 min' },
      ]} />
      <div className="sa-card p-3">
        <div className="table-responsive">
          <table className="table sa-table">
            <thead>
              <tr><th>Athlete</th><th>Check-in</th><th>Method</th><th>Location</th><th>Status</th><th>Remark</th></tr>
            </thead>
            <tbody>
              {attendance.map((r) => (
                <tr key={r.name}>
                  <td><div className="d-flex align-items-center gap-2"><Avatar ini={r.ini} small />{r.name}</div></td>
                  <td>{r.time}</td>
                  <td><Badge color={r.method === 'Manual' ? 'amber' : 'teal'}>{r.method}</Badge></td>
                  <td>{r.loc}</td>
                  <td><Badge color={statusColor[r.status]}>{r.status}</Badge></td>
                  <td className="text-muted">{r.remark}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sa-foot mt-2">Check-in records once per athlete per session, inside the venue geofence (BR-04). Manual overrides require a coach remark.</div>
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
