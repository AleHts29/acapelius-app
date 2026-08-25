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
          <span className="app-header__brand">
            <img className="app-header__logo" src="/logo-mark.png" alt="" />
            Acapelius
          </span>
        ) : (
          <Link className="app-header__brand app-header__back" to="/">
            <img className="app-header__logo" src="/logo-mark.png" alt="" />
            Acapelius
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
