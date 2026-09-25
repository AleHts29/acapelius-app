import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'

import { SeasonSelector } from '../season/SeasonSelector'
import { useSession } from '../auth/session'
import { SideNav } from './SideNav'
import { TabBar } from './TabBar'

export function Layout() {
  const { user, logout } = useSession()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  if (!user) return null

  const initial = user.name.trim().charAt(0).toUpperCase() || 'A'
  // Las pantallas de dirección son listas largas y tablas: en escritorio se les
  // da más ancho que a las de venta, que son de una columna.
  const wide = location.pathname.startsWith('/direccion') || location.pathname.startsWith('/panel')
  // En el celular el modo puerta es pantalla completa: es táctil y el visor
  // necesita todo el alto. En escritorio es una mesa de entrada más, con su
  // navegación al lado; sin ella la columna quedaba flotando en el medio.
  const puerta = /^\/puerta\/\d/.test(location.pathname)

  return (
    <div className={`app-shell${puerta ? ' app-shell--puerta' : ''}`}>
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
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 6px)',
                zIndex: 60,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                padding: '10px 12px',
                minWidth: 180,
                boxShadow: '0 8px 24px rgba(29,29,27,.12)',
              }}
            >
              <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 13 }}>{user.name}</p>
              <p className="muted" style={{ margin: '0 0 10px', fontSize: 11.5 }}>
                {user.email}
              </p>
              <button className="button button--ghost" style={{ width: '100%' }} type="button" onClick={() => void logout()}>
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </header>

      <main className={`app-main${wide ? ' app-main--wide' : ''}`} onClick={() => menuOpen && setMenuOpen(false)}>
        <Outlet />
      </main>

      <TabBar role={user.role} />
    </div>
  )
}
