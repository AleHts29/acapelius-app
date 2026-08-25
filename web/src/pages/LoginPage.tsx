import { useState } from 'react'
import type { FormEvent } from 'react'

import { ApiError } from '../api/client'
import { useSession } from '../auth/session'

export function LoginPage() {
  const { login } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesion.')
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="centered-screen">
      <form className="card" onSubmit={handleSubmit} noValidate>
        <img className="login-logo" src="/logo-full.png" alt="Acapelius" />
        <p className="card__subtitle" style={{ textAlign: 'center' }}>
          Entradas del coro
        </p>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="field__input"
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field__label">Contrasena</span>
          <input
            className="field__input"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button className="button" type="submit" disabled={submitting}>
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
