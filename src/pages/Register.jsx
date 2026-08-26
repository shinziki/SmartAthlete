import { useState } from 'react'
import { supabase } from '../supabaseClient'

function Register({ onToggle }) {
  const [role, setRole] = useState('Coach')

  const roles = ['Coach', 'Coordinator']

  const [formData, setFormData] = useState({ firstName: '', middleName: '', lastName: '', username: '', birthdate: '', gender: '', email: '', password: '', confirmPassword: '', role: '' })
  const [status, setStatus] = useState({ loading: false, error: null, success: false })

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setStatus({ loading: true, error: null, success: false })

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setStatus({ loading: false, error: 'Passwords do not match.', success: false })
      return
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            firstName: formData.firstName,
            middleName: formData.middleName,
            lastName: formData.lastName,
            username: formData.username,
            birthdate: formData.birthdate,
            gender: formData.gender,
            role: role,
          },
        },
      })

      if (error) {
        setStatus({ loading: false, error: error.message, success: false })
        return
      }

      // Insert profile data into the profiles table
      const { error: profileError } = await supabase
        .from('tbl_coaches')
        .insert({
          firstName: formData.firstName,
          middleName: formData.middleName,
          lastName: formData.lastName,
          username: formData.username,
          birthdate: formData.birthdate,
          gender: formData.gender,
          email: formData.email,
          password: formData.password,
          confirmPassword: formData.confirmPassword,
          role: role,
        })

      if (profileError) {
        console.error('Profile insert error:', profileError)
        setStatus({ loading: false, error: profileError.message, success: false })
        return
      }

      setStatus({ loading: false, error: null, success: true, message: 'Account created successfully!' })
      setFormData({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '', role: '' })
    } catch (err) {
      console.error('Registration error:', err)
      setStatus({ loading: false, error: 'An unexpected error occurred. Please try again.', success: false })
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
          Join the team. Start tracking smarter.
        </h1>
      </div>

      {/* Right Form Panel */}
      <div className="login-form-panel">
        <div className="login-form-container">
          <div className="form-fade" key="signup">
            <h2 className="login-form-title">Create account</h2>
            <p className="login-form-subtitle">
              Register your EVSU Ormoc account
            </p>

            {status.error && (
              <div style={{ color: '#ff4d4f', background: 'rgba(255,77,79,0.1)', padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.9rem' }}>
                {status.error}
              </div>
            )}

            {status.success && status.message && (
              <div style={{ color: '#52c41a', background: 'rgba(82,196,26,0.1)', padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.9rem' }}>
                {status.message}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="firstname-input">
                    First name
                  </label>
                  <input
                    id="firstname-input"
                    name="firstName"
                    className="form-input"
                    type="text"
                    value={formData.firstName}
                    onChange={handleChange}
                    placeholder="Juan"
                    autoComplete="given-name"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="middlename-input">
                    Middle name
                  </label>
                  <input
                    id="middlename-input"
                    name="middleName"
                    className="form-input"
                    type="text"
                    value={formData.middleName}
                    onChange={handleChange}
                    placeholder="Santos"
                    autoComplete="given-name"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="lastname-input">
                    Last name
                  </label>
                  <input
                    id="lastname-input"
                    name="lastName"
                    className="form-input"
                    type="text"
                    value={formData.lastName}
                    onChange={handleChange}
                    placeholder="Dela Cruz"
                    autoComplete="family-name"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="username-input">
                  Username
                </label>
                <input
                  id="username-input"
                  name="username"
                  className="form-input"
                  type="text"
                  value={formData.username}
                  onChange={handleChange}
                  placeholder=""
                  autoComplete="username"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="birthdate-input">
                  Birthdate
                </label>
                <input
                  id="birthdate-input"
                  name="birthdate"
                  className="form-input"
                  type="date"
                  value={formData.birthdate}
                  onChange={handleChange}
                  autoComplete="birthdate"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="gender-input">
                  Gender
                </label>
                <select
                  id="gender-input"
                  name="gender"
                  className="form-input"
                  value={formData.gender}
                  onChange={handleChange}
                >
                  <option value="default" selected>Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="email-input">
                  School Email
                </label>
                <input
                  id="email-input"
                  name="email"
                  className="form-input"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="you@evsu.edu.ph"
                  autoComplete="username"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="password-input">
                  Password
                </label>
                <input
                  id="password-input"
                  name="password"
                  className="form-input"
                  type="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="confirm-password-input">
                  Confirm password
                </label>
                <input
                  id="confirm-password-input"
                  name="confirmPassword"
                  className="form-input"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>

              <div className="form-group">
                <span className="role-label">Sign up as</span>
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

              <button type="submit" className="login-btn" id="sign-up-btn" disabled={status.loading}>
                <span>{status.loading ? 'Creating account...' : 'Create account'}</span>
              </button>
            </form>

            <div className="toggle-mode">
              <span className="toggle-mode-text">
                Already have an account?
              </span>
              <button
                type="button"
                className="toggle-mode-btn"
                onClick={onToggle}
                id="toggle-mode-btn"
              >
                Sign in
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

export default Register
