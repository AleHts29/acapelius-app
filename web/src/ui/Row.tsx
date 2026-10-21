import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * La fila (C19 §4.4): dos líneas como máximo. Lo que no cambia lo que vas a
 * hacer en esta pantalla no va acá: va al detalle.
 *
 * Las columnas salen de lo que se pasa: monto y/o estado a la derecha, y el
 * chevron sólo si la fila navega (`to`) o abre algo (`onClick`).
 */
export function Row({
  title,
  sub,
  status,
  amount,
  unit,
  to,
  onClick,
  dim,
  off,
  warn,
  on,
}: {
  title: ReactNode
  sub?: ReactNode
  status?: ReactNode
  amount?: ReactNode
  /** Unidad debajo del monto: "debe", "rindió", "vendidas". */
  unit?: string
  to?: string
  onClick?: () => void
  /** Anulada o función pasada. */
  dim?: boolean
  /** Tachado del título (anulada). */
  off?: boolean
  /** Banda de aviso: "Sin repartir · 12". */
  warn?: boolean
  /** La fila del cursor de teclado (la mesa de entrada de la puerta). */
  on?: boolean
}) {
  const navega = Boolean(to || onClick)
  const cols = [status, amount].filter((c) => c !== undefined).length
  const variante = navega ? ['row--nav', 'row--2', ''][cols] : cols < 2 ? 'row--3' : ''
  const className = ['row', variante, dim && 'row--dim', warn && 'row--warn', on && 'row--on'].filter(Boolean).join(' ')

  const cuerpo = (
    <>
      <div>
        <div className={off ? 'rt rt--off' : 'rt'}>{title}</div>
        {sub && <div className="rs">{sub}</div>}
      </div>
      {amount !== undefined && (
        <span className="rn">
          {amount}
          {unit && <s>{unit}</s>}
        </span>
      )}
      {status}
      {navega && (
        <span className="go" aria-hidden>
          ›
        </span>
      )}
    </>
  )

  if (to) {
    return (
      <Link className={className} to={to}>
        {cuerpo}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button className={className} type="button" onClick={onClick}>
        {cuerpo}
      </button>
    )
  }
  return <div className={className}>{cuerpo}</div>
}
