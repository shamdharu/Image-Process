import { useState } from 'react'
import { Aperture, LogIn, UserPlus } from 'lucide-react'
import './Loginpage.css'

export default function LoginPage({ onLogin }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [isSignup, setIsSignup] = useState(false)
  const [notice, setNotice] = useState('')
  const [createdUser, setCreatedUser] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    if (!identifier.trim() || !password) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/${isSignup ? 'signup' : 'login'}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isSignup ? { email: identifier.trim(), password } : { identifier: identifier.trim(), password }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || (isSignup ? 'Could not create your account' : 'Invalid username/email or password'))
      }
      const user = await response.json()
      if (isSignup) {
        setCreatedUser(user)
        setNotice('')
        setIsSignup(false)
        setPassword('')
      } else onLogin(user)
    } catch (err) {
      setError(err.message || 'Something went wrong logging in')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><Aperture size={22} /><span>IMAGINARY</span></div>
        {createdUser ? <section className="welcome-card">
          <div className="welcome-icon"><UserPlus size={22} /></div>
          <p className="login-subtitle">Welcome, {createdUser.username}</p>
          <h2>Your account is ready</h2>
          <p>Your account has been created with <strong>{createdUser.email}</strong>.</p>
          <p className="welcome-note">An administrator will grant access to the folders you need. You can sign in now.</p>
          <button className="upload-button login-submit" type="button" onClick={() => setCreatedUser(null)}><LogIn size={15} /> Continue to sign in</button>
        </section> : <>
        <p className="login-subtitle">{isSignup ? 'Create your workspace account' : 'Sign in to your workspace'}</p>
        <label className="dialog-label">{isSignup ? 'Email' : 'Username or email'}
          <input autoFocus type={isSignup ? 'email' : 'text'} value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={isSignup ? 'you@company.com' : 'e.g. admin001 or you@company.com'} />
        </label>
        <label className="dialog-label">Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" />
        </label>
        {error && <p className="login-error">{error}</p>}
        {notice && <p className="login-notice">{notice}</p>}
        <button className="upload-button login-submit" type="submit" disabled={submitting || !identifier.trim() || !password}>
          {isSignup ? <UserPlus size={15} /> : <LogIn size={15} />} {submitting ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
        </button>
        <button className="login-switch" type="button" onClick={() => { setIsSignup((value) => !value); setError(''); setNotice(''); setPassword('') }}>
          {isSignup ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
        </button>
        </>}
      </form>
    </div>
  )
}
