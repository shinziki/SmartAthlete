import { useEffect, useRef, useState } from 'react'
import { Badge } from './ui'

/** Alert keys the coach has already seen in the bell (this browser). */
const SEEN_KEY = 'smartathlete.notifications.seen'

function loadSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function saveSeen(keys) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(keys)) } catch { /* ignore */ }
}

/**
 * Top-bar bell: the team's alerts (high load, recovery needed, watch data waiting to sync).
 * The red count is alerts not seen yet; opening the bell marks them seen. An alert that
 * clears and later comes back counts as new again.
 *
 * `alerts` is null while the data is still loading.
 */
export function NotificationBell({ alerts, onSelect }) {
  const [seen, setSeen] = useState(loadSeen)
  const [open, setOpen] = useState(false)
  // Which ones were new when the bell was opened (marked with a dot while it's open)
  const [newAtOpen, setNewAtOpen] = useState(() => new Set())
  const wrapRef = useRef(null)
  const btnRef = useRef(null)

  // Forget alerts that have cleared, so they count as new if they return
  useEffect(() => {
    if (!alerts) return
    const live = new Set(alerts.map((a) => a.key))
    setSeen((prev) => {
      const kept = prev.filter((k) => live.has(k))
      if (kept.length === prev.length) return prev
      saveSeen(kept)
      return kept
    })
  }, [alerts])

  const unseen = alerts ? alerts.filter((a) => !seen.includes(a.key)) : []

  const close = (refocus) => {
    setOpen(false)
    if (refocus) btnRef.current?.focus()
  }

  const toggle = () => {
    if (open) return close(false)
    setNewAtOpen(new Set(unseen.map((a) => a.key)))
    setOpen(true)
    if (alerts && unseen.length) {
      const all = [...new Set([...seen, ...alerts.map((a) => a.key)])]
      setSeen(all)
      saveSeen(all)
    }
  }

  // Click outside or Escape closes it
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) close(false) }
    const onKey = (e) => { if (e.key === 'Escape') close(true) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const go = (page) => {
    close(false)
    onSelect(page)
  }

  const count = unseen.length
  const label = count ? `Notifications, ${count} new` : 'Notifications'

  return (
    <div className="position-relative" ref={wrapRef}>
      <button
        ref={btnRef}
        className="sa-icon-btn"
        onClick={toggle}
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        id="notifications-btn"
      >
        <i className={`bi ${count ? 'bi-bell-fill' : 'bi-bell'}`} />
        {count > 0 && <span className="sa-count" aria-hidden="true">{count > 9 ? '9+' : count}</span>}
      </button>

      {open && (
        <div className="sa-notif" role="dialog" aria-label="Notifications">
          <div className="sa-notif-head">
            <div>
              <div className="t">Notifications</div>
              <div className="s">
                {!alerts ? 'Loading…' : alerts.length ? `${alerts.length} active alert${alerts.length === 1 ? '' : 's'}` : 'Nothing needs attention'}
              </div>
            </div>
          </div>

          {alerts && alerts.length === 0 && (
            <div className="sa-notif-empty">
              <i className="bi bi-check2-circle" />
              You’re all caught up. No athlete has unusually high load, needs recovery or has watch data waiting to sync.
            </div>
          )}

          {alerts && alerts.length > 0 && (
            <div className="sa-notif-list">
              {alerts.map((al) => (
                <button key={al.key} className="sa-notif-item" onClick={() => go(al.page)}>
                  <Badge color={al.color}><i className={`bi ${al.icon}`} /></Badge>
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    <div className="t">{al.title}{al.athlete ? ` — ${al.athlete.name}` : ''}</div>
                    <div className="s">{al.text}</div>
                  </div>
                  {newAtOpen.has(al.key) && <span className="sa-notif-new" aria-label="New" />}
                </button>
              ))}
            </div>
          )}

          <div className="sa-notif-foot">
            <button onClick={() => go('dashboard')}>Open Dashboard</button>
          </div>
        </div>
      )}
    </div>
  )
}
