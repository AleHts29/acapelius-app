import { useEffect, useRef, useState } from 'react'
import { ArrowDown, RotateCw } from 'lucide-react'

/** Cuánto hay que tirar (en px, ya con la resistencia) para que actualice. */
const UMBRAL = 72

/**
 * Deslizar hacia abajo para actualizar, como en las apps nativas. Instalada
 * en el iPhone la app queda abierta en memoria y no se recarga nunca: esto
 * recarga todo, con datos nuevos y la última versión de la app.
 *
 * Sólo arranca con la página arriba de todo y sin un popup abierto, para no
 * pelearse con el scroll ni con las hojas que se deslizan.
 */
export function PullToRefresh() {
  const [tiron, setTiron] = useState(0)
  const [cargando, setCargando] = useState(false)
  const inicio = useRef<number | null>(null)
  const actual = useRef(0)

  useEffect(() => {
    const hayPopup = () => document.querySelector('.modal-wrap, .modal, .sheet, .foto-grande, .menu--open, .acct-menu') !== null

    const alTocar = (e: TouchEvent) => {
      if (window.scrollY > 0 || e.touches.length !== 1 || hayPopup()) {
        inicio.current = null
        return
      }
      inicio.current = e.touches[0].clientY
    }
    const alMover = (e: TouchEvent) => {
      if (inicio.current === null) return
      const dy = e.touches[0].clientY - inicio.current
      if (dy <= 0 || window.scrollY > 0) {
        actual.current = 0
        setTiron(0)
        return
      }
      // Resistencia: cuesta cada vez más, como el rebote de iOS.
      const conResistencia = Math.min(120, dy * 0.5)
      actual.current = conResistencia
      setTiron(conResistencia)
    }
    const alSoltar = () => {
      if (inicio.current === null) return
      inicio.current = null
      if (actual.current >= UMBRAL) {
        setCargando(true)
        window.location.reload()
        return
      }
      actual.current = 0
      setTiron(0)
    }
    // Un toque cancelado (el sistema se lo llevó) nunca actualiza.
    const alCancelar = () => {
      inicio.current = null
      actual.current = 0
      setTiron(0)
    }

    window.addEventListener('touchstart', alTocar, { passive: true })
    window.addEventListener('touchmove', alMover, { passive: true })
    window.addEventListener('touchend', alSoltar)
    window.addEventListener('touchcancel', alCancelar)
    return () => {
      window.removeEventListener('touchstart', alTocar)
      window.removeEventListener('touchmove', alMover)
      window.removeEventListener('touchend', alSoltar)
      window.removeEventListener('touchcancel', alCancelar)
    }
  }, [])

  if (tiron === 0 && !cargando) return null
  const listo = tiron >= UMBRAL || cargando
  return (
    <div className="ptr" style={{ transform: `translate(-50%, ${cargando ? UMBRAL : tiron}px)` }} role="status" aria-live="polite">
      <span className={`ptr__bola${cargando ? ' ptr__bola--gira' : ''}`}>
        {cargando ? (
          <RotateCw size={18} aria-hidden />
        ) : (
          <ArrowDown size={18} aria-hidden style={{ transform: listo ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
        )}
      </span>
      <span className="ptr__t">{cargando ? 'Actualizando…' : listo ? 'Soltá para actualizar' : 'Deslizá para actualizar'}</span>
    </div>
  )
}
