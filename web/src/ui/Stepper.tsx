// El stepper de cantidad (venta) y de cupo (reparto). Sin borde: sobre
// --sunk, como el segmented (C19).

/** Stepper compacto con limites y motivo del limite (C8 lo usa con cupos). */
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
  const atMax = max !== undefined && value >= max
  return (
    <div>
      <div className="stepper">
        <button type="button" aria-label="Menos" disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <b aria-live="polite">{value}</b>
        <button type="button" aria-label="Más" disabled={atMax} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
      {atMax && maxReason && <p className="stepper__reason">{maxReason}</p>}
    </div>
  )
}
