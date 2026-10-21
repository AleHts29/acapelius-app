import { BarChart3, CalendarDays, Coins, Mic2, Music, ScanLine, Ticket, Users, Wallet } from 'lucide-react'

import type { Role } from '../api/client'

export interface NavItem {
  to: string
  label: string
  icon: typeof Music
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
    matches: (p) => p === '/',
    roles: ['admin', 'seller'],
  },
  {
    to: '/ventas',
    // La pantalla es el listado; vender es una acción adentro (C16).
    label: 'Ventas',
    icon: Ticket,
    matches: (p) => p.startsWith('/ventas'),
    roles: ['admin', 'seller'],
    badge: 'sales_pending',
  },
  {
    to: '/puerta',
    label: 'Puerta',
    icon: ScanLine,
    matches: (p) => p.startsWith('/puerta'),
    roles: ['admin', 'seller', 'door'],
  },
  {
    // Lo que la corista tiene que rendir (C19 §7.1). Antes su acceso apuntaba
    // a /panel/rendiciones, que es de dirección: rebotaba al inicio y nunca
    // veía lo que debía.
    to: '/mi-plata',
    label: 'Mi plata',
    icon: Coins,
    matches: (p) => p.startsWith('/mi-plata'),
    roles: ['seller'],
  },
  {
    to: '/direccion',
    label: 'Dirección',
    icon: BarChart3,
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
    matches: (p) => p.startsWith('/panel/rendiciones'),
    roles: ['admin'],
    section: 'direccion',
    badge: 'settlements_pending',
  },
  {
    to: '/panel/asistencia',
    label: 'Asistencia',
    icon: Users,
    matches: (p) => p.startsWith('/panel/asistencia'),
    roles: ['admin'],
    section: 'direccion',
  },
  {
    to: '/temporadas',
    label: 'Temporadas',
    icon: CalendarDays,
    matches: (p) => p.startsWith('/temporadas'),
    roles: ['admin'],
    section: 'direccion',
  },
  {
    to: '/usuarios',
    label: 'Equipo',
    icon: Mic2,
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
 * Cuál de los ítems está activo. Gana el del segundo nivel: parada en
 * /usuarios se prende Equipo, no Dirección, aunque las dos coincidan —
 * Dirección matchea todo el panel a propósito, para la barra del celular,
 * donde el segundo nivel no existe.
 *
 * Antes esto desempataba por el largo de `to`, que no dice nada sobre cuán
 * específico fue el match: "/direccion" tiene diez caracteres y "/usuarios"
 * nueve, así que estando en Equipo se prendía Dirección.
 */
export function activeItem(items: NavItem[], path: string): NavItem | undefined {
  const coinciden = items.filter((item) => item.matches(path))
  return coinciden.find((item) => item.section !== undefined) ?? coinciden[0]
}

/**
 * Quién entra a cada ruta, en un solo lugar: lo usan las rutas de la app
 * (`<Acceso>`) y los tests. Gana el prefijo más largo; lo que no figura es de
 * cualquiera con sesión. El backend aplica las mismas reglas a la API: esto
 * sólo evita mostrar una pantalla que va a fallar.
 */
const ACCESO: Array<{ prefijo: string; roles: Role[] }> = [
  { prefijo: '/direccion', roles: ['admin'] },
  { prefijo: '/panel', roles: ['admin'] },
  { prefijo: '/temporadas', roles: ['admin'] },
  { prefijo: '/usuarios', roles: ['admin'] },
  { prefijo: '/dev', roles: ['admin'] },
  { prefijo: '/ventas', roles: ['admin', 'seller'] },
  { prefijo: '/mi-plata', roles: ['seller'] },
]

export function puedeEntrar(role: Role, path: string): boolean {
  const regla = ACCESO.filter((r) => path === r.prefijo || path.startsWith(`${r.prefijo}/`)).sort(
    (a, b) => b.prefijo.length - a.prefijo.length,
  )[0]
  return regla === undefined || regla.roles.includes(role)
}
