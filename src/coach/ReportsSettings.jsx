import { useMemo, useState } from 'react'
import { PageHeader, StatRow, Badge } from './ui'
import { dayKey, metricsForSession } from './useCoachData'
import { supabase } from '../supabaseClient'

const num = (n, p = 1) => (n == null || Number.isNaN(n) ? '\u2014' : Number(n).toFixed(p))
const mDay = (m) => dayKey(m.completed_at || m.created_at)

function downloadCsv(name, cols, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

const REPORTS = {
  team: { label: 'Team workload summary', icon: 'bi-people-fill', desc: 'Per-athlete sessions, load, heart rate, distance and readiness.' },
  athlete: { label: 'Individual athlete report', icon: 'bi-person-lines-fill', desc: 'Session-by-session workload for one athlete.' },
  attendance: { label: 'Session attendance log', icon: 'bi-clipboard-check-fill', desc: 'Who recorded each session, with attendance rate and absentees.' },
}

export function Reports({ d, user }) {
  const today = dayKey(Date.now())
  const [type, setType] = useState('team')
  const [from, setFrom] = useState(dayKey(Date.now() - 28 * 86400000))
  const [to, setTo] = useState(today)
  const [athleteId, setAthleteId] = useState('')

  const athlete = d.roster.find((a) => String(a.id) === athleteId) || d.roster[0]
  const inRange = (day) => day >= from && day <= to

  const report = useMemo(() => {
    const ms = d.metrics.filter((m) => inRange(mDay(m)))
    if (type === 'team') {
      const rows = d.roster.map((a) => {
        const mine = ms.filter((m) => m.athlete_id === a.id)
        const sum = (k) => mine.reduce((s, m) => s + (+m[k] || 0), 0)
        const hr = mine.filter((m) => m.avg_heart_rate)
        return {
          athlete: a.name, sessions: mine.length, totalLoad: num(sum('player_load_au')),
          avgLoad: num(mine.length ? sum('player_load_au') / mine.length : null),
          avgHr: hr.length ? Math.round(hr.reduce((s, m) => s + m.avg_heart_rate, 0) / hr.length) : '\u2014',
          meters: Math.round(sum('meters')), acwr: num(a.acwr, 2), readiness: a.readiness,
        }
      })
      return {
        file: 'team-workload',
        cols: [['athlete', 'Athlete'], ['sessions', 'Sessions'], ['totalLoad', 'Total load (AU)'], ['avgLoad', 'Avg load (AU)'], ['avgHr', 'Avg HR (bpm)'], ['meters', 'Distance (m)'], ['acwr', 'ACWR'], ['readiness', 'Readiness']],
        rows,
        stats: [
          { label: 'Athletes', value: rows.length, note: 'on roster' },
          { label: 'Recorded sessions', value: ms.length, note: 'in period', noteClass: 'text-sa' },
          { label: 'Total load', value: `${num(ms.reduce((s, m) => s + (+m.player_load_au || 0), 0))} AU`, note: 'team' },
          { label: 'Flagged', value: d.flagged.length, note: 'Watch readiness', noteClass: 'text-danger-sa' },
        ],
      }
    }
    if (type === 'athlete') {
      const mine = ms.filter((m) => m.athlete_id === athlete?.id)
      const rows = mine.map((m) => ({
        date: mDay(m), session: m.session_title || 'Session',
        duration: m.total_seconds != null ? `${Math.floor(m.total_seconds / 60)}m ${m.total_seconds % 60}s` : '\u2014',
        load: num(m.player_load_au), avgHr: m.avg_heart_rate ?? '\u2014', maxHr: m.max_heart_rate ?? '\u2014',
        meters: num(m.meters), steps: m.steps ?? '\u2014', jumps: m.jumps ?? '\u2014',
      }))
      return {
        file: `athlete-${athlete?.username || 'report'}`,
        cols: [['date', 'Date'], ['session', 'Session'], ['duration', 'Duration'], ['load', 'Load (AU)'], ['avgHr', 'Avg HR'], ['maxHr', 'Max HR'], ['meters', 'Distance (m)'], ['steps', 'Steps'], ['jumps', 'Jumps']],
        rows,
        stats: [
          { label: 'Athlete', value: athlete?.ini || '\u2014', note: athlete?.name || 'none selected' },
          { label: 'Sessions', value: rows.length, note: 'in period', noteClass: 'text-sa' },
          { label: 'Total load', value: `${num(mine.reduce((s, m) => s + (+m.player_load_au || 0), 0))} AU`, note: 'in period' },
          { label: 'Current ACWR', value: num(athlete?.acwr, 2), note: athlete?.readiness || '\u2014' },
        ],
      }
    }
    const sess = d.sessionRows.filter((s) => inRange(s.date))
    const rows = sess.map((s) => {
      const recs = metricsForSession(s, d.metrics)
      const ids = new Set(recs.map((r) => r.athlete_id))
      const absent = d.roster.filter((a) => !ids.has(a.id)).map((a) => a.short)
      return {
        date: s.date, session: s.title, type: s.session_type || '\u2014',
        present: `${ids.size}/${d.roster.length}`,
        rate: d.roster.length ? `${Math.round((ids.size / d.roster.length) * 100)}%` : '\u2014',
        absent: s.status === 'Upcoming' ? 'Upcoming' : absent.join('; ') || 'None',
      }
    })
    return {
      file: 'attendance-log',
      cols: [['date', 'Date'], ['session', 'Session'], ['type', 'Type'], ['present', 'Present'], ['rate', 'Rate'], ['absent', 'Absent athletes']],
      rows,
      stats: [
        { label: 'Sessions', value: rows.length, note: 'in period' },
        { label: 'Completed', value: sess.filter((s) => s.status === 'Completed').length, note: 'sessions', noteClass: 'text-sa' },
        { label: 'Upcoming', value: sess.filter((s) => s.status === 'Upcoming').length, note: 'scheduled' },
        { label: 'Recordings', value: sess.reduce((s, x) => s + x.recorded, 0), note: 'device-sessions' },
      ],
    }
  }, [type, from, to, athlete?.id, d]) // eslint-disable-line

  const cols = report.cols.map(([key, label]) => ({ key, label }))
  const coach = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email

  return (
    <>
      <PageHeader crumb="Reports" title="Reports">
        <button className="btn btn-outline-secondary btn-sm" onClick={() => window.print()} disabled={!report.rows.length} id="print-report-btn">
          <i className="bi bi-printer me-1" />Print / PDF
        </button>
        <button className="btn btn-sa" onClick={() => downloadCsv(`${report.file}_${from}_to_${to}.csv`, cols, report.rows)} disabled={!report.rows.length} id="export-csv-btn">
          <i className="bi bi-download me-1" />Export CSV
        </button>
      </PageHeader>

      <div className="row g-3 mb-3 sa-noprint">
        {Object.entries(REPORTS).map(([k, r]) => (
          <div className="col-md-4" key={k}>
            <button className={`sa-card sa-report-type w-100 text-start p-3${type === k ? ' active' : ''}`} onClick={() => setType(k)} id={`report-${k}`}>
              <i className={`bi ${r.icon} fs-4 text-sa`} />
              <div className="sa-card-title mt-1">{r.label}</div>
              <div className="sa-card-sub">{r.desc}</div>
            </button>
          </div>
        ))}
      </div>

      <div className="sa-card p-3 mb-3 sa-noprint">
        <div className="row g-3 align-items-end">
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold mb-1">From</label>
            <input type="date" className="form-control form-control-sm" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label small fw-semibold mb-1">To</label>
            <input type="date" className="form-control form-control-sm" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </div>
          {type === 'athlete' && (
            <div className="col-md-4">
              <label className="form-label small fw-semibold mb-1">Athlete</label>
              <select className="form-select form-select-sm" value={String(athlete?.id ?? '')} onChange={(e) => setAthleteId(e.target.value)}>
                {d.roster.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          <div className="col-auto d-flex gap-2">
            {[['Last 7 days', 7], ['Last 28 days', 28], ['Last 90 days', 90]].map(([l, n]) => (
              <button key={n} className="btn btn-sm btn-outline-secondary" onClick={() => { setFrom(dayKey(Date.now() - n * 86400000)); setTo(today) }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="sa-print-area">
        <div className="sa-print-head">
          <strong>SmartAthlete &middot; EVSU Ormoc</strong> &mdash; {REPORTS[type].label}<br />
          <span>Period {from} to {to} &middot; Prepared by {coach} &middot; Generated {new Date().toLocaleString()}</span>
        </div>
        <StatRow items={report.stats} />
        <div className="sa-card p-3">
          <div className="table-responsive">
            <table className="table sa-table">
              <thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {report.rows.length === 0 && <tr><td colSpan={cols.length} className="text-center text-muted py-4">No data in the selected period.</td></tr>}
                {report.rows.map((r, i) => (
                  <tr key={i}>
                    {cols.map((c) => (
                      <td key={c.key}>{c.key === 'readiness' ? <Badge color={{ Watch: 'red', Moderate: 'amber', Ready: 'green' }[r[c.key]] || 'blue'} dot>{r[c.key]}</Badge> : r[c.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sa-foot mt-2">ACWR and readiness are coaching decision-support estimates, not medical assessments.</div>
        </div>
      </div>
    </>
  )
}

/* ======================================================================
   Workload monitoring settings (ACWR thresholds / acute & chronic windows)
   — commented out per user request. Settings tab now focuses on profile.

export function WorkloadSettings({ user, settings, onSave, onLogout }) {
  const [form, setForm] = useState(settings)
  const [saved, setSaved] = useState(false)
  const set = (k, v) => { setSaved(false); setForm((f) => ({ ...f, [k]: v })) }
  const valid = form.moderate > 0 && form.watch > form.moderate && form.acuteDays >= 1 && form.chronicDays > form.acuteDays && form.chronicDays % form.acuteDays === 0
  const submit = (e) => { e.preventDefault(); if (valid) { onSave(form); setSaved(true) } }
  const reset = () => { setForm(DEFAULT_SETTINGS); onSave(DEFAULT_SETTINGS); setSaved(true) }
  ...
}
====================================================================== */

/* ------------------------------ Profile Settings ------------------------------ */
export function Settings({ user, onLogout }) {
  const [tab, setTab] = useState('profile')
  const [form, setForm] = useState({
    firstName: user?.firstName || '',
    middleName: user?.middleName || '',
    lastName: user?.lastName || '',
    username: user?.username || '',
    email: user?.email || '',
    gender: user?.gender || '',
    birthdate: user?.birthdate || '',
  })
  const [pw, setPw] = useState({ current: '', newPw: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setPwField = (k, v) => setPw((f) => ({ ...f, [k]: v }))

  const saveProfile = async (e) => {
    e.preventDefault()
    setSaving(true); setMsg(null)
    try {
      const { error } = await supabase.from('tbl_coaches').update({
        firstName: form.firstName,
        middleName: form.middleName,
        lastName: form.lastName,
        username: form.username,
        gender: form.gender,
        birthdate: form.birthdate || null,
      }).eq('email', user.email)
      if (error) throw error
      setMsg({ type: 'success', text: 'Profile updated successfully.' })
      // Update sessionStorage so the topbar reflects changes immediately
      const stored = JSON.parse(sessionStorage.getItem('smartathlete.user') || '{}')
      sessionStorage.setItem('smartathlete.user', JSON.stringify({ ...stored, ...form }))
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Failed to save profile.' })
    } finally { setSaving(false) }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    if (pw.newPw !== pw.confirm) { setMsg({ type: 'error', text: 'New passwords do not match.' }); return }
    if (pw.newPw.length < 6) { setMsg({ type: 'error', text: 'Password must be at least 6 characters.' }); return }
    setSaving(true); setMsg(null)
    try {
      // Verify current password against tbl_coaches
      const { data: coach, error: fetchErr } = await supabase
        .from('tbl_coaches').select('password').eq('email', user.email).maybeSingle()
      if (fetchErr) throw fetchErr
      if (!coach || coach.password !== pw.current) {
        setMsg({ type: 'error', text: 'Current password is incorrect.' }); return
      }
      // Update password in tbl_coaches
      const { error: updateErr } = await supabase
        .from('tbl_coaches').update({ password: pw.newPw, confirmPassword: pw.newPw }).eq('email', user.email)
      if (updateErr) throw updateErr
      // Also update Supabase Auth password
      await supabase.auth.updateUser({ password: pw.newPw })
      setPw({ current: '', newPw: '', confirm: '' })
      setMsg({ type: 'success', text: 'Password changed successfully.' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Failed to change password.' })
    } finally { setSaving(false) }
  }

  const tabs = [
    { id: 'profile', label: 'Profile', icon: 'bi-person-fill' },
    { id: 'password', label: 'Password', icon: 'bi-shield-lock-fill' },
    { id: 'account', label: 'Account', icon: 'bi-gear-fill' },
  ]

  return (
    <>
      <PageHeader crumb="Settings" title="Settings" />

      {msg && (
        <div className={`alert ${msg.type === 'success' ? 'alert-success' : 'alert-danger'} d-flex align-items-center gap-2 py-2`} role="alert">
          <i className={`bi ${msg.type === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}`} />
          {msg.text}
          <button type="button" className="btn-close ms-auto" onClick={() => setMsg(null)} />
        </div>
      )}

      <div className="row g-3">
        {/* Sidebar tabs */}
        <div className="col-lg-3">
          <div className="sa-card p-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`sa-nav-link w-100${tab === t.id ? ' active' : ''}`}
                style={{ color: tab === t.id ? '#fff' : '#374151', background: tab === t.id ? 'var(--sa-primary)' : 'transparent' }}
                onClick={() => { setTab(t.id); setMsg(null) }}
                id={`settings-tab-${t.id}`}
              >
                <i className={`bi ${t.icon}`} style={{ color: tab === t.id ? '#fff' : 'var(--sa-primary)' }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="col-lg-9">
          {/* ---- Profile Tab ---- */}
          {tab === 'profile' && (
            <form className="sa-card p-4" onSubmit={saveProfile}>
              <div className="d-flex align-items-center gap-3 mb-4">
                <div className="sa-avatar" style={{ width: 56, height: 56, fontSize: '1.2rem' }}>
                  {((form.firstName?.[0] || '') + (form.lastName?.[0] || '')).toUpperCase() || 'CO'}
                </div>
                <div>
                  <h5 className="mb-0 fw-bold">{form.firstName} {form.lastName}</h5>
                  <span className="text-muted small">{form.email} &middot; <Badge color="teal">{user?.role}</Badge></span>
                </div>
              </div>

              <h6 className="fw-bold mb-3"><i className="bi bi-pencil-square me-2 text-sa" />Personal information</h6>
              <div className="row g-3 mb-3">
                <div className="col-md-4">
                  <label className="form-label small fw-semibold">First name</label>
                  <input className="form-control" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required />
                </div>
                <div className="col-md-4">
                  <label className="form-label small fw-semibold">Middle name</label>
                  <input className="form-control" value={form.middleName} onChange={(e) => set('middleName', e.target.value)} />
                </div>
                <div className="col-md-4">
                  <label className="form-label small fw-semibold">Last name</label>
                  <input className="form-control" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required />
                </div>
              </div>
              <div className="row g-3 mb-3">
                <div className="col-md-6">
                  <label className="form-label small fw-semibold">Username</label>
                  <input className="form-control" value={form.username} onChange={(e) => set('username', e.target.value)} />
                </div>
                <div className="col-md-6">
                  <label className="form-label small fw-semibold">Email address</label>
                  <input className="form-control" value={form.email} disabled />
                  <div className="form-text">Email cannot be changed.</div>
                </div>
              </div>
              <div className="row g-3 mb-4">
                <div className="col-md-6">
                  <label className="form-label small fw-semibold">Gender</label>
                  <select className="form-select" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                    <option value="">Select</option>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="col-md-6">
                  <label className="form-label small fw-semibold">Birthdate</label>
                  <input type="date" className="form-control" value={form.birthdate || ''} onChange={(e) => set('birthdate', e.target.value)} />
                </div>
              </div>

              <div className="d-flex gap-2">
                <button type="submit" className="btn btn-sa" disabled={saving} id="save-profile-btn">
                  {saving ? <><span className="spinner-border spinner-border-sm me-1" />Saving...</> : <><i className="bi bi-check-lg me-1" />Save changes</>}
                </button>
                <button type="button" className="btn btn-outline-secondary" onClick={() => setForm({
                  firstName: user?.firstName || '', middleName: user?.middleName || '', lastName: user?.lastName || '',
                  username: user?.username || '', email: user?.email || '', gender: user?.gender || '', birthdate: user?.birthdate || '',
                })}>
                  Discard changes
                </button>
              </div>
            </form>
          )}

          {/* ---- Password Tab ---- */}
          {tab === 'password' && (
            <form className="sa-card p-4" onSubmit={changePassword}>
              <h6 className="fw-bold mb-3"><i className="bi bi-shield-lock me-2 text-sa" />Change password</h6>
              <div className="row g-3 mb-3" style={{ maxWidth: 480 }}>
                <div className="col-12">
                  <label className="form-label small fw-semibold">Current password</label>
                  <input type="password" className="form-control" value={pw.current} onChange={(e) => setPwField('current', e.target.value)} required />
                </div>
                <div className="col-12">
                  <label className="form-label small fw-semibold">New password</label>
                  <input type="password" className="form-control" value={pw.newPw} onChange={(e) => setPwField('newPw', e.target.value)} required minLength={6} />
                  <div className="form-text">Must be at least 6 characters.</div>
                </div>
                <div className="col-12">
                  <label className="form-label small fw-semibold">Confirm new password</label>
                  <input type="password" className="form-control" value={pw.confirm} onChange={(e) => setPwField('confirm', e.target.value)} required />
                  {pw.confirm && pw.newPw !== pw.confirm && (
                    <div className="text-danger small mt-1">Passwords do not match.</div>
                  )}
                </div>
              </div>
              <button type="submit" className="btn btn-sa" disabled={saving || !pw.current || !pw.newPw || pw.newPw !== pw.confirm} id="change-password-btn">
                {saving ? <><span className="spinner-border spinner-border-sm me-1" />Updating...</> : <><i className="bi bi-check-lg me-1" />Update password</>}
              </button>
            </form>
          )}

          {/* ---- Account Tab ---- */}
          {tab === 'account' && (
            <div className="sa-card p-4">
              <h6 className="fw-bold mb-3"><i className="bi bi-info-circle me-2 text-sa" />Account information</h6>
              <dl className="row mb-4">
                <dt className="col-sm-4 text-muted fw-normal">Full name</dt>
                <dd className="col-sm-8 fw-semibold">{form.firstName} {form.middleName} {form.lastName}</dd>
                <dt className="col-sm-4 text-muted fw-normal">Username</dt>
                <dd className="col-sm-8">{form.username || '\u2014'}</dd>
                <dt className="col-sm-4 text-muted fw-normal">Email</dt>
                <dd className="col-sm-8">{form.email}</dd>
                <dt className="col-sm-4 text-muted fw-normal">Role</dt>
                <dd className="col-sm-8"><Badge color="teal">{user?.role}</Badge></dd>
                <dt className="col-sm-4 text-muted fw-normal">Gender</dt>
                <dd className="col-sm-8">{form.gender || '\u2014'}</dd>
                <dt className="col-sm-4 text-muted fw-normal">Birthdate</dt>
                <dd className="col-sm-8">{form.birthdate || '\u2014'}</dd>
              </dl>

              <hr />
              <h6 className="fw-bold mb-2 text-danger"><i className="bi bi-box-arrow-right me-2" />Sign out</h6>
              <p className="small text-muted mb-3">End your current session. You will need to sign in again to access the coach portal.</p>
              <button className="btn btn-outline-danger" onClick={onLogout} id="settings-signout-btn">
                <i className="bi bi-box-arrow-right me-1" />Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
