import { useId } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useDialog } from './useDialog'

/**
 * El popup (C19 §4.10). UNO solo para toda la app: corista, función, venta e
 * ingreso. Cabecera negra (el talón), cuerpo y pie de acciones. Es para la
 * FICHA de una entidad; para trabajar una lista de corrido va <Drawer>.
 *
 * Esc y el scrim cierran, el foco queda adentro y vuelve a quien lo abrió.
 * En celular el CSS lo presenta como hoja.
 */
export function Modal({
  open,
  onClose,
  label,
  title,
  sub,
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  label?: ReactNode
  title: ReactNode
  sub?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  const ref = useDialog<HTMLDivElement>(open, onClose)
  const titleId = useId()
  if (!open) return null

  return createPortal(
    <div className="modal-wrap">
      <div className="modal-scrim" onClick={onClose} aria-hidden />
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal__h">
          <button className="modal__x" type="button" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
          {label && <span className="lbl">{label}</span>}
          <div className="modal__t" id={titleId}>
            {title}
          </div>
          {sub && <div className="modal__s">{sub}</div>}
        </div>
        <div className="modal__b">{children}</div>
        {footer && <div className="modal__f">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
