import { useState } from 'react'
import type { FormEvent } from 'react'

import { ApiError } from '../api/client'
import { useSession } from '../auth/session'
import { Button } from '../ui/Button'

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
      setError('Las dos contraseñas nuevas no coinciden.')
      return
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña nueva necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
      return
    }

    setSubmitting(true)
    try {
      await changePassword(current, next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar la contraseña.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="centered-screen">
      <form
        className="card"
        onSubmit={handleSubmit}
        noValidate
        style={{ width: '100%', maxWidth: 400, padding: 'var(--s5) var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}
      >
        <img className="login-logo" src="/app/logo-full-indigo.png" alt="Acapelius" />
        <h1 className="pgt">Elegí tu contraseña</h1>
        <p className="note">Hola {user?.name}. Antes de seguir, cambiá la contraseña provisoria por una tuya.</p>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        {/* Oculto pero presente: los gestores de contrasenas necesitan el
            usuario para asociar la credencial nueva. */}
        <input type="text" name="username" value={user?.email ?? ''} autoComplete="username" hidden readOnly />

        <label className="field">
          <span className="lbl">Contraseña provisoria</span>
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
          <span className="lbl">Contraseña nueva</span>
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
          <span className="lbl">Repetila</span>
          <input
            className="field__input"
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>

        <Button go wide type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : 'Guardar y entrar'}
        </Button>
        <Button wide onClick={() => void logout()}>
          Salir
        </Button>
      </form>
    </div>
  )
}
