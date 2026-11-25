import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import './coach.css'
import { useCoachData } from './useCoachData'
import { Reports, Settings } from './ReportsSettings'
import {
  Dashboard, Athletes, Sessions, LoadFatigue, Attendance,
} from './CoachPages'
import { Analytics } from './Analytics'
import { NotificationBell } from './Notifications'

const THEME_KEY = 'smartathlete.theme'

/**
 * Light / dark mode: the coach's choice (kept in this browser), or the computer's setting
 * until they pick one. Printing always uses light mode (dark text on white paper).
 */
function useColorMode(rootRef) {
  const [mode, setMode] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY)
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* ignore */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  const toggle = () => {
    const next = mode === 'dark' ? 'light' : 'dark'
    setMode(next)
    try { localStorage.setItem(THEME_KEY, next) } catch { /* ignore */ }
  }

  // Switched straight on the page (not through React) so it's in place before printing starts
  useEffect(() => {
    const set = (m) => {
      const el = rootRef.current
      if (!el) return
      el.setAttribute('data-theme', m)
      el.setAttribute('data-bs-theme', m)
    }
    const before = () => set('light')
    const after = () => set(mode)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [mode, rootRef])

  return [mode, toggle]
}

const nav = [
  { group: 'Coaching', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'bi-grid-fill' },
    { id: 'athletes', label: 'Athletes', icon: 'bi-people-fill' },
    { id: 'sessions', label: 'Sessions', icon: 'bi-activity' },
    { id: 'load', label: 'Load & Fatigue', icon: 'bi-heart-pulse-fill' },
    { id: 'analytics', label: 'Analytics', icon: 'bi-bar-chart-line-fill' },
    { id: 'attendance', label: 'Attendance', icon: 'bi-geo-alt-fill' },
  ] },
  { group: 'Program', items: [
    { id: 'reports', label: 'Reports', icon: 'bi-file-earmark-text-fill' },
    { id: 'settings', label: 'Settings', icon: 'bi-gear-fill' },
  ] },
]

function NavList({ page, onSelect }) {
  return nav.map((g) => {
    const items = g.items
    return (
      <div key={g.group}>
        <div className="sa-nav-label">{g.group}</div>
        {items.map((i) => (
          <button
            key={i.id}
            id={`nav-${i.id}`}
            className={`sa-nav-link${page === i.id ? ' active' : ''}`}
            onClick={() => onSelect(i.id)}
          >
            <i className={`bi ${i.icon}`} />
            {i.label}
          </button>
        ))}
      </div>
    )
  })
}

/**
 * The signed-in staff member's profile photo (set in the mobile app; avatars bucket,
 * supabase_profile_photos.sql), or null. Needs a Supabase Auth session.
 */
function useProfilePhoto(emailHash) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      let row = null
      if (uid) {
        ;({ data: row } = await supabase.from('tbl_profile_photos').select('storage_path, updated_at').eq('user_id', uid).maybeSingle())
      }
      // No Auth session (e.g. email not confirmed): look it up by the login's email hash
      if (!row && emailHash) {
        const { data } = await supabase.rpc('profile_photo_for_email_hash', { p_email_hash: emailHash })
        row = Array.isArray(data) ? data[0] : data
      }
      if (!row?.storage_path || cancelled) return
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(row.storage_path)
      setUrl(`${pub.publicUrl}?v=${encodeURIComponent(row.updated_at)}`)
    })().catch(() => {})
    return () => { cancelled = true }
  }, [emailHash])
  return url
}

export default function CoachApp({ user, onLogout }) {
  // The open page survives a reload (per browser; cleared on sign-out with the login)
  const [page, setPage] = useState(() => {
    try { return localStorage.getItem('smartathlete.page') || 'dashboard' } catch { return 'dashboard' }
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef(null)
  const [mode, toggleMode] = useColorMode(rootRef)
  const { data, loading, error, reload } = useCoachData()
  const photoUrl = useProfilePhoto(user?.emailHash)
  const today = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

  const initials = (
    ((user?.firstName || '')[0] || '') + ((user?.lastName || '')[0] || '')
  ).toUpperCase() || 'CO'

  // Bumped on every menu click: the page starts fresh (e.g. "Sessions" while a session's
  // details are open goes back to the list)
  const [navKey, setNavKey] = useState(0)
  const select = (id) => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setNavKey((k) => k + 1)
    setPage(id)
    setMenuOpen(false)
    try { localStorage.setItem('smartathlete.page', id) } catch { /* ignore */ }
  }
  // A page that no longer exists (e.g. remembered from an older version) falls back to the dashboard
  const current = nav.some((g) => g.items.some((i) => i.id === page)) ? page : 'dashboard'
  const shown = data

  const views = shown && {
    dashboard: <Dashboard d={shown} go={select} />,
    athletes: <Athletes d={shown} onChanged={reload} />,
    sessions: <Sessions d={shown} user={user} onChanged={reload} />,
    load: <LoadFatigue d={shown} />,
    analytics: <Analytics d={shown} />,
    attendance: <Attendance d={shown} />,
    reports: <Reports d={shown} user={user} />,
    settings: <Settings user={user} onLogout={onLogout} />,
  }

  return (
    <div className="coach-app" ref={rootRef} data-theme={mode} data-bs-theme={mode}>
      <header className="sa-topbar d-flex align-items-center justify-content-between px-3 px-lg-4">
        <div className="d-flex align-items-center gap-2">
          <button className="btn btn-sm d-lg-none border-0 p-0 me-1" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
            <i className="bi bi-list fs-4" />
          </button>
          <span className="sa-logo"><i className="bi bi-person-fill" /></span>
          <span className="sa-brand">SmartAthlete</span>
          <span className="sa-brand-sub d-none d-sm-inline">EVSU ORMOC</span>
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className="sa-chip d-none d-md-inline">{user?.firstName} {user?.lastName} · <b>Coach</b> · <b>{data ? data.roster.length : '…'} athletes</b></span>
          <span className="sa-chip d-none d-md-inline">{today}</span>
          <button className="btn btn-sm border-0" onClick={reload} disabled={loading} id="refresh-btn" title="Refresh data">
            <i className={`bi bi-arrow-clockwise ${loading ? 'spinner-border spinner-border-sm' : ''}`} />
          </button>
          <button
            className="sa-icon-btn"
            onClick={toggleMode}
            id="theme-btn"
            aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={mode === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            <i className={`bi ${mode === 'dark' ? 'bi-sun' : 'bi-moon-stars'}`} />
          </button>
          <NotificationBell alerts={data ? data.alerts : null} onSelect={select} />
          <div className="dropdown">
            <button className="sa-avatar" data-bs-toggle="dropdown" aria-expanded="false" id="user-menu" title={user?.email}>
              {photoUrl ? <img src={photoUrl} alt="" className="sa-avatar-img" /> : initials}
            </button>
            <ul className="dropdown-menu dropdown-menu-end shadow-sm">
              <li className="px-3 py-1 small text-muted">{user?.email}</li>
              <li><hr className="dropdown-divider" /></li>
              <li><button className="dropdown-item" onClick={() => select('settings')}><i className="bi bi-gear me-2" />Settings</button></li>
              <li><button className="dropdown-item" onClick={onLogout}><i className="bi bi-box-arrow-right me-2" />Sign out</button></li>
            </ul>
          </div>
        </div>
      </header>

      <div className="d-flex">
        <aside className="sa-sidebar">
          <NavList page={current} onSelect={select} />
        </aside>

        {menuOpen && (
          <>
            <div className="offcanvas-backdrop fade show" onClick={() => setMenuOpen(false)} />
            <aside className="offcanvas offcanvas-start show sa-offcanvas p-2" style={{ visibility: 'visible' }}>
              <NavList page={current} onSelect={select} />
            </aside>
          </>
        )}

        <main className="sa-content flex-grow-1">
          {error && (
            <div className="alert alert-danger d-flex justify-content-between align-items-center">
              <span>Could not load data: {error}</span>
              <button className="btn btn-sm btn-outline-danger" onClick={reload}>Retry</button>
            </div>
          )}
          {!data && loading && (
            <div className="text-center py-5 text-muted"><div className="spinner-border text-success mb-2" /><div>Loading team data…</div></div>
          )}
          {shown && <Fragment key={navKey}>{views[current]}</Fragment>}
        </main>
      </div>
    </div>
  )
}
