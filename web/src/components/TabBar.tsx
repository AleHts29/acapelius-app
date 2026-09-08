import { Link, useLocation } from 'react-router-dom'

import type { Role } from '../api/client'
import { activeItem, tabsFor } from './nav'

/**
 * Navegación de celular: barra fija abajo. En escritorio la reemplaza SideNav.
 * Se reparte en tantas columnas como pestañas tenga el rol (C12): cuatro para
 * dirección, tres para una corista.
 */
export function TabBar({ role }: { role: Role }) {
  const location = useLocation()
  const visible = tabsFor(role)
  const activo = activeItem(visible, location.pathname)
  if (visible.length < 2) return null // door solo tiene Puerta: sin tab bar

  return (
    <nav className="tabbar" aria-label="Navegación principal">
      <div className="tabbar__inner">
        {visible.map((tab) => {
          const active = tab === activo
          const Icon = tab.icon
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={active ? tab.activeClass : ''}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={19} strokeWidth={active ? 2.4 : 2} aria-hidden />
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
