import { useState } from 'react'
import { supabase } from '../supabaseClient'

function Login({ onToggle }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('Coach')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)   // { type: 'success' | 'error', text: '' }

  const roles = ['Coach', 'Coordinator']

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const input = username.trim()
      const isEmail = input.includes('@')

      // 1. Look up coach/coordinator profile in tbl_coaches
      let coachQuery = supabase
        .from('tbl_coaches')
        .select('email, password, role')

      if (isEmail) {
        coachQuery = coachQuery.ilike('email', input)
      } else {
        coachQuery = coachQuery.ilike('username', input)
      }

      const { data: profile, error: profileError } = await coachQuery.maybeSingle()

      if (profileError) {
        console.error('Profile lookup error:', profileError.message)
      }

      if (!profile || !profile.email) {
        setMessage({
          type: 'error',
          text: isEmail
            ? 'No account found with that email address.'
            : 'Username not found. Please check your username or use your email address.',
        })
        return
      }

      // 2. Validate against active password in tbl_coaches (ground truth)
      if (profile.password && profile.password !== password) {
        setMessage({
          type: 'error',
          text: 'Invalid username/email or password.',
        })
        return
      }

      // 3. Verify role
      const userRole = profile.role
      if (userRole && userRole.toLowerCase() !== role.toLowerCase()) {
        setMessage({
          type: 'error',
          text: `Role mismatch: This account is registered as "${userRole}", not "${role}". Please select the correct role.`,
        })
        return
      }

      const emailToUse = profile.email

      // 4. Attempt Supabase Auth sign-in to establish session
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password,
      })

      if (authError) {
        console.warn('Supabase Auth session notice:', authError.message)
      }

      setMessage({ type: 'success', text: `Successfully logged in as ${role}!` })
    } catch (err) {
      console.error('Login error:', err)
      setMessage({
        type: 'error',
        text: err.message || 'An unexpected error occurred. Please try again.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      {/* Left Branding Panel */}
      <div className="login-brand-panel">
        <div className="brand-header">
          <div className="brand-logo">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="brand-name">SmartAthlete</span>
          <span className="brand-subtitle">EVSU ORMOC</span>
        </div>

        <h1 className="brand-tagline">
          Objective training data, from the wrist to the whiteboard.
        </h1>
      </div>

      {/* Right Form Panel */}
      <div className="login-form-panel">
        <div className="login-form-container">
          <div className="form-fade" key="signin">
            <h2 className="login-form-title">Sign in</h2>
            <p className="login-form-subtitle">
              Use your EVSU Ormoc account
            </p>

            {message && (
              <div className={`login-message ${message.type}`}>
                {message.text}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="username-input">
                  Username or Email
                </label>
                <input
                  id="username-input"
                  className="form-input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username or you@evsu.edu.ph"
                  autoComplete="username"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="password-input">
                  Password
                </label>
                <input
                  id="password-input"
                  className="form-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </div>

              <div className="form-group">
                <span className="role-label">Sign in as</span>
                <div className="role-toggle">
                  {roles.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`role-btn${role === r ? ' active' : ''}`}
                      onClick={() => setRole(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <button type="submit" className="login-btn" id="sign-in-btn" disabled={loading}>
                <span>{loading ? 'Signing in…' : 'Sign in'}</span>
              </button>
            </form>

            <div className="toggle-mode">
              <span className="toggle-mode-text">
                Don't have an account?
              </span>
              <button
                type="button"
                className="toggle-mode-btn"
                onClick={onToggle}
                id="toggle-mode-btn"
              >
                Create account
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Help Button */}
      <button className="help-btn" id="help-btn" aria-label="Help">
        ?
      </button>
    </div>
  )
}

export default Login
