import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'

import { SeasonSelector } from '../season/SeasonSelector'
import { useSession } from '../auth/session'
import { SideNav } from './SideNav'
import { ThemeToggle } from './ThemeToggle'
import { TabBar } from './TabBar'

export function Layout() {
  const { user, logout } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  if (!user) return null

  const initial = user.name.trim().charAt(0).toUpperCase() || 'A'

  return (
    <div className={`app-shell${user.organization_is_demo ? ' app-shell--demo' : ''}`}>
      {/* La única concesión al lenguaje afiche dentro de la app (C17 §C). */}
      {user.organization_is_demo && (
        <div className="demobar" role="status">
          <span>Estás en la demo · los datos se reinician cada noche</span>
          <a href="/crear-cuenta">Crear mi cuenta</a>
        </div>
      )}
      <SideNav user={user} onLogout={() => void logout()} />
      <header className="app-header">
        <Link className="app-header__brand" to="/" aria-label="Inicio">
          <img className="app-header__logo" src="/app/logo-mark-indigo.png" alt="" />
          <span className="app-header__word">ACAPELIUS</span>
        </Link>
        {/* En celular el selector va en el header: es lo único que está en
            todas las pantallas. */}
        <SeasonSelector />
        <div style={{ position: 'relative' }}>
          <button
            className="avatar"
            type="button"
            aria-label={`Cuenta de ${user.name}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {initial}
          </button>
          {menuOpen && (
            <div className="acct-menu">
              <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 13 }}>{user.name}</p>
              <p className="note" style={{ marginBottom: 'var(--s2)' }}>
                {user.email}
              </p>
              <ThemeToggle />
              <button className="btn btn--w" style={{ marginTop: 'var(--s2)' }} type="button" onClick={() => void logout()}>
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="app-main" onClick={() => menuOpen && setMenuOpen(false)}>
        <Outlet />
      </main>

      <TabBar role={user.role} />
    </div>
  )
}
