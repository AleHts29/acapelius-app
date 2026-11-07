import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LogOut, PanelLeft } from 'lucide-react'

import { api, roleLabel } from '../api/client'
import type { User } from '../api/client'
import { useSideNavRail } from '../lib/sidenav'
import { OjoPlata } from './OjoPlata'
import { SeasonSelector } from '../season/SeasonSelector'
import { ThemeToggle } from './ThemeToggle'
import { useSeason } from '../season/SeasonProvider'
import { activeItem, navFor } from './nav'
import type { NavItem } from './nav'

/**
 * Navegación de escritorio (C20): columna de texto a la izquierda, separada
 * del contenido por una regla. Se colapsa a un riel de íconos con el botón de
 * arriba o con ⌘B; el estado vive en <html data-nav> y lo decide el CSS, así
 * que acá se renderiza siempre lo mismo: texto e ícono, y cada modo muestra
 * lo suyo. Sólo se ve de 1024px para arriba.
 *
 * Para dirección tiene dos niveles (C12): lo del día a día arriba y, bajo
 * Administración (C19 §6), lo que se mira de vez en cuando.
 */
export function SideNav({ user, onLogout }: { user: User; onLogout: () => void }) {
  const location = useLocation()
  const { rail, toggle } = useSideNavRail()
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
        className={active ? 'sidenav__item sidenav__item--on' : 'sidenav__item'}
        aria-current={active ? 'page' : undefined}
        // En el riel el nombre no se ve: queda como tooltip nativo.
        title={rail ? (n > 0 ? `${item.label} · ${n}` : item.label) : undefined}
      >
        <Icon size={17} strokeWidth={active ? 2.2 : 1.9} aria-hidden />
        <span className="sidenav__t">{item.label}</span>
        {n > 0 && <span className="sidenav__badge">{n}</span>}
      </Link>
    )
  }

  const primerNivel = items.filter((item) => item.section === undefined)
  const direccion = items.filter((item) => item.section === 'direccion')

  return (
    <nav className="sidenav" aria-label="Navegación principal">
      <div className="sidenav__top">
        <Link className="sidenav__brand" to="/" aria-label="Inicio">
          <span className="sello" aria-hidden />
          <span>ACAPELIUS</span>
        </Link>
        <button
          className="sidenav__toggle"
          type="button"
          onClick={toggle}
          aria-label={rail ? 'Expandir el menú' : 'Colapsar el menú'}
          aria-expanded={!rail}
          title="⌘B"
        >
          <PanelLeft size={16} aria-hidden />
        </button>
      </div>

      {/* Arriba de la navegación: la temporada es el contexto de todo lo que
          está debajo, no una opción de una pantalla. */}
      <div className="sidenav__ctx">
        <SeasonSelector />
        {/* El ojito va con la temporada: los dos cambian qué muestra la app. */}
        <OjoPlata className="sidenav__toggle" />
      </div>

      <div className="sidenav__items">
        {primerNivel.map(fila)}
        {direccion.length > 0 && (
          <>
            <p className="lbl sidenav__sect">Administración</p>
            <div className="sidenav__sep" aria-hidden />
            {direccion.map(fila)}
          </>
        )}
      </div>

      <div className="sidenav__theme">
        <ThemeToggle />
        <ThemeToggle compact />
      </div>
      <div className="sidenav__account">
        <span className="avatar" aria-hidden title={user.name}>
          {initial}
        </span>
        <span className="sidenav__who">
          <b>{user.name}</b>
          <span className="rs">{roleLabel(user.role)}</span>
        </span>
        <button className="sidenav__out" type="button" onClick={onLogout} aria-label="Cerrar sesión">
          <LogOut size={16} aria-hidden />
        </button>
      </div>
    </nav>
  )
}
