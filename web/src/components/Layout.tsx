import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'

import { SeasonSelector } from '../season/SeasonSelector'
import { useSession } from '../auth/session'
import { OjoPlata } from './OjoPlata'
import { MiFoto } from './MiFoto'
import { avatarURL } from '../api/client'
import { SideNav } from './SideNav'
import { ThemeToggle } from './ThemeToggle'
import { TabBar } from './TabBar'

export function Layout() {
  const { user, logout } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  // Hasta dos niveles: /panel/rendiciones/5 es la misma pantalla que /panel/rendiciones.
  const pantalla = useLocation().pathname.split('/').slice(0, 3).join('/')
  // Cada pantalla arranca arriba. Sin esto, venir scrolleado de una pantalla
  // larga a una corta deja a iOS con el scroll viejo y la barra de abajo flotando.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pantalla])
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
          <span className="sello" aria-hidden />
          <span className="app-header__word">ACAPELIUS</span>
        </Link>
        {/* En celular el selector va en el header: es lo único que está en
            todas las pantallas. */}
        <SeasonSelector />
        <OjoPlata />
        <div style={{ position: 'relative' }}>
          <button
            className={`avatar${user.avatar_at ? ' con-foto' : ''}`}
            type="button"
            aria-label={`Cuenta de ${user.name}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {user.avatar_at ? <img src={avatarURL(user.id, user.avatar_at)} alt="" /> : initial}
          </button>
          {menuOpen && (
            <div className="acct-menu">
              <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 13 }}>{user.name}</p>
              <p className="note" style={{ marginBottom: 'var(--s2)' }}>
                {user.email}
              </p>
              {!user.organization_is_demo && <MiFoto tieneFoto={!!user.avatar_at} />}
              <ThemeToggle />
              <button className="btn btn--w" style={{ marginTop: 'var(--s2)' }} type="button" onClick={() => void logout()}>
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="app-main" onClick={() => menuOpen && setMenuOpen(false)}>
        <div className="page" key={pantalla}>
          <Outlet />
        </div>
      </main>

      <TabBar role={user.role} />
    </div>
  )
}
