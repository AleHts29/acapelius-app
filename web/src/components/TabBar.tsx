import { Link, useLocation } from 'react-router-dom'

import type { Role } from '../api/client'
import { navFor } from './nav'

/** Navegación de celular: barra fija abajo. En escritorio la reemplaza SideNav. */
export function TabBar({ role }: { role: Role }) {
  const location = useLocation()
  const visible = navFor(role)
  if (visible.length < 2) return null // door solo tiene Puerta: sin tab bar

  return (
    <nav className="tabbar" aria-label="Navegación principal">
      <div className="tabbar__inner">
        {visible.map((tab) => {
          const active = tab.matches(location.pathname)
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
