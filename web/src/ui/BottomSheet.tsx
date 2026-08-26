import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * BottomSheet (C10): dim + panel inferior con grip. Cierra con tap afuera,
 * Escape o el gesto de arrastrar el grip hacia abajo. Bloquea el scroll del
 * fondo mientras esta abierto.
 */
export function BottomSheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  label: string
  children: ReactNode
}) {
  const startY = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
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
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="sheet-layer">
      <button className="sheet-dim" aria-label="Cerrar" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onTouchStart={(e) => {
          startY.current = e.touches[0].clientY
        }}
        onTouchEnd={(e) => {
          if (startY.current !== null && e.changedTouches[0].clientY - startY.current > 70) {
            onClose()
          }
          startY.current = null
        }}
      >
        <div className="sheet__grip" aria-hidden />
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Fila de accion dentro de un BottomSheet. */
export function SheetAction({
  icon,
  tone = 'neutral',
  hint,
  onClick,
  disabled,
  children,
}: {
  icon: ReactNode
  tone?: 'neutral' | 'ok' | 'danger'
  hint?: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button className={`sheet-act sheet-act--${tone}`} type="button" onClick={onClick} disabled={disabled}>
      <span className="sheet-act__ic" aria-hidden>{icon}</span>
      <span className="sheet-act__label">{children}</span>
      {hint && <small className="sheet-act__hint">{hint}</small>}
    </button>
  )
}
