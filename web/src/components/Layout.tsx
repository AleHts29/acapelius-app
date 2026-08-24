import { Link, Outlet, useLocation } from 'react-router-dom'

import { roleLabel } from '../api/client'
import { useSession } from '../auth/session'

export function Layout() {
  const { user, logout } = useSession()
  const location = useLocation()
  if (!user) return null

  const atHome = location.pathname === '/'

  return (
    <div className="app-shell">
      <header className="app-header">
        {atHome ? (
          <span className="app-header__brand">Acapelius</span>
        ) : (
          <Link className="app-header__brand app-header__back" to="/">
            ‹ Acapelius
          </Link>
        )}
        <span className="app-header__user">
          <span className="badge">{roleLabel(user.role)}</span>
          <button className="button button--ghost" type="button" onClick={() => void logout()}>
            Salir
          </button>
        </span>
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
