import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useDialog } from './useDialog'

// La hoja de celular y el drawer de escritorio (C19 §4.13). Son para cuando
// se está trabajando una lista de corrido (Rendiciones, el detalle de una
// venta): importa no perder la lista de atrás. Mismas reglas que el popup:
// Esc, scrim, foco atrapado y de vuelta a quien lo abrió.

/** Hoja de celular: sube desde abajo y se cierra deslizando. */
export function Sheet({
  open,
  onClose,
  title,
  sub,
  status,
  actions,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  sub?: ReactNode
  /** El estado, a la derecha del título. */
  status?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  const ref = useDialog<HTMLDivElement>(open, onClose)
  const titleId = useId()
  const startY = useRef<number | null>(null)
  if (!open) return null

  return createPortal(
    <div className="modal-wrap">
      <div className="modal-scrim" onClick={onClose} aria-hidden />
      <div
        className="sheet"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onTouchStart={(e) => {
          startY.current = e.touches[0].clientY
        }}
        onTouchEnd={(e) => {
          if (startY.current !== null && e.changedTouches[0].clientY - startY.current > 70) onClose()
          startY.current = null
        }}
      >
        <div className="grab" aria-hidden />
        <div className="sheet__h">
          <div style={{ minWidth: 0 }}>
            <div className="sheet__t" id={titleId}>
              {title}
            </div>
            {sub && <div className="sheet__s">{sub}</div>}
          </div>
          {status}
        </div>
        {children && <div className="sheet__b">{children}</div>}
        {actions && <div className="sheet__acts">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** Drawer lateral de escritorio. */
export function Drawer({
  open,
  onClose,
  label,
  title,
  sub,
  actions,
  children,
}: {
  open: boolean
  onClose: () => void
  label?: ReactNode
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  const ref = useDialog<HTMLDivElement>(open, onClose)
  const titleId = useId()
  if (!open) return null

  return createPortal(
    <div className="modal-wrap">
      <div className="modal-scrim" onClick={onClose} aria-hidden />
      <div className="drawer" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <button className="drawer__x" type="button" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
        <div>
          {label && <span className="lbl">{label}</span>}
          <div className="drawer__t" id={titleId}>
            {title}
          </div>
          {sub && <div className="drawer__s">{sub}</div>}
        </div>
        {/* El cuerpo scrollea; las acciones quedan fijas abajo. */}
        <div className="drawer__b">{children}</div>
        {actions && <div className="drawer__acts">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}
