import type { ReactNode } from 'react'

/**
 * El grupo con la regla negra (C19 §4.3): acá vive el afiche. A la izquierda
 * la etiqueta, a la derecha el total en mono tabular.
 */
export function Group({ label, count, children }: { label: ReactNode; count?: ReactNode; children: ReactNode }) {
  return (
    <section className="grp">
      <div className="grp__h">
        <h2 className="lbl">{label}</h2>
        {count !== undefined && <span className="grp__n">{count}</span>}
      </div>
      {children}
    </section>
  )
}
