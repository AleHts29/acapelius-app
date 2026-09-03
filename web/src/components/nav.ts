import { BarChart3, Music, ScanLine, Ticket } from 'lucide-react'

import type { Role } from '../api/client'

export interface NavItem {
  to: string
  label: string
  icon: typeof Music
  /** Color de la categoria cuando esta activa (design system §3.1). */
  activeClass: 'on-blue' | 'on-ok' | 'on-ink'
  matches: (path: string) => boolean
  roles: Role[]
}

/**
 * La navegación principal, una sola vez. La barra de abajo (celular) y la
 * lateral (escritorio) muestran lo mismo en el mismo orden: si divergieran,
 * la app tendría dos mapas distintos según el tamaño de pantalla.
 */
export const NAV_ITEMS: NavItem[] = [
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

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}
