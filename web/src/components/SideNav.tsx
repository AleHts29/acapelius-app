import { Link, useLocation } from 'react-router-dom'
import { LogOut } from 'lucide-react'

import type { User } from '../api/client'
import { roleLabel } from '../api/client'
import { navFor } from './nav'

/**
 * Navegación de escritorio: columna fija a la izquierda con la marca arriba,
 * las mismas secciones que la barra del celular y la cuenta abajo. Sólo se ve
 * de 1024px para arriba; el CSS decide cuál de las dos navegaciones está en
 * pantalla, así que las dos se renderizan siempre y ninguna necesita saber del
 * tamaño de la ventana.
 */
export function SideNav({ user, onLogout }: { user: User; onLogout: () => void }) {
  const location = useLocation()
  const items = navFor(user.role)
  const initial = user.name.trim().charAt(0).toUpperCase() || 'A'

  return (
    <nav className="sidenav" aria-label="Navegación principal">
      <Link className="sidenav__brand" to="/" aria-label="Inicio">
        <img className="sidenav__logo" src="/logo-mark-blue.png" alt="" />
        <span>ACAPELIUS</span>
      </Link>

      <div className="sidenav__items">
        {items.map((item) => {
          const active = item.matches(location.pathname)
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`sidenav__item${active ? ` sidenav__item--on ${item.activeClass}` : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 2} aria-hidden />
              {item.label}
            </Link>
          )
        })}
      </div>

      <div className="sidenav__account">
        <span className="avatar avatar--sm" aria-hidden>
          {initial}
        </span>
        <span className="sidenav__who">
          <b>{user.name}</b>
          <span className="muted">{roleLabel(user.role)}</span>
        </span>
        <button className="sidenav__out" type="button" onClick={onLogout} aria-label="Cerrar sesión">
          <LogOut size={16} aria-hidden />
        </button>
      </div>
    </nav>
  )
}
