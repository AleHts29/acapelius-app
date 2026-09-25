import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'

import { api, roleLabel } from '../api/client'
import type { User } from '../api/client'
import { SeasonSelector } from '../season/SeasonSelector'
import { ThemeToggle } from './ThemeToggle'
import { useSeason } from '../season/SeasonProvider'
import { activeItem, navFor } from './nav'
import type { NavItem } from './nav'

/**
 * Navegación de escritorio: columna fija a la izquierda con la marca arriba,
 * las mismas secciones que la barra del celular y la cuenta abajo. Sólo se ve
 * de 1024px para arriba; el CSS decide cuál de las dos navegaciones está en
 * pantalla, así que las dos se renderizan siempre y ninguna necesita saber del
 * tamaño de la ventana.
 *
 * Para dirección tiene dos niveles (C12): lo del día a día arriba y, bajo el
 * título DIRECCIÓN, lo que se mira de vez en cuando.
 */
export function SideNav({ user, onLogout }: { user: User; onLogout: () => void }) {
  const location = useLocation()
  const items = navFor(user.role)
  const activo = activeItem(items, location.pathname)
  const initial = user.name.trim().charAt(0).toUpperCase() || 'A'

  // Los contadores salen de la home, que ya está en caché cuando se navega
  // desde ahí; si todavía no se pidió, los ítems van sin número.
  const { seasonId } = useSeason()
  const home = useQuery({
    queryKey: ['home', seasonId],
    queryFn: () => api.home(seasonId),
  })
  const badges = home.data?.badges

  const fila = (item: NavItem) => {
    const active = item === activo
    const Icon = item.icon
    const n = item.badge ? (badges?.[item.badge] ?? 0) : 0
    return (
      <Link
        key={item.to}
        to={item.to}
        className={`sidenav__item${active ? ` sidenav__item--on ${item.activeClass}` : ''}`}
        aria-current={active ? 'page' : undefined}
      >
        <Icon size={17} strokeWidth={active ? 2.4 : 2} aria-hidden />
        {item.label}
        {n > 0 && <span className="sidenav__badge">{n}</span>}
      </Link>
    )
  }

  const primerNivel = items.filter((item) => item.section === undefined)
  const direccion = items.filter((item) => item.section === 'direccion')

  return (
    <nav className="sidenav" aria-label="Navegación principal">
      <Link className="sidenav__brand" to="/" aria-label="Inicio">
        <img className="sidenav__logo" src="/app/logo-mark-indigo.png" alt="" />
        <span>ACAPELIUS</span>
      </Link>

      {/* Arriba de la navegación: la temporada es el contexto de todo lo que
          está debajo, no una opción de una pantalla. */}
      <SeasonSelector />

      <div className="sidenav__items">
        {primerNivel.map(fila)}
        {direccion.length > 0 && (
          <>
            <p className="sidenav__sect">Dirección</p>
            {direccion.map(fila)}
          </>
        )}
      </div>

      <div className="sidenav__theme">
        <ThemeToggle />
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
