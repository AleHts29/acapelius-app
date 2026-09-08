import { BarChart3, CalendarDays, Mic2, Music, ScanLine, Ticket, Users, Wallet } from 'lucide-react'

import type { Role } from '../api/client'

export interface NavItem {
  to: string
  label: string
  icon: typeof Music
  /** Color de la categoria cuando esta activa (design system §3.1). */
  activeClass: 'on-blue' | 'on-ok' | 'on-ink'
  matches: (path: string) => boolean
  roles: Role[]
  /**
   * Segundo nivel de la lateral (C12). Los de `direccion` van bajo su titulo y
   * NO aparecen en la barra del celular: ahi entran por la pestaña Dirección.
   */
  section?: 'direccion'
  /** De qué contador de la home sale el número al costado. */
  badge?: 'sales_pending' | 'settlements_pending'
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
    badge: 'sales_pending',
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
    // En el celular esta pestaña cubre todo el panel: los destinos del segundo
    // nivel no tienen pestaña propia. En escritorio gana el más específico.
    matches: (p) =>
      p.startsWith('/direccion') ||
      p.startsWith('/panel') ||
      p.startsWith('/temporadas') ||
      p.startsWith('/usuarios'),
    roles: ['admin'],
  },
  {
    to: '/panel/rendiciones',
    label: 'Rendiciones',
    icon: Wallet,
    activeClass: 'on-ink',
    matches: (p) => p.startsWith('/panel/rendiciones'),
    roles: ['admin'],
    section: 'direccion',
    badge: 'settlements_pending',
  },
  {
    to: '/panel/asistencia',
    label: 'Asistencia',
    icon: Users,
    activeClass: 'on-ink',
    matches: (p) => p.startsWith('/panel/asistencia'),
    roles: ['admin'],
    section: 'direccion',
  },
  {
    to: '/temporadas',
    label: 'Temporadas',
    icon: CalendarDays,
    activeClass: 'on-ink',
    matches: (p) => p.startsWith('/temporadas'),
    roles: ['admin'],
    section: 'direccion',
  },
  {
    to: '/usuarios',
    label: 'Equipo',
    icon: Mic2,
    activeClass: 'on-ink',
    matches: (p) => p.startsWith('/usuarios'),
    roles: ['admin'],
    section: 'direccion',
  },
]

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}

/**
 * Las pestañas del celular: sólo el primer nivel. La barra de abajo se reparte
 * en tantas columnas como pestañas tenga el rol —cuatro para dirección, tres
 * para una corista—, nunca una grilla fija con huecos.
 */
export function tabsFor(role: Role): NavItem[] {
  return navFor(role).filter((item) => item.section === undefined)
}

/**
 * Cuál de los ítems está activo. Gana el más específico: parada en
 * /panel/rendiciones se prende Rendiciones, no Dirección, aunque las dos
 * coincidan. En el celular sólo existe el primer nivel, así que ahí gana
 * Dirección igual.
 */
export function activeItem(items: NavItem[], path: string): NavItem | undefined {
  return items
    .filter((item) => item.matches(path))
    .sort((a, b) => b.to.length - a.to.length)[0]
}
