import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** Todo lo que puede recibir foco adentro del panel. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * El panel de acciones de la app (C10 + C14). Es UN solo componente con dos
 * presentaciones que elige el CSS por breakpoint: en celular entra desde abajo
 * con su grip y se cierra deslizando; de 1024px para arriba es un modal
 * centrado. Nunca hay dos abiertos a la vez porque cada pantalla abre uno.
 *
 * `size`: `panel` (420px) para acciones cortas; `form` (560px) para un
 * formulario completo; `wide` (720px) para una tabla que no se puede angostar
 * sin que deje de leerse.
 *
 * El foco queda atrapado adentro mientras está abierto y vuelve al elemento
 * que lo abrió al cerrar: con Escape o con Tab no se puede salir del diálogo
 * hacia la página de atrás, que es lo que hace que se pueda operar sin mouse.
 */
export function ActionPanel({
  open = true,
  onClose,
  label,
  size = 'panel',
  children,
}: {
  open?: boolean
  onClose: () => void
  label: string
  size?: 'panel' | 'form' | 'wide'
  children: ReactNode
}) {
  const startY = useRef<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const abridor = useRef<HTMLElement | null>(null)

  // onClose suele venir como arrow inline: si el efecto dependiera de él, se
  // volvería a montar en cada render del padre y el foco saltaría solo.
  const cerrarRef = useRef(onClose)
  cerrarRef.current = onClose

  // Quién abrió el panel se anota EN EL RENDER, no en un efecto: un campo de
  // adentro con `autoFocus` ya se llevó el foco para cuando corre el efecto, y
  // ahí `document.activeElement` es ese campo y no el botón de afuera.
  if (open && abridor.current === null) {
    abridor.current = document.activeElement as HTMLElement | null
  }

  // Devolver el foco al cerrar y bloquear el scroll del fondo mientras tanto.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Si nadie de adentro pidió el foco (un campo con autoFocus), lo toma el
    // primer control del panel; si no hay ninguno, el panel mismo.
    if (!panelRef.current?.contains(document.activeElement)) {
      const primero = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      ;(primero ?? panelRef.current)?.focus()
    }

    return () => {
      document.body.style.overflow = prev
      // En el próximo frame: React todavía está desmontando y un focus() ahora
      // se lo lleva puesto el reordenamiento del DOM.
      const volver = abridor.current
      abridor.current = null
      requestAnimationFrame(() => {
        if (volver?.isConnected) volver.focus()
      })
    }
  }, [open])

  // Escape cierra; Tab no sale del diálogo.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cerrarRef.current()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focos = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focos.length === 0) return
      const primero = focos[0]
      const ultimo = focos[focos.length - 1]
      const activo = document.activeElement
      if (e.shiftKey && (activo === primero || !panelRef.current.contains(activo))) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="panel-layer">
      <button className="scrim" aria-label="Cerrar" onClick={onClose} />
      <div
        className={`sheet sheet--${size}`}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
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
        {/* Sólo visible en escritorio: en el sheet se cierra deslizando. */}
        <button className="sheet__x" type="button" onClick={onClose} aria-label="Cerrar">
          <X size={16} aria-hidden />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Fila de accion dentro de un ActionPanel. */
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
