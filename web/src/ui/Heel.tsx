import type { ReactNode } from 'react'

/**
 * El talón (C19 §4.8): el afiche. Negro, radio 0, siempre. Hero de Inicio,
 * bloque de función en Puerta. Adentro, los semánticos usan sus variantes
 * `--*-on-black`.
 */
export function Heel({
  label,
  title,
  meta,
  progress,
  children,
}: {
  label?: ReactNode
  title?: ReactNode
  meta?: ReactNode
  /** Barra de venta: valor sobre máximo, con el texto a los costados. */
  progress?: { value: number; max: number; left: ReactNode; right: ReactNode }
  children?: ReactNode
}) {
  const pct = progress && progress.max > 0 ? Math.min(100, (progress.value / progress.max) * 100) : 0
  return (
    <section className="heel">
      {label && <span className="lbl">{label}</span>}
      {title && <div className="heel__t">{title}</div>}
      {meta && <div className="heel__m">{meta}</div>}
      {progress && (
        <>
          <div className="heel__bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="heel__l">
            <span>{progress.left}</span>
            <span>{progress.right}</span>
          </div>
        </>
      )}
      {children}
    </section>
  )
}
