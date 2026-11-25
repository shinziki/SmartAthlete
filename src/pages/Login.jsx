import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { emailHash, hashPassword, isMaskedEmail, isMissingPrivacyColumn, verifyPassword } from '../privacy'

function Login({ onToggle, onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)   // { type: 'success' | 'error', text: '' }


  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const input = username.trim()
      const isEmail = input.includes('@')

      // 1. Look up the coach's profile in tbl_coaches
      // '*' works before and after the privacy migration
      const coachQuery = () => supabase.from('tbl_coaches').select('*')
      let { data: profile, error: profileError } = isEmail
        ? await coachQuery().eq('email_hash', await emailHash(input)).maybeSingle()
        : await coachQuery().ilike('username', input).maybeSingle()

      if (isEmail && isMissingPrivacyColumn(profileError)) {
        // Database not migrated yet: rows still hold the plain email
        ;({ data: profile, error: profileError } = await coachQuery().ilike('email', input).maybeSingle())
      }

      if (profileError) {
        console.error('Profile lookup error:', profileError.message)
      }

      if (!profile) {
        setMessage({
          type: 'error',
          text: isEmail
            ? 'No account found with that email address.'
            : 'Username not found. Please check your username or use your email address.',
        })
        return
      }

      // 2. Validate against the password hash in tbl_coaches
      const check = await verifyPassword(password, profile.password)
      if (!check.ok) {
        setMessage({
          type: 'error',
          text: 'Invalid username/email or password.',
        })
        return
      }

      if (check.needsUpgrade) {
        // Older row still holding a plain-text password: store it hashed from now on
        const passwordHash = await hashPassword(password)
        await supabase
          .from('tbl_coaches')
          .update({ password: passwordHash, confirmPassword: passwordHash })
          .eq('id', profile.id)
      }

      // The table only has a masked email; Supabase Auth needs the real one
      let emailToUse = isEmail ? input : null
      if (!emailToUse) {
        const { data: resolved } = await supabase.rpc('login_email_for_username', {
          p_username: input,
          p_role: 'coach',
        })
        emailToUse = typeof resolved === 'string' && resolved ? resolved : null
        // Before the migration the row's email column is still the real email
        if (!emailToUse && profile.email && !isMaskedEmail(profile.email)) emailToUse = profile.email
      }

      // 4. Attempt Supabase Auth sign-in to establish session
      let meta = {}
      if (emailToUse) {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: emailToUse,
          password,
        })

        if (authError) {
          console.warn('Supabase Auth session notice:', authError.message)
        }
        meta = authData?.user?.user_metadata ?? {}
      }

      setMessage({ type: 'success', text: 'Successfully signed in!' })
      // Real names come from Auth; the table only holds masked ones
      onLogin?.({
        email: emailToUse || profile.email,
        emailHash: profile.email_hash,
        role: 'Coach',
        firstName: meta.firstName || profile.firstName,
        middleName: meta.middleName || profile.middleName,
        lastName: meta.lastName || profile.lastName,
        username: profile.username,
        birthdate: profile.birthdate,
        gender: profile.gender,
      })
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
