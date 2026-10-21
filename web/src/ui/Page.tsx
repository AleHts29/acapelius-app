import type { ReactNode } from 'react'

/**
 * El encabezado de página (C19 §5): el título en Anton, la etiqueta de
 * contexto arriba (`eyebrow`, Temporadas) o abajo (`label`, Equipo), y las
 * acciones a la derecha. El único `.btn--go` de la pantalla suele vivir acá.
 */
export function PageHeader({
  eyebrow,
  title,
  label,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  label?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="pgh">
      <div>
        {eyebrow && <span className="lbl">{eyebrow}</span>}
        <h1 className="pgt">{title}</h1>
        {label && <span className="lbl">{label}</span>}
      </div>
      {actions && <div className="pgh__a">{actions}</div>}
    </div>
  )
}
