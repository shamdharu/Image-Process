import { useState } from 'react'
import { Aperture, LogIn } from 'lucide-react'
import './Loginpage.css'

export default function LoginPage({ onLogin }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (!identifier.trim() || !password) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('http://localhost:4000/api/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Invalid username/email or password')
      }
      const user = await response.json()
      onLogin(user)
    } catch (err) {
      setError(err.message || 'Something went wrong logging in')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><Aperture size={20} /><span>IMAGERY</span></div>
        <p className="login-subtitle">Sign in to your workspace</p>
        <label className="dialog-label">Username or email
          <input autoFocus value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="e.g. admin001 or you@company.com" />
        </label>
        <label className="dialog-label">Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button className="upload-button login-submit" type="submit" disabled={submitting || !identifier.trim() || !password}>
          <LogIn size={15} /> {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}