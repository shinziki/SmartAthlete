import { useState } from 'react'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import './coach.css'
import { useCoachData } from './useCoachData'
import {
  Dashboard, Athletes, Sessions, LoadFatigue, Attendance, Placeholder,
} from './CoachPages'

const nav = [
  { group: 'Coaching', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'bi-grid-fill' },
    { id: 'athletes', label: 'Athletes', icon: 'bi-people-fill' },
    { id: 'sessions', label: 'Sessions', icon: 'bi-activity' },
    { id: 'load', label: 'Load & Fatigue', icon: 'bi-heart-pulse-fill' },
    { id: 'attendance', label: 'Attendance', icon: 'bi-geo-alt-fill' },
  ] },
  { group: 'Program', items: [
    { id: 'reports', label: 'Reports', icon: 'bi-file-earmark-text-fill' },
    { id: 'settings', label: 'Settings', icon: 'bi-gear-fill' },
  ] },
]

function NavList({ page, onSelect }) {
  return nav.map((g) => (
    <div key={g.group}>
      <div className="sa-nav-label">{g.group}</div>
      {g.items.map((i) => (
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
  ))
}

export default function CoachApp({ user, onLogout }) {
  const [page, setPage] = useState('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const { data, loading, error, reload } = useCoachData()
  const today = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

  const initials = (
    ((user?.firstName || '')[0] || '') + ((user?.lastName || '')[0] || '')
  ).toUpperCase() || 'CO'

  const select = (id) => { setPage(id); setMenuOpen(false) }

  const views = data && {
    dashboard: <Dashboard d={data} go={select} />,
    athletes: <Athletes d={data} />,
    sessions: <Sessions d={data} />,
    load: <LoadFatigue d={data} />,
    attendance: <Attendance d={data} />,
    reports: <Placeholder title="Reports" icon="bi-file-earmark-text-fill" />,
    settings: <Placeholder title="Settings" icon="bi-gear-fill" />,
  }

  return (
    <div className="coach-app">
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
          <span className="sa-chip d-none d-md-inline">{user?.firstName} {user?.lastName} · <b>{data ? data.roster.length : '…'} athletes</b></span>
          <span className="sa-chip d-none d-md-inline">{today}</span>
          <button className="btn btn-sm border-0" onClick={reload} disabled={loading} id="refresh-btn" title="Refresh data">
            <i className={`bi bi-arrow-clockwise ${loading ? 'spinner-border spinner-border-sm' : ''}`} />
          </button>
          <div className="dropdown">
            <button className="sa-avatar" data-bs-toggle="dropdown" aria-expanded="false" id="user-menu" title={user?.email}>
              {initials}
            </button>
            <ul className="dropdown-menu dropdown-menu-end shadow-sm">
              <li className="px-3 py-1 small text-muted">{user?.email}</li>
              <li><hr className="dropdown-divider" /></li>
              <li><button className="dropdown-item" onClick={onLogout}><i className="bi bi-box-arrow-right me-2" />Sign out</button></li>
            </ul>
          </div>
        </div>
      </header>

      <div className="d-flex">
        <aside className="sa-sidebar">
          <NavList page={page} onSelect={select} />
        </aside>

        {menuOpen && (
          <>
            <div className="offcanvas-backdrop fade show" onClick={() => setMenuOpen(false)} />
            <aside className="offcanvas offcanvas-start show sa-offcanvas p-2" style={{ visibility: 'visible' }}>
              <NavList page={page} onSelect={select} />
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
          {data && views[page]}
        </main>
      </div>
    </div>
  )
}
