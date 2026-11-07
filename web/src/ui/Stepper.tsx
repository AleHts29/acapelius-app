import { useState } from 'react'

// El stepper de cantidad (venta) y de cupo (reparto). Sin borde: sobre
// --sunk, como el segmented (C19).

/**
 * Stepper compacto con limites y motivo del limite (C8 lo usa con cupos).
 * El número del medio también se escribe: para repartir 40 entradas no hace
 * falta tocar 40 veces el +. Lo escrito se ajusta a los límites al salir.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max,
  maxReason,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  maxReason?: string
}) {
  // null: se muestra el valor; un string: lo que la persona está escribiendo.
  const [escrito, setEscrito] = useState<string | null>(null)
  const atMax = max !== undefined && value >= max
  const ajustar = (n: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, n))

  function escribir(texto: string) {
    const limpio = texto.replace(/\D/g, '').slice(0, 5)
    setEscrito(limpio)
    if (limpio !== '') onChange(ajustar(Number(limpio)))
  }

  return (
    <div>
      <div className="stepper">
        <button type="button" aria-label="Menos" disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <input
          className="stepper__n"
          type="text"
          inputMode="numeric"
          aria-label="Cantidad"
          value={escrito ?? String(value)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => escribir(e.target.value)}
          onBlur={() => setEscrito(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        <button type="button" aria-label="Más" disabled={atMax} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
      {atMax && maxReason && <p className="stepper__reason">{maxReason}</p>}
    </div>
  )
}
