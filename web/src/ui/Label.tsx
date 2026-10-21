import type { ReactNode } from 'react'

/**
 * La etiqueta (C19 §4.1): el único lugar de la app con mayúsculas. Nombra un
 * número o una sección; nunca un título, un nombre propio, un monto ni un
 * metadato.
 */
export function Label({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span className="lbl" id={id}>
      {children}
    </span>
  )
}
