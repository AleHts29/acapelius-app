import { Link, useLocation } from 'react-router-dom'
import { BarChart3, Music, ScanLine, Ticket } from 'lucide-react'

import type { Role } from '../api/client'

interface Tab {
  to: string
  label: string
  icon: typeof Music
  /** Color de la categoria cuando esta activa (design system §3.1). */
  activeClass: 'on-blue' | 'on-ok' | 'on-ink'
  matches: (path: string) => boolean
  roles: Role[]
}

const TABS: Tab[] = [
  {
    to: '/',
    label: 'Inicio',
    icon: Music,
    activeClass: 'on-blue',
    matches: (p) => p === '/',
    roles: ['admin', 'seller'],
  },
  {
    to: '/ventas',
    label: 'Vender',
    icon: Ticket,
    activeClass: 'on-blue',
    matches: (p) => p.startsWith('/ventas'),
    roles: ['admin', 'seller'],
  },
  {
    to: '/puerta',
    label: 'Puerta',
    icon: ScanLine,
    activeClass: 'on-ok',
    matches: (p) => p.startsWith('/puerta'),
    roles: ['admin', 'seller', 'door'],
  },
  {
    to: '/direccion',
    label: 'Dirección',
    icon: BarChart3,
    activeClass: 'on-ink',
    matches: (p) =>
      p.startsWith('/direccion') ||
      p.startsWith('/panel') ||
      p.startsWith('/temporadas') ||
      p.startsWith('/usuarios'),
    roles: ['admin'],
  },
]

export function TabBar({ role }: { role: Role }) {
  const location = useLocation()
  const visible = TABS.filter((tab) => tab.roles.includes(role))
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
