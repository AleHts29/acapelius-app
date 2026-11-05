import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * La función es una entrada (C21): cuerpo con el nombre en Anton, línea
 * troquelada y talón con los números. En un lugar angosto el talón va abajo;
 * si tiene lugar, al costado, como un boleto real (lo decide el ancho de la
 * propia entrada, no el de la pantalla). `ticket` es la naranja, la que
 * importa ahora; `papel`, el resto.
 *
 * Los dos huecos del troquel se pintan del color de lo que hay detrás: donde
 * el fondo no es el papel de la app hay que pasarlo por `--hueco`.
 */
export function Entrada({
  tono = 'papel',
  label,
  nombre,
  datos,
  talon,
  sello,
  chica,
  apagada,
  className,
  to,
  onClick,
  ariaLabel,
}: {
  tono?: 'ticket' | 'papel' | 'vacia'
  label?: ReactNode
  nombre: ReactNode
  datos?: ReactNode
  talon?: ReactNode
  /** Una palabra, en el sello cruzado: "Más vendida", "Agotada". */
  sello?: { texto: string; tono?: 'ok' | 'warn' | 'venta' }
  /** La versión para elegir función en una lista. */
  chica?: boolean
  /** Ya pasó. */
  apagada?: boolean
  className?: string
  to?: string
  onClick?: () => void
  ariaLabel?: string
}) {
  const clases = [
    'entrada',
    `entrada--${tono}`,
    chica && 'entrada--chica',
    apagada && 'entrada--off',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const cuerpo = (
    <div className="entrada__in">
      <div className="entrada__cuerpo">
        {label && <span className="entrada__l">{label}</span>}
        <div className="entrada__n">{nombre}</div>
        {datos && <div className="entrada__d">{datos}</div>}
      </div>
      {talon && <div className="entrada__talon">{talon}</div>}
      {sello && <span className={`entrada__sello entrada__sello--${sello.tono ?? 'ok'}`}>{sello.texto}</span>}
    </div>
  )
  if (to) {
    return (
      <Link className={clases} to={to} aria-label={ariaLabel}>
        {cuerpo}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button className={clases} type="button" onClick={onClick} aria-label={ariaLabel}>
        {cuerpo}
      </button>
    )
  }
  return <div className={clases}>{cuerpo}</div>
}

/** El dato principal del talón: la etiqueta a la izquierda, el número en Anton a la derecha. */
export function TalonCifra({
  label,
  valor,
  barra,
  children,
}: {
  label: ReactNode
  valor: ReactNode
  barra?: { value: number; max: number }
  children?: ReactNode
}) {
  const pct = barra && barra.max > 0 ? Math.min(100, (barra.value / barra.max) * 100) : 0
  return (
    <>
      <div className="entrada__cifra">
        <span className="entrada__l">{label}</span>
        <b>{valor}</b>
      </div>
      {barra && (
        <div className="entrada__bar" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {children && <div className="entrada__nota">{children}</div>}
    </>
  )
}

/**
 * Las entradas de la temporada, una al lado de la otra: se deslizan y encastran.
 * Los puntos dicen cuántas hay y dónde estás.
 */
export function TiraEntradas({ label, children }: { label: string; children: ReactNode[] }) {
  const tira = useRef<HTMLDivElement>(null)
  const [actual, setActual] = useState(0)
  const total = children.length

  const izquierdaDe = (el: HTMLDivElement, i: number) => {
    const hijo = el.children[i] as HTMLElement | undefined
    return hijo ? hijo.offsetLeft - el.offsetLeft : 0
  }

  const alMover = () => {
    const el = tira.current
    if (!el) return
    const hijos = Array.from(el.children) as HTMLElement[]
    let mejor = 0
    hijos.forEach((h, i) => {
      if (Math.abs(h.offsetLeft - el.offsetLeft - el.scrollLeft) < Math.abs(hijos[mejor].offsetLeft - el.offsetLeft - el.scrollLeft)) {
        mejor = i
      }
    })
    // Al final de la tira las últimas no llegan a encastrar a la izquierda.
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2) mejor = total - 1
    setActual(mejor)
  }

  const ir = (i: number) => {
    const el = tira.current
    if (el) el.scrollTo({ left: izquierdaDe(el, i) })
  }

  return (
    <div className="tira-e">
      <div className="tira-e__t" ref={tira} tabIndex={0} role="group" aria-label={label} onScroll={alMover}>
        {children}
      </div>
      {total > 1 && (
        <div className="tira-e__p">
          {children.map((_, i) => (
            <button
              key={i}
              type="button"
              className={i === actual ? 'on' : undefined}
              aria-label={`Ver la función ${i + 1} de ${total}`}
              aria-current={i === actual ? 'true' : undefined}
              onClick={() => ir(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
