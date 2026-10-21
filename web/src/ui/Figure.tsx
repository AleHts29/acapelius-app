import type { ReactNode } from 'react'

/**
 * La cifra (C19 §4.6). UNA grande por pantalla, la que contesta la pregunta
 * de esa pantalla; las demás van en <SubFigs>, sin caja.
 */
export function Figure({
  label,
  tone,
  unit,
  children,
}: {
  label?: ReactNode
  tone?: 'ok' | 'warn'
  /** Texto chico al lado de la cifra: "/ 12", "de 80". */
  unit?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      {label && <span className="lbl">{label}</span>}
      <div className={tone ? `fig fig--${tone}` : 'fig'}>
        {children}
        {unit && <span> {unit}</span>}
      </div>
    </div>
  )
}

type SubFig = { label: ReactNode; value: ReactNode; unit?: ReactNode; tone?: 'warn' | 'ok' }

export function SubFigs({ items }: { items: SubFig[] }) {
  return (
    <div className="subfigs">
      {items.map((it, i) => (
        <div className="subfig" key={i}>
          <b className={it.tone}>
            {it.value}
            {it.unit && <em> {it.unit}</em>}
          </b>
          <span className="lbl">{it.label}</span>
        </div>
      ))}
    </div>
  )
}
