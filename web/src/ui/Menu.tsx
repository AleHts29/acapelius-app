import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, MoreVertical } from 'lucide-react'

import { useIsDesktop } from '../lib/viewport'

export interface MenuOption {
  id: string
  label: string
  /** Contexto de la opción: estado, fecha, cuántas cosas hay detrás. */
  hint?: string
  icon?: ReactNode
  /** `action` va en índigo (crear, ir a otra pantalla); `danger` en rojo. */
  tone?: 'default' | 'action' | 'danger'
  disabled?: boolean
  /** Por qué está deshabilitada. Se muestra en lugar del hint. */
  disabledReason?: string
  onSelect: () => void
}

export interface MenuGroup {
  label?: string
  /** Línea separadora antes del grupo. Las acciones van así, al final. */
  separated?: boolean
  options: MenuOption[]
}

/** A qué distancia del borde de la ventana el menú deja de caber abajo. */
const MARGEN = 12

/**
 * El menú desplegable de la app. Reemplaza al `<select>` nativo, que en cada
 * sistema operativo se dibuja distinto y no puede mostrar el contexto de cada
 * opción: acá cada una lleva su subtítulo, la elegida un check índigo, y las
 * acciones van separadas abajo.
 *
 * Dos presentaciones, un solo componente (como ActionPanel): en escritorio es
 * un panel anclado al disparador; en celular entra desde abajo, donde una
 * lista pegada al dedo se lee y se toca mejor que un popover de 260px.
 *
 * Va en un portal porque los disparadores viven adentro de tarjetas con
 * `overflow: hidden` —las filas de Temporadas, sin ir más lejos— y ahí un
 * panel absoluto queda recortado a la mitad.
 */
export function Menu({
  trigger,
  label,
  groups,
  value,
  align = 'left',
  width,
  ariaLabel,
}: {
  /** `pill`: selector de contexto. `kebab`: ⋮ de una fila. `field`: campo de formulario. */
  trigger: 'pill' | 'kebab' | 'field'
  /** Texto del disparador (y aria-label cuando es un ⋮). */
  label: string
  /** Qué se está eligiendo. En un campo de formulario el texto del botón es el
   *  valor, no el nombre del campo: sin esto un lector de pantalla lee la
   *  respuesta y nunca la pregunta. */
  ariaLabel?: string
  groups: MenuGroup[]
  /** Id de la opción marcada con el check. */
  value?: string
  align?: 'left' | 'right'
  width?: number
}) {
  const escritorio = useIsDesktop()
  const [abierto, setAbierto] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)
  const [cursor, setCursor] = useState(-1)
  const botonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const habilitadas = groups.flatMap((g) => g.options).filter((o) => !o.disabled)
  // El handler de teclado se registra una vez por apertura: si dependiera de
  // esta lista se volvería a registrar en cada render del padre.
  const habilitadasRef = useRef(habilitadas)
  habilitadasRef.current = habilitadas

  // La posición se mide después de pintar el panel: hasta que no existe no se
  // sabe cuánto mide, y sin eso no se puede decidir si abre para arriba.
  useLayoutEffect(() => {
    if (!abierto || !escritorio) return
    const boton = botonRef.current
    const panel = panelRef.current
    if (!boton || !panel) return
    const b = boton.getBoundingClientRect()
    const alto = panel.offsetHeight
    const ancho = panel.offsetWidth
    const abajo = window.innerHeight - b.bottom
    setPos({
      // Si abajo no entra pero arriba sí, abre para arriba.
      top: abajo < alto + MARGEN && b.top > alto + MARGEN ? b.top - alto - 7 : b.bottom + 7,
      left:
        align === 'right'
          ? Math.max(MARGEN, b.right - ancho)
          : Math.min(b.left, window.innerWidth - ancho - MARGEN),
      // Un campo angosto no puede achicar el panel por debajo de lo que
      // se lee: el menú está en un portal, así que puede pasarse del ancho
      // del formulario sin romper nada.
      minWidth: trigger === 'field' ? Math.max(b.width, 262) : 0,
    })
  }, [abierto, escritorio, align, trigger])

  // Cerrar al hacer click afuera o al scrollear: el panel está en un portal y
  // no se mueve con la página, así que quedarse abierto lo dejaría flotando
  // lejos de su disparador.
  useEffect(() => {
    if (!abierto) return
    const afuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !botonRef.current?.contains(t)) setAbierto(false)
    }
    const salir = () => setAbierto(false)
    document.addEventListener('mousedown', afuera)
    window.addEventListener('resize', salir)
    if (escritorio) window.addEventListener('scroll', salir, true)
    return () => {
      document.removeEventListener('mousedown', afuera)
      window.removeEventListener('resize', salir)
      window.removeEventListener('scroll', salir, true)
    }
  }, [abierto, escritorio])

  function cerrar(devolverFoco: boolean) {
    setAbierto(false)
    if (devolverFoco) botonRef.current?.focus()
  }

  function elegir(op: MenuOption) {
    if (op.disabled) return
    cerrar(true)
    op.onSelect()
  }

  // El teclado se escucha en document y no en el panel: al abrir, el foco
  // sigue en el disparador —que vive afuera del portal— y un onKeyDown del
  // panel no vería ni la primera flecha ni el Escape.
  useEffect(() => {
    if (!abierto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cerrar(true)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const total = habilitadasRef.current.length
        if (total === 0) return
        setCursor((c) => (c + (e.key === 'ArrowDown' ? 1 : -1) + total) % total)
        return
      }
      if (e.key === 'Tab') {
        // Salir con Tab cierra: el menú no atrapa el foco como un diálogo.
        cerrar(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [abierto])

  // El cursor de teclado mueve el foco real: así el lector de pantalla lee la
  // opción y el navegador la scrollea a la vista solo.
  // `pos` está en las dependencias porque el panel arranca con
  // `visibility: hidden` hasta que se lo mide, y focus() sobre algo invisible
  // no hace nada: hay que volver a intentarlo cuando ya tiene su lugar.
  useEffect(() => {
    if (!abierto) return
    if (cursor < 0) {
      panelRef.current?.focus()
      return
    }
    const items = panelRef.current?.querySelectorAll<HTMLElement>('.menu__i:not(:disabled)')
    items?.[cursor]?.focus()
  }, [abierto, cursor, pos])

  const abrir = () => {
    setCursor(-1)
    setPos(null)
    setAbierto(true)
  }

  const panel = (
    <div
      className={`menu${abierto ? ' menu--open' : ''}`}
      ref={panelRef}
      role="menu"
      aria-label={ariaLabel ?? label}
      tabIndex={-1}
      style={
        escritorio
          ? {
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              minWidth: Math.max(width ?? 0, pos?.minWidth ?? 0) || undefined,
              // Hasta tener la medida real se pinta fuera de la pantalla: si
              // no, se lo ve saltar de una esquina a su lugar.
              visibility: pos ? undefined : 'hidden',
            }
          : undefined
      }
    >
      {groups.map((grupo, gi) => (
        <div key={gi}>
          {grupo.separated && gi > 0 && <div className="menu__sep" />}
          {grupo.label && <p className="menu__lbl">{grupo.label}</p>}
          {grupo.options.map((op) => {
            const elegida = value !== undefined && op.id === value
            return (
              <button
                key={op.id}
                type="button"
                role="menuitem"
                disabled={op.disabled}
                className={`menu__i menu__i--${op.tone ?? 'default'}${elegida ? ' menu__i--on' : ''}`}
                onClick={() => elegir(op)}
              >
                {value !== undefined && !op.icon && (
                  <span className="menu__ck" aria-hidden>
                    {elegida && <Check size={13} strokeWidth={3} />}
                  </span>
                )}
                {op.icon && (
                  <span className="menu__ic" aria-hidden>
                    {op.icon}
                  </span>
                )}
                <span className="menu__tx">
                  <b>{op.label}</b>
                  {(op.disabled ? op.disabledReason : op.hint) && (
                    <span>{op.disabled ? op.disabledReason : op.hint}</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )

  return (
    <span className={`menu-anchor${trigger === 'field' ? ' menu-anchor--field' : ''}`}>
      <button
        ref={botonRef}
        type="button"
        className={`menu-btn menu-btn--${trigger}${abierto ? ' menu-btn--open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={ariaLabel ?? (trigger === 'kebab' ? label : undefined)}
        onClick={() => (abierto ? cerrar(true) : abrir())}
      >
        {trigger === 'kebab' ? (
          <MoreVertical size={16} aria-hidden />
        ) : (
          <>
            <span className="menu-btn__tx">{label}</span>
            <ChevronDown size={13} aria-hidden className="menu-btn__chev" />
          </>
        )}
      </button>
      {abierto &&
        createPortal(
          <>
            {/* En celular el menú es una hoja de abajo y necesita su fondo. */}
            {!escritorio && (
              <button className="menu-scrim" aria-label="Cerrar" onClick={() => cerrar(true)} />
            )}
            {panel}
          </>,
          document.body,
        )}
    </span>
  )
}
