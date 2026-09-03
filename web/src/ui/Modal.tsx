import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * Diálogo centrado, sólo para escritorio (C11). Se usa donde la acción es un
 * formulario completo y sacar a la persona de la lista para volver enseguida
 * sería peor: se resuelve encima de lo que estaba mirando y al cerrar sigue
 * ahí. En celular esas mismas acciones son una pantalla propia —hay lugar de
 * sobra en el alto y un modal a pantalla completa es una pantalla con peor
 * navegación—, así que quien lo usa decide por breakpoint.
 *
 * Cierra con Escape, con el ✕ o tocando afuera; bloquea el scroll del fondo.
 */
export function Modal({
  onClose,
  label,
  children,
}: {
  onClose: () => void
  label: string
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <div className="modal-layer">
      <button className="sheet-dim" aria-label="Cerrar" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        <button className="modal__x" type="button" onClick={onClose} aria-label="Cerrar">
          <X size={16} aria-hidden />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}
