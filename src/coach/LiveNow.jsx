import { Avatar, Badge } from './ui'
import { dayKey } from './useCoachData'
import { ago, clockOf, isStale, keyOf, lastSeen, liveSeconds, presenceOf, useLiveSessions, useNow } from './liveData'

/* ------------------------------ Dashboard card ------------------------------ */

/**
 * Dashboard: everyone training today, live. Hidden when no one has started a session today.
 * `onOpenSession(id)` opens that session's page.
 */
export function LiveNow({ d, onOpenSession }) {
  const today = dayKey(Date.now())
  const todays = d.sessionRows.filter((s) => s.date === today)
  const live = useLiveSessions(todays.map((s) => s.id))
  const rows = live.progress
  const active = rows.some((p) => p.status === 'in_progress')
  const now = useNow(1000, active)

  // Shown while anyone trains today, and for a while after the last one finished
  const recent = rows.filter((p) => p.status === 'in_progress' || now - lastSeen(p) < 30 * 60_000)
  if (recent.length === 0) return null

  const byId = Object.fromEntries(d.roster.map((a) => [a.id, a]))
  const titleOf = Object.fromEntries(todays.map((s) => [s.id, s.title]))
  const list = recent
    .map((p) => ({ p, pres: presenceOf(null, p, now), a: byId[p.athlete_id] }))
    .sort((x, y) => (y.pres?.[3] ? 1 : 0) - (x.pres?.[3] ? 1 : 0) || (x.p.status === 'completed') - (y.p.status === 'completed'))
  const training = recent.filter((p) => p.status === 'in_progress' && !isStale(p, now)).length

  return (
    <div className="sa-card p-3 mb-3">
      <div className="d-flex justify-content-between align-items-baseline mb-2">
        <div className="sa-card-title">
          {active && <span className="sa-live-dot" aria-hidden="true" />}
          Live now
        </div>
        <span className="sa-card-sub">{training} training · updates as each phone reports</span>
      </div>
      <div className="table-responsive">
        <table className="table sa-table sa-nowrap mb-0">
          <thead>
            <tr><th>Athlete</th><th>Session</th><th>Status</th><th>Time</th><th>Heart rate</th><th>Watch load</th><th>Updated</th></tr>
          </thead>
          <tbody>
            {list.map(({ p, pres, a }) => (
              <tr key={keyOf(p)} className="sa-row-link" onClick={() => onOpenSession?.(p.session_id)}>
                <td>
                  <div className="d-flex align-items-center gap-2">
                    <Avatar ini={a?.ini || '?'} src={a?.photo} small />
                    <span className="fw-semibold">{a?.name || `Athlete #${p.athlete_id}`}</span>
                  </div>
                </td>
                <td>
                  <div>{titleOf[p.session_id] || 'Session'}</div>
                  {p.current_drill && p.status === 'in_progress' && <div className="sa-card-sub">{p.current_drill}</div>}
                </td>
                <td>
                  {pres && <Badge color={pres[1]} dot>{pres[0]}</Badge>}
                  {pres?.[2] && <div className="sa-card-sub">{pres[2]}</div>}
                </td>
                <td className="fw-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{clockOf(liveSeconds(p, now))}</td>
                <td>{p.status === 'in_progress' && p.live_heart_rate ? <><i className="bi bi-heart-fill text-danger-sa me-1" />{p.live_heart_rate}</> : '—'}</td>
                <td>{p.player_load_au != null ? `${Number(p.player_load_au).toFixed(1)} AU` : '—'}</td>
                <td className="sa-card-sub">{ago(p.synced_at, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

