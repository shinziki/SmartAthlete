import { useState, lazy, Suspense } from 'react'
import Login from './pages/Login'
import Register from './pages/Register'
import { supabase } from './supabaseClient'

// Lazy-loaded so Bootstrap's global styles only apply to the coach portal,
// not the existing login/register screens.
const CoachApp = lazy(() => import('./coach/CoachApp'))

const SESSION_KEY = 'smartathlete.user'

function App() {
  const [page, setPage] = useState('login')
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) } catch { return null }
  })

  const togglePage = () => {
    setPage((prev) => (prev === 'login' ? 'register' : 'login'))
  }

  const handleLogin = (profile) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile))
    setUser(profile)
  }

  const handleLogout = async () => {
    sessionStorage.removeItem(SESSION_KEY)
    setUser(null)
    setPage('login')
    try { await supabase.auth.signOut() } catch { /* ignore */ }
  }

  if (user && user.role?.toLowerCase() === 'coach') {
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
