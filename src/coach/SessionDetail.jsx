import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Avatar, Badge, PageHeader, StatRow } from './ui'
import { dayKey, metricsForSession } from './useCoachData'
import { cleanTime, longDate, statusBadge, typeBadge, typeLabel } from './format'

/* ------------------------------ Formatting ------------------------------ */
const num = (v) => (v == null || v === '' || Number.isNaN(+v) ? null : +v)
const fmt = (v, p = 1) => (num(v) == null ? '—' : num(v).toFixed(p))
const mmss = (sec) => {
  const s = num(sec)
  if (s == null || s <= 0) return '—'
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`
}
const distance = (m) => {
  const v = num(m)
  if (v == null || v <= 0) return '—'
  return v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`
}
const clock = (t) => (t ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—')
const heart = (avg, max) => (num(avg) ? `${Math.round(avg)}${num(max) ? ` / ${Math.round(max)}` : ''}` : '—')
const count = (v) => (num(v) == null ? '—' : num(v))
const avgOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** How each athlete's session ended (supabase_session_end_reason.sql). */
const ENDED = {
  completed: ['Completed', 'green'],
  ended_early: ['Ended early', 'amber'],
  left_venue: ['Left venue', 'red'],
}
/** Wearer verification (supabase_wearer_verification.sql); cleared / absent are the coach's review. */
const IDENTITY = {
  verified: ['Verified', 'green'],
  checking: ['Checking', 'amber'],
  unverified: ['Unverified', 'red'],
  cleared: ['Cleared by coach', 'teal'],
  absent: ['Marked absent', 'gray'],
}
const REASON = {
  off_wrist: 'Watch taken off',
  timeout: 'Not verified in time',
  face_mismatch: "Face didn't match profile picture",
  no_face: 'Face not seen clearly',
  camera_unavailable: "Camera didn't start",
  phone_far: 'Phone not near watch',
  watch_not_connected: 'Watch not connected',
  supervised: 'Waiting for coach to confirm',
  coach_rejected: 'Coach said someone else wore the watch',
  cancelled: 'Face check cancelled',
}
const reasonText = (r) => (r ? REASON[r] || r.replace(/_/g, ' ') : '')

/* ------------------------------ Data ------------------------------ */

/**
 * Check-ins and live progress for one session (not part of the portal's main load).
 * Re-read every minute for today's session, so a coach watching it stays current.
 */
function useSessionExtras(sessionId, live) {
  const [st, setSt] = useState({ loading: true, attendees: [], progress: [], failed: false })
  useEffect(() => {
    if (sessionId == null) return
    let cancelled = false
    const read = async () => {
      const [a, p] = await Promise.all([
        supabase.from('tbl_session_attendees').select('*').eq('session_id', sessionId),
        supabase.from('tbl_session_progress').select('*').eq('session_id', sessionId),
      ])
      if (cancelled) return
      setSt({
        loading: false,
        attendees: a.error ? [] : a.data || [],
        // Older databases have no progress table: just no live / identity info
        progress: p.error ? [] : p.data || [],
        failed: !!a.error,
      })
    }
    setSt({ loading: true, attendees: [], progress: [], failed: false })
    read().catch(() => { if (!cancelled) setSt({ loading: false, attendees: [], progress: [], failed: true }) })
    const t = live ? setInterval(() => { if (!document.hidden) read().catch(() => {}) }, 60000) : null
    return () => {
      cancelled = true
      if (t) clearInterval(t)
    }
  }, [sessionId, live])
  return st
}

/* ------------------------------ View ------------------------------ */

export function SessionDetail({ d, session: s, onBack }) {
  const today = dayKey(Date.now())
  const extras = useSessionExtras(s?.id, s?.date === today)
  const [openRow, setOpenRow] = useState(null)

  if (!s) {
    return (
      <>
        <button className="sa-back" onClick={onBack}><i className="bi bi-arrow-left" />All sessions</button>
        <div className="sa-card p-5 text-center text-muted">
          <i className="bi bi-calendar-x fs-1 text-sa" />
          <p className="mt-2 mb-0">This session no longer exists or you can’t see it.</p>
        </div>
      </>
    )
  }

  const over = s.date < today
  const recs = metricsForSession(s, d.metrics)
  const drills = Array.isArray(s.drills) ? s.drills : []
  const rosterById = Object.fromEntries(d.roster.map((a) => [a.id, a]))
  const attByAthlete = Object.fromEntries(extras.attendees.map((a) => [a.athlete_id, a]))
  const progByAthlete = Object.fromEntries(extras.progress.map((p) => [p.athlete_id, p]))
  const checkedIn = extras.attendees.filter((a) => a.status !== 'declined')

  // One row per recording, plus one for every other athlete on the roster or checked in
  const recorded = new Set(recs.map((r) => r.athlete_id))
  const others = [...new Set([...d.roster.map((a) => a.id), ...extras.attendees.map((a) => a.athlete_id)])].filter((id) => !recorded.has(id))
  const nameOf = (id) => rosterById[id]?.name || attByAthlete[id]?.athlete_name || `Athlete #${id}`
  const rows = [
    ...recs.map((rec) => ({ key: `r${rec.id}`, athleteId: rec.athlete_id, rec })),
    ...others.map((id) => ({ key: `a${id}`, athleteId: id, rec: null })),
  ].map((r) => {
    const att = attByAthlete[r.athleteId]
    const prog = progByAthlete[r.athleteId]
    let result
    if (r.rec) result = ENDED[r.rec.end_reason] || ['Recorded', 'green']
    else if (prog?.status === 'in_progress') result = ['Training now', 'blue']
    else if (att?.status === 'declined') result = ['Declined', 'gray']
    else if (att) result = [over ? 'No watch data' : 'Checked in', over ? 'amber' : 'teal']
    else result = [over ? 'Absent' : 'Not checked in', 'gray']
    const order = r.rec ? 1 : prog?.status === 'in_progress' ? 0 : att && att.status !== 'declined' ? 2 : 3
    return { ...r, att, prog, result, order, name: nameOf(r.athleteId) }
  }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))

  // Team results for each planned drill (matched by position in the plan)
  const drillStats = drills.map((dr, i) => {
    const done = recs.flatMap((r) => (Array.isArray(r.drill_breakdown) ? r.drill_breakdown : []))
      .filter((b) => (b.drillIndex != null ? b.drillIndex === i : b.drillId === dr.id))
    return {
      load: avgOf(done.map((b) => num(b.playerLoadAU)).filter((v) => v != null)),
      hr: avgOf(done.map((b) => num(b.avgHeartRate)).filter((v) => v)),
    }
  })
  const plannedMin = drills.reduce((t, dr) => t + (num(dr.durationMinutes) || 0), 0)

  // Session load = RPE x minutes (what ACWR uses); watch load = the watch's accelerometer
  const loads = recs.map((r) => num(r.player_load_au)).filter((v) => v != null)
  const watchLoads = recs.map((r) => num(r.watch_load_au)).filter((v) => v != null)
  const hrs = recs.map((r) => num(r.avg_heart_rate)).filter((v) => v)
  const peakHr = Math.max(0, ...recs.map((r) => num(r.max_heart_rate) || 0))
  const roster = d.roster.length
  const hasMap = s.location_type !== 'at_home' && s.latitude != null && s.longitude != null
  // Names saved masked for privacy ("J***** D*****") say nothing: left out
  const coach = s.coach_name && !s.coach_name.includes('*') ? s.coach_name : null

  return (
    <>
      <button className="sa-back" onClick={onBack}><i className="bi bi-arrow-left" />All sessions</button>
      <PageHeader crumb={`Sessions / ${s.title}`} title={s.title}>
        <Badge color={typeBadge[s.session_type] || 'blue'}>{typeLabel(s.session_type)}</Badge>
        <Badge color={statusBadge[s.status]} dot>{s.status}</Badge>
      </PageHeader>
      <div className="sa-detail-meta mb-3">
        <span><i className="bi bi-calendar3" />{longDate(s.date)}</span>
        <span><i className="bi bi-clock" />{cleanTime(s.start_time)} – {cleanTime(s.end_time)}</span>
        <span><i className={`bi ${s.location_type === 'at_home' ? 'bi-house' : 'bi-geo-alt'}`} />{s.location_type === 'at_home' ? 'At home' : s.venue_name || 'Venue'}</span>
        {coach && <span><i className="bi bi-person-badge" />{coach}</span>}
      </div>

      <StatRow items={[
        { label: 'Checked in', value: extras.loading ? '…' : `${checkedIn.length}/${roster}`, note: extras.failed ? 'couldn’t load check-ins' : checkedIn.some((a) => a.status === 'late') ? `${checkedIn.filter((a) => a.status === 'late').length} late` : 'athletes', noteClass: extras.failed ? 'text-danger-sa' : '' },
        { label: 'Watch data', value: `${recorded.size}/${roster}`, note: 'athletes recorded', noteClass: 'text-sa' },
        { label: 'Avg session load', value: loads.length ? `${fmt(avgOf(loads))} AU` : '—', note: watchLoads.length ? `watch load ${fmt(avgOf(watchLoads))} AU avg` : loads.length ? 'RPE × minutes' : 'no recordings yet' },
        { label: 'Avg heart rate', value: hrs.length ? Math.round(avgOf(hrs)) : '—', note: peakHr ? `bpm · peak ${peakHr}` : 'bpm' },
      ]} />

      <div className="row g-3 mb-3">
        <div className="col-lg-7">
          <div className="sa-card p-3 h-100">
            <div className="d-flex justify-content-between align-items-baseline">
              <div className="sa-card-title">Training plan</div>
              <span className="sa-card-sub">{drills.length} drill{drills.length === 1 ? '' : 's'}{plannedMin ? ` · ${plannedMin} min` : ''}</span>
            </div>
            <div className="sa-card-sub mb-2">Planned drills, with the team’s average watch load and heart rate once recorded</div>
            {drills.length === 0 && <div className="text-muted small py-3">No drills were planned for this session.</div>}
            {drills.map((dr, i) => {
              const st = drillStats[i]
              return (
                <div className="sa-drill" key={dr.id || i}>
                  <span className="sa-drill-num">{i + 1}</span>
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <span className="fw-semibold small">{dr.name || 'Drill'}</span>
                      {dr.category && <Badge color="gray">{dr.category}</Badge>}
                    </div>
                    <div className="sa-card-sub">
                      {num(dr.durationMinutes) ? `${dr.durationMinutes} min` : '—'}
                      {num(dr.sets) && num(dr.reps) ? ` · ${dr.sets} × ${dr.reps}` : ''}
                      {num(dr.restSeconds) ? ` · ${dr.restSeconds}s rest` : ''}
                    </div>
                  </div>
                  <div className="text-end sa-card-sub" style={{ whiteSpace: 'nowrap' }}>
                    {st.load != null || st.hr != null ? (
                      <>
                        <div className="fw-semibold" style={{ color: 'var(--sa-text)' }}>{st.load != null ? `${fmt(st.load)} AU` : '—'}</div>
                        <div>{st.hr != null ? `${Math.round(st.hr)} bpm avg` : 'no heart rate'}</div>
                      </>
                    ) : (
                      <span>not recorded</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="col-lg-5">
          <div className="sa-card p-3 h-100">
            <div className="sa-card-title mb-2">Session info</div>
            <dl className="sa-kv">
              <dt>Date</dt><dd>{longDate(s.date)}</dd>
              <dt>Time</dt><dd>{cleanTime(s.start_time)} – {cleanTime(s.end_time)}</dd>
              <dt>Type</dt><dd>{typeLabel(s.session_type)}</dd>
              <dt>Location</dt>
              <dd>
                {s.location_type === 'at_home' ? 'At home' : s.venue_name || 'Venue'}
                {hasMap && (
                  <div>
                    <a className="sa-link small" href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`} target="_blank" rel="noopener noreferrer">
                      Open in Google Maps <i className="bi bi-box-arrow-up-right" />
                    </a>
                  </div>
                )}
              </dd>
              {hasMap && <><dt>Venue area</dt><dd>{s.geofence_radius || 40} m radius</dd></>}
              <dt>Planned</dt><dd>{num(s.total_duration_minutes) ? `${s.total_duration_minutes} min` : plannedMin ? `${plannedMin} min` : '—'}</dd>
              {coach && <><dt>Coach</dt><dd>{coach}</dd></>}
              {s.created_at && <><dt>Created</dt><dd>{new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</dd></>}
            </dl>
          </div>
        </div>
      </div>

      <div className="sa-card p-3">
        <div className="d-flex justify-content-between align-items-baseline mb-2">
          <div className="sa-card-title">Athletes</div>
          <span className="sa-card-sub">Click a recorded athlete to see each drill</span>
        </div>
        <div className="table-responsive">
          <table className="table sa-table sa-nowrap">
            <thead>
              <tr>
                <th>Athlete</th><th>Check-in</th><th>Result</th><th>Time</th>
                <th title="Effort rating (RPE) × minutes: the load used for ACWR">Session load</th>
                <th title="Movement measured by the watch's accelerometer">Watch load</th>
                <th>RPE</th><th>Distance</th><th>HR avg / max</th><th>Jumps</th><th>Sprints</th><th>Identity</th><th aria-label="Details" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={13} className="text-center text-muted py-4">No athletes on the roster yet.</td></tr>
              )}
              {rows.map((r) => {
                const a = rosterById[r.athleteId]
                const breakdown = Array.isArray(r.rec?.drill_breakdown) ? r.rec.drill_breakdown : []
                const canOpen = breakdown.length > 0
                const isOpen = openRow === r.key
                const toggle = () => canOpen && setOpenRow(isOpen ? null : r.key)
                const idStatus = r.prog?.verify_status
                const sup = r.prog?.supervision_status
                return (
                  <Fragment key={r.key}>
                    <tr className={canOpen ? 'sa-row-link' : r.rec ? '' : 'sa-row-dim'} onClick={toggle}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <Avatar ini={a?.ini || '?'} small />
                          <div>
                            <div className="fw-semibold">{r.name}</div>
                            {a?.jersey_number != null && <div className="sa-card-sub">#{a.jersey_number}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        {extras.loading ? '…' : r.att && r.att.status !== 'declined' ? (
                          <>
                            {clock(r.att.accepted_at)}
                            {r.att.status === 'late' && <> <Badge color="amber">Late</Badge></>}
                          </>
                        ) : '—'}
                      </td>
                      <td><Badge color={r.result[1]} dot>{r.result[0]}</Badge></td>
                      <td>{r.rec ? mmss(r.rec.total_seconds) : r.prog?.status === 'in_progress' ? mmss(r.prog.elapsed_seconds) : '—'}</td>
                      <td className="fw-semibold">{r.rec ? fmt(r.rec.player_load_au) : '—'}</td>
                      <td>{r.rec ? fmt(r.rec.watch_load_au) : r.prog?.status === 'in_progress' ? fmt(r.prog.player_load_au) : '—'}</td>
                      <td>{r.rec && num(r.rec.session_rpe) != null ? `${fmt(r.rec.session_rpe, 0)}/10` : '—'}</td>
                      <td>{r.rec ? distance(r.rec.meters) : '—'}</td>
                      <td>{r.rec ? heart(r.rec.avg_heart_rate, r.rec.max_heart_rate) : '—'}</td>
                      <td>
                        {r.rec ? count(r.rec.jumps) : '—'}
                        {num(r.prog?.jumps_rejected) > 0 && <div className="sa-card-sub" title="Movements the watch didn't count as real jumps">{r.prog.jumps_rejected} rejected</div>}
                      </td>
                      <td>{r.rec ? count(r.rec.sprints) : '—'}</td>
                      <td>
                        {sup === 'pending' ? <Badge color="amber">Waiting for you</Badge>
                          : idStatus && IDENTITY[idStatus] ? (
                            <span title={reasonText(r.prog.verify_reason)}>
                              <Badge color={IDENTITY[idStatus][1]}>{IDENTITY[idStatus][0]}</Badge>
                              {idStatus !== 'verified' && r.prog.verify_reason && <div className="sa-card-sub">{reasonText(r.prog.verify_reason)}</div>}
                            </span>
                          ) : '—'}
                      </td>
                      <td className="text-end">
                        {canOpen && (
                          <button
                            className="sa-expand"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? 'Hide' : 'Show'} drills for ${r.name}`}
                            onClick={(e) => { e.stopPropagation(); toggle() }}
                          >
                            <i className={`bi ${isOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="sa-subrow">
                        <td colSpan={13}>
                          <DrillBreakdown items={breakdown} rec={r.rec} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="sa-foot mt-2">
          Results come from each athlete’s watch, synced through their phone. Session load = the athlete’s effort rating (RPE, 0–10) × minutes, the load used for ACWR. Watch load = movement measured by the watch. Both in arbitrary units (AU).
        </div>
      </div>
    </>
  )
}

/** One athlete's drills in this session (from their watch recording). */
function DrillBreakdown({ items, rec }) {
  return (
    <div className="sa-breakdown">
      <div className="d-flex flex-wrap gap-3 sa-card-sub mb-2">
        <span>Recorded {clock(rec.completed_at || rec.created_at)}</span>
        {rec.watch_name && <span><i className="bi bi-smartwatch me-1" />{rec.watch_name}</span>}
        {num(rec.steps) > 0 && <span>{rec.steps} steps</span>}
        {num(rec.calories_burned) > 0 && <span>{rec.calories_burned} kcal</span>}
        {num(rec.max_speed_kmh) > 0 && <span>top speed {fmt(rec.max_speed_kmh)} km/h</span>}
      </div>
      <table className="table sa-table sa-nowrap mb-0">
        <thead>
          <tr><th>#</th><th>Drill</th><th>Time</th><th>Watch load</th><th>Distance</th><th>Reps / jumps</th><th>HR avg / max</th><th>HR recovery</th><th /></tr>
        </thead>
        <tbody>
          {items.map((b, i) => (
            <tr key={i}>
              <td>{(b.drillIndex ?? i) + 1}</td>
              <td>
                <div className="fw-semibold">{b.drillName || 'Drill'}</div>
                {b.category && <div className="sa-card-sub">{b.category}</div>}
              </td>
              <td>{b.durationFormatted || mmss(b.totalSeconds)}</td>
              <td>{fmt(b.playerLoadAU)}</td>
              <td>{distance(b.meters)}</td>
              <td>
                {num(b.reps) ? `${b.reps}${num(b.targetReps) ? ` of ${num(b.sets) ? `${b.sets}×` : ''}${b.targetReps}` : ''} reps` : num(b.jumps) ? `${b.jumps} jumps` : '—'}
              </td>
              <td>{heart(b.avgHeartRate, b.maxHeartRate)}</td>
              <td>{num(b.hrRecoveryDrop) > 0 ? `−${Math.round(b.hrRecoveryDrop)} bpm` : '—'}</td>
              <td>
                {b.watchGap && !b.recoveredFromWatch && <Badge color="amber">Watch out of range</Badge>}
                {b.recoveredFromWatch && <Badge color="teal">From watch memory</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
