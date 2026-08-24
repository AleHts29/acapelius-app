import { Link } from 'react-router-dom'

import { useSession } from '../auth/session'

/** Lo que cada rol va a poder hacer, y en que fase del plan llega. */
const ROADMAP: Record<string, string[]> = {
  admin: ['Panel de rendiciones y asistencia (fase 5)'],
  seller: ['Ver el saldo a rendir (fase 5)'],
  door: ['Modo offline con la lista precargada (fase 4)'],
}

export function HomePage() {
  const { user } = useSession()
  if (!user) return null

  const pendientes = ROADMAP[user.role] ?? []

  return (
    <>
      <div className="panel">
        <p className="panel__label">Sesion iniciada</p>
        <h2>{user.name}</h2>
        <p className="muted" style={{ margin: '0.25rem 0 0' }}>
          {user.email}
        </p>
      </div>

      <nav className="stack" style={{ marginTop: '1rem' }} aria-label="Puerta">
        <Link className="nav-card" to="/puerta">
          <span>
            <strong>Modo puerta</strong>
            <br />
            <span className="muted">Escanear QR y marcar ingresos</span>
          </span>
          <span className="muted">›</span>
        </Link>
      </nav>

      {(user.role === 'admin' || user.role === 'seller') && (
        <nav className="stack" style={{ marginTop: '0.75rem' }} aria-label="Secciones">
          <Link className="nav-card" to="/ventas/nueva">
            <span>
              <strong>{user.role === 'admin' ? 'Nueva venta o cortesia' : 'Nueva venta'}</strong>
              <br />
              <span className="muted">Registrar y mandar la entrada</span>
            </span>
            <span className="muted">›</span>
          </Link>
          <Link className="nav-card" to="/ventas">
            <span>
              <strong>{user.role === 'admin' ? 'Ventas' : 'Mis ventas'}</strong>
              <br />
              <span className="muted">Pagos, links y reenvios</span>
            </span>
            <span className="muted">›</span>
          </Link>
        </nav>
      )}

      {user.role === 'admin' && (
        <nav className="stack" style={{ marginTop: '0.75rem' }} aria-label="Administracion">
          <Link className="nav-card" to="/temporadas">
            <span>
              <strong>Temporadas y funciones</strong>
              <br />
              <span className="muted">Fechas, cupos y precios</span>
            </span>
            <span className="muted">›</span>
          </Link>
          <Link className="nav-card" to="/usuarios">
            <span>
              <strong>Usuarios</strong>
              <br />
              <span className="muted">Vendedoras, puerta y direccion</span>
            </span>
            <span className="muted">›</span>
          </Link>
        </nav>
      )}

      {pendientes.length > 0 && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <p className="panel__label">Todavia no disponible</p>
          <ul className="stack" style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {pendientes.map((item) => (
              <li key={item} className="muted">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
