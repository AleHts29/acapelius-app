import { roleLabel } from '../api/client'
import { useSession } from '../auth/session'

/** Lo que cada rol va a poder hacer, y en que fase del plan llega. */
const ROADMAP: Record<string, string[]> = {
  admin: [
    'Temporadas y funciones (fase 1)',
    'Ventas, cortesias y anulaciones (fase 2)',
    'Panel de ventas, rendiciones y asistencia (fase 5)',
  ],
  seller: [
    'Registrar ventas y enviar entradas (fase 2)',
    'Marcar pagos y ver el saldo a rendir (fase 5)',
  ],
  door: [
    'Escanear QR en la puerta (fase 3)',
    'Modo offline con la lista precargada (fase 4)',
  ],
}

export function HomePage() {
  const { user, logout } = useSession()
  if (!user) return null

  const pendientes = ROADMAP[user.role] ?? []

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__brand">Acapelius</span>
        <span className="app-header__user">
          <span className="badge">{roleLabel(user.role)}</span>
          <button className="button button--ghost" type="button" onClick={() => void logout()}>
            Salir
          </button>
        </span>
      </header>

      <main className="app-main">
        <div className="panel">
          <p className="panel__label">Sesion iniciada</p>
          <h2>{user.name}</h2>
          <p className="muted" style={{ margin: '0.25rem 0 0' }}>
            {user.email}
          </p>
        </div>

        <div className="panel">
          <p className="panel__label">Todavia no disponible</p>
          <ul className="stack" style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {pendientes.map((item) => (
              <li key={item} className="muted">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  )
}
