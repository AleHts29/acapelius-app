import { useEffect, useMemo, useState } from 'react'

import { butacas, contar } from '../lib/sala'
import type { EstadoButaca, FuncionSala } from '../lib/sala'
import { Seg } from './Button'

const LEYENDA: Array<{ estado: EstadoButaca; label: string }> = [
  { estado: 'entro', label: 'entraron' },
  { estado: 'vendida', label: 'vendidas, sin entrar' },
  { estado: 'repartida', label: 'repartidas, sin vender' },
  { estado: 'libre', label: 'sin asignar' },
]

/** El número sube al aparecer o al cambiar de función. */
function useSubida(valor: number): number {
  const [visto, setVisto] = useState(valor)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setVisto(valor)
      return
    }
    const inicio = performance.now()
    let id = 0
    const paso = (ahora: number) => {
      const t = Math.min((ahora - inicio) / 650, 1)
      setVisto(Math.round(valor * (1 - (1 - t) ** 3)))
      if (t < 1) id = requestAnimationFrame(paso)
    }
    id = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(id)
  }, [valor])
  return visto
}

function Dato({
  estado,
  label,
  valor,
  onFoco,
}: {
  estado: EstadoButaca
  label: string
  valor: number
  onFoco: (e: EstadoButaca | null) => void
}) {
  const n = useSubida(valor)
  return (
    <button
      className="sala__dato"
      type="button"
      onMouseEnter={() => onFoco(estado)}
      onMouseLeave={() => onFoco(null)}
      onFocus={() => onFoco(estado)}
      onBlur={() => onFoco(null)}
    >
      <b>{n}</b>
      <span className="rs">
        <i className={`sala__m sala__m--${estado}`} aria-hidden />
        {label}
      </span>
    </button>
  )
}

/**
 * La sala (C20): cada entrada es una butaca de un teatro que se va llenando.
 * Se mira la temporada o una función; pasar por un dato de la leyenda prende
 * sus butacas.
 */
export function Sala({ funciones }: { funciones: Array<FuncionSala & { id: number; label: string }> }) {
  const [vista, setVista] = useState('todas')
  const [foco, setFoco] = useState<EstadoButaca | null>(null)
  const elegida = funciones.find((fn) => String(fn.id) === vista)
  const cuentas = contar(elegida ? [elegida] : funciones)
  const asientos = useMemo(() => butacas(cuentas), [cuentas.entro, cuentas.vendida, cuentas.repartida, cuentas.libre]) // eslint-disable-line
  const total = asientos.length
  if (total === 0) return null

  const ancho = Math.max(60, ...asientos.map((b) => Math.abs(b.x))) + 12
  const alto = Math.max(...asientos.map((b) => b.y)) + 12
  const vendidas = cuentas.entro + cuentas.vendida

  return (
    <section className="sala">
      <div className="sala__h">
        <h2 className="card__t">La sala</h2>
        <Seg
          label="Qué función mirar"
          value={vista}
          onChange={setVista}
          options={[
            { value: 'todas', label: 'Temporada' },
            ...funciones.map((fn) => ({ value: String(fn.id), label: fn.label })),
          ]}
        />
      </div>
      <div className="sala__b">
        <svg
          // Otra cantidad de butacas es otro teatro: se vuelve a llenar.
          key={total}
          className="sala__svg"
          data-foco={foco ?? undefined}
          viewBox={`${-ancho} 0 ${ancho * 2} ${alto}`}
          role="img"
          aria-label={`${vendidas} de ${total} entradas vendidas`}
        >
          <defs>
            <linearGradient id="sala-luz" x1="0" y1="0" x2="0" y2="1">
              <stop className="sala__luz-a" offset="0" />
              <stop className="sala__luz-b" offset="0.7" />
            </linearGradient>
          </defs>
          <path fill="url(#sala-luz)" d={`M -38 30 L 38 30 L ${ancho} ${alto} L ${-ancho} ${alto} Z`} />
          <path className="sala__tablas" d="M -46 6 L 46 6 L 38 30 L -38 30 Z" />
          <text className="sala__rotulo" x="0" y="21" textAnchor="middle">
            ESCENARIO
          </text>
          {asientos.map((b, i) => (
            <g key={i} transform={`translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${b.giro.toFixed(1)})`}>
              <rect
                className={`seat seat--${b.estado}`}
                x="-5.5"
                y="-5.5"
                width="11"
                height="11"
                style={{ animationDelay: `${Math.round((i / total) * 650)}ms` }}
              />
            </g>
          ))}
        </svg>
        <div className="sala__ley">
          <div className="sala__tot">
            <b>{vendidas}</b>
            <span> / {total}</span>
            <span className="lbl">vendidas</span>
          </div>
          {LEYENDA.map((l) =>
            cuentas[l.estado] > 0 ? (
              <Dato key={l.estado} estado={l.estado} label={l.label} valor={cuentas[l.estado]} onFoco={setFoco} />
            ) : null,
          )}
        </div>
      </div>
    </section>
  )
}
