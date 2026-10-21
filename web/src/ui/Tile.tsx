import type { ReactNode } from 'react'

import { initials } from '../lib/search'

// La tarjeta de entidad (C19 §4.9): persona o función. Una ENTIDAD va en
// tarjeta con popup de detalle; una TRANSACCIÓN va en fila, debajo de su
// entidad. Misma estructura, dos caras: <Tile> (corista) y <FnTile> (función).

type Bar = { value: number; max: number; tone?: 'ok' | 'tk' }

function Barra({ bar }: { bar: Bar }) {
  const pct = bar.max > 0 ? Math.min(100, (bar.value / bar.max) * 100) : 0
  return (
    <div className="tile__bar" aria-hidden>
      <i className={bar.tone} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Clic abre el detalle: con `onClick` la tarjeta es un botón. */
function Cascara({
  className,
  onClick,
  children,
}: {
  className: string
  onClick?: () => void
  children: ReactNode
}) {
  if (onClick) {
    return (
      <button className={className} type="button" onClick={onClick}>
        {children}
      </button>
    )
  }
  return <div className={className}>{children}</div>
}

/**
 * La tarjeta de corista. Sin `bar` ni `footer` es la compacta (sólo la cabeza:
 * dirección y puerta). `flag` pone el punto de "pide atención": debe plata o
 * no tiene cupo. El motivo tiene que estar dicho en el pie, con palabras.
 */
export function Tile({
  name,
  sub,
  bar,
  quantity,
  aside,
  footer,
  flag,
  off,
  onClick,
}: {
  name: string
  sub?: ReactNode
  bar?: Bar
  /** El dato del cupo: "6 de 12 vendidas". */
  quantity?: ReactNode
  /** A la derecha del dato: el porcentaje. */
  aside?: ReactNode
  footer?: ReactNode
  flag?: boolean
  off?: boolean
  onClick?: () => void
}) {
  const className = ['tile', flag && 'tile--flag', off && 'tile--off'].filter(Boolean).join(' ')
  return (
    <Cascara className={className} onClick={onClick}>
      <div className="tile__top">
        <span className="mono-sq" aria-hidden>
          {initials(name)}
        </span>
        <div>
          <div className="tile__n">{name}</div>
          {sub && <div className="tile__r">{sub}</div>}
        </div>
      </div>
      {bar && <Barra bar={bar} />}
      {(quantity || aside) && (
        <div className="tile__meta">
          <span className="tile__q">{quantity}</span>
          {aside}
        </div>
      )}
      {footer && <div className="tile__f">{footer}</div>}
    </Cascara>
  )
}

/**
 * La tarjeta de función: la fecha manda, en Anton. `on` es la elegida (el
 * talón marcando dónde estás, en Ventas). Agotada muestra AGOTADA en la fecha
 * grande: un número que no pide nada no merece ese espacio.
 */
export function FnTile({
  label,
  date,
  venue,
  bar,
  quantity,
  aside,
  footer,
  on,
  off,
  flag,
  onClick,
}: {
  label: ReactNode
  date: ReactNode
  venue?: ReactNode
  bar?: Bar
  quantity?: ReactNode
  aside?: ReactNode
  footer?: ReactNode
  on?: boolean
  off?: boolean
  /** Pide atención: entradas sin repartir. */
  flag?: boolean
  onClick?: () => void
}) {
  const className = ['fn', on && 'fn--on', off && 'tile--off', flag && 'tile--flag'].filter(Boolean).join(' ')
  return (
    <Cascara className={className} onClick={onClick}>
      <span className="lbl">{label}</span>
      <div className="fn__d">{date}</div>
      {venue && <div className="fn__v">{venue}</div>}
      {bar && <Barra bar={bar} />}
      {(quantity || aside) && (
        <div className="tile__meta">
          <span className="tile__q">{quantity}</span>
          {aside}
        </div>
      )}
      {footer && <div className="tile__f">{footer}</div>}
    </Cascara>
  )
}
