import { useState } from 'react'
import type { FormEvent } from 'react'

import { ApiError } from '../api/client'
import { useSession } from '../auth/session'

/** Tiene que coincidir con domain.MinPasswordLength en el backend. */
const MIN_PASSWORD_LENGTH = 8

export function ChangePasswordPage() {
  const { user, changePassword, logout } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (next !== repeat) {
      setError('Las dos contrasenas nuevas no coinciden.')
      return
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`La contrasena nueva necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
      return
    }

    setSubmitting(true)
    try {
      await changePassword(current, next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar la contrasena.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="centered-screen">
      <form className="card" onSubmit={handleSubmit} noValidate>
        <h1 className="card__title">Elegi tu contrasena</h1>
        <p className="card__subtitle">
          Hola {user?.name}. Antes de seguir, cambia la contrasena provisoria por una tuya.
        </p>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        {/* Oculto pero presente: los gestores de contrasenas necesitan el
            usuario para asociar la credencial nueva. */}
        <input type="text" name="username" value={user?.email ?? ''} autoComplete="username" hidden readOnly />

        <label className="field">
          <span className="field__label">Contrasena provisoria</span>
          <input
            className="field__input"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field__label">Contrasena nueva</span>
          <input
            className="field__input"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <span className="field__hint">Al menos {MIN_PASSWORD_LENGTH} caracteres.</span>
        </label>

        <label className="field">
          <span className="field__label">Repetila</span>
          <input
            className="field__input"
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>

        <button className="button" type="submit" disabled={submitting}>
          {submitting ? 'Guardando...' : 'Guardar y entrar'}
        </button>

        <p style={{ marginBottom: 0, marginTop: '1rem', textAlign: 'center' }}>
          <button className="button--ghost button" type="button" onClick={() => void logout()}>
            Salir
          </button>
        </p>
      </form>
    </div>
  )
}
