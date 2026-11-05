import { Link, useLocation } from 'react-router-dom'

import type { Role } from '../api/client'
import { activeItem, tabsFor } from './nav'
import type { NavItem } from './nav'

/**
 * Navegación de celular: barra fija abajo, con escanear en el botón redondo del
 * medio (como el QR de una billetera). En escritorio la reemplaza SideNav. Cada
 * lado reparte su mitad: el botón queda centrado aunque un lado tenga menos.
 */
export function TabBar({ role }: { role: Role }) {
  const location = useLocation()
  const visible = tabsFor(role)
  const activo = activeItem(visible, location.pathname)
  if (visible.length < 2) return null // door solo tiene Puerta: sin tab bar

  const medio = visible.findIndex((tab) => tab.centro)
  const pestana = (tab: NavItem) => {
    const active = tab === activo
    const Icon = tab.icon
    return (
      <Link key={tab.to} to={tab.to} aria-current={active ? 'page' : undefined}>
        <Icon size={19} strokeWidth={active ? 2.4 : 2} aria-hidden />
        {tab.label}
      </Link>
    )
  }
  const centro = visible[medio]
  const IconoCentro = centro?.icon

  return (
    <nav className="tabbar" aria-label="Navegación principal">
      <div className="tabbar__inner">
        <div className="tabbar__lado">{visible.slice(0, medio).map(pestana)}</div>
        {centro && IconoCentro && (
          // Con función hoy, el botón va directo a escanear (lo resuelve Puerta).
          <Link
            className="tabbar__centro"
            to={`${centro.to}?escanear=1`}
            aria-current={centro === activo ? 'page' : undefined}
          >
            <span className="tabbar__disco">
              <IconoCentro size={25} strokeWidth={2.2} aria-hidden />
            </span>
            {centro.label}
          </Link>
        )}
        <div className="tabbar__lado">{visible.slice(medio + 1).map(pestana)}</div>
      </div>
    </nav>
  )
}
