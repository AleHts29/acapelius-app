import { useEffect, useRef } from 'react'

/**
 * Los diálogos abiertos, el de arriba al final. Un formulario puede abrirse
 * sobre un drawer (registrar una rendición desde el detalle): Esc y Tab los
 * atiende sólo el de arriba, si no un Esc cerraría los dos.
 */
const pila: object[] = []

/** Todo lo que puede recibir foco adentro de un diálogo. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * El comportamiento de todo diálogo de la app (ActionPanel, popup, hoja y
 * drawer): Escape cierra, Tab no sale hacia la página de atrás, el fondo no
 * scrollea y, al cerrar, el foco vuelve al elemento que lo abrió.
 *
 * Devuelve el ref que va en el contenedor del diálogo.
 */
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null)
  const abridor = useRef<HTMLElement | null>(null)

  // onClose suele venir como arrow inline: si el efecto dependiera de él, se
  // volvería a montar en cada render del padre y el foco saltaría solo.
  const cerrarRef = useRef(onClose)
  cerrarRef.current = onClose

  // Quién abrió el diálogo se anota EN EL RENDER, no en un efecto: un campo de
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
    // primer control del diálogo; si no hay ninguno, el diálogo mismo.
    if (!ref.current?.contains(document.activeElement)) {
      const primero = ref.current?.querySelector<HTMLElement>(FOCUSABLE)
      ;(primero ?? ref.current)?.focus()
    }

    return () => {
      document.body.style.overflow = prev
      // En el próximo frame: React todavía está desmontando y un focus() ahora
      // se lo lleva puesto el reordenamiento del DOM. Si para entonces el
      // diálogo sigue en pantalla no se cerró: fue el montar-desmontar-montar
      // de StrictMode, y devolver el foco lo mandaría detrás del diálogo.
      const volver = abridor.current
      requestAnimationFrame(() => {
        if (ref.current?.isConnected) return
        abridor.current = null
        if (volver?.isConnected) volver.focus()
      })
    }
  }, [open])

  // Escape cierra; Tab no sale del diálogo. Sólo el de arriba de la pila.
  useEffect(() => {
    if (!open) return
    const yo = {}
    pila.push(yo)
    const onKey = (e: KeyboardEvent) => {
      if (pila[pila.length - 1] !== yo) return
      if (e.key === 'Escape') {
        cerrarRef.current()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const focos = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focos.length === 0) return
      const primero = focos[0]
      const ultimo = focos[focos.length - 1]
      const activo = document.activeElement
      if (e.shiftKey && (activo === primero || !ref.current.contains(activo))) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      pila.splice(pila.indexOf(yo), 1)
    }
  }, [open])

  return ref
}
