import { useEffect, useState, lazy, Suspense } from 'react'
import Login from './pages/Login'
import Register from './pages/Register'
import { supabase } from './supabaseClient'

// Lazy-loaded so Bootstrap's global styles only apply to the coach portal,
// not the existing login/register screens.
const CoachApp = lazy(() => import('./coach/CoachApp'))

/**
 * The signed-in staff member, kept in localStorage so the login survives closing the tab
 * or browser and restarting the computer. It is removed only when they sign out (in any
 * tab: the other open tabs sign out too). Supabase keeps its own Auth session next to it.
 */
const SESSION_KEY = 'smartathlete.user'

function readStoredUser() {
  try {
    const saved = localStorage.getItem(SESSION_KEY)
    if (saved) return JSON.parse(saved)
    // Logins from before this change were kept per tab: move them over once
    const old = sessionStorage.getItem(SESSION_KEY)
    if (old) {
      localStorage.setItem(SESSION_KEY, old)
      sessionStorage.removeItem(SESSION_KEY)
      return JSON.parse(old)
    }
  } catch { /* storage blocked: not signed in */ }
  return null
}

function App() {
  const [page, setPage] = useState('login')
  const [user, setUser] = useState(readStoredUser)

  // Signing in or out in another tab applies here too
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === SESSION_KEY) setUser(readStoredUser())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const togglePage = () => {
    setPage((prev) => (prev === 'login' ? 'register' : 'login'))
  }

  const handleLogin = (profile) => {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(profile)) } catch { /* ignore */ }
    setUser(profile)
  }

  const handleLogout = async () => {
    try {
      localStorage.removeItem(SESSION_KEY)
      localStorage.removeItem('smartathlete.page')
      sessionStorage.removeItem(SESSION_KEY)
    } catch { /* ignore */ }
    setUser(null)
    setPage('login')
    // Ends the Supabase Auth session as well (also removes its stored token)
    try { await supabase.auth.signOut() } catch { /* ignore */ }
  }

  // The web portal is the coach's: athletes use the mobile app
  if (user) {
    return (
      <Suspense fallback={null}>
        <CoachApp user={user} onLogout={handleLogout} />
      </Suspense>
    )
  }

  return page === 'login'
    ? <Login onToggle={togglePage} onLogin={handleLogin} />
    : <Register onToggle={togglePage} />
}

export default App
