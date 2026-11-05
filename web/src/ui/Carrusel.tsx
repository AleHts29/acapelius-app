import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Una tira horizontal con encastre y flechas. Las flechas aparecen sólo si
 * algo queda afuera, y se apagan al llegar a cada punta. Se puede deslizar y,
 * con el foco en la tira, moverla con las flechas del teclado.
 */
export function Carrusel({ titulo, label, children }: { titulo: ReactNode; label: string; children: ReactNode }) {
  const tira = useRef<HTMLDivElement>(null)
  const [hay, setHay] = useState({ antes: false, despues: false })

  useEffect(() => {
    const el = tira.current
    if (!el) return
    const medir = () => {
      // El margen de 2px absorbe el redondeo del zoom del navegador.
      setHay({ antes: el.scrollLeft > 2, despues: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
    }
    medir()
    el.addEventListener('scroll', medir, { passive: true })
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => {
      el.removeEventListener('scroll', medir)
      observador.disconnect()
    }
  }, [])

  const mover = (sentido: 1 | -1) => {
    const el = tira.current
    const primera = el?.firstElementChild as HTMLElement | null
    if (!el || !primera) return
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0
    el.scrollBy({ left: sentido * (primera.offsetWidth + gap) })
  }

  return (
    <>
      <div className="grp__h carrusel__h">
        {titulo}
        {(hay.antes || hay.despues) && (
          <div className="carrusel__f">
            <button className="carrusel__b" type="button" aria-label="Ver las anteriores" disabled={!hay.antes} onClick={() => mover(-1)}>
              <ChevronLeft size={16} aria-hidden />
            </button>
            <button className="carrusel__b" type="button" aria-label="Ver las siguientes" disabled={!hay.despues} onClick={() => mover(1)}>
              <ChevronRight size={16} aria-hidden />
            </button>
          </div>
        )}
      </div>
      <div className="carrusel" ref={tira} tabIndex={0} role="group" aria-label={label}>
        {children}
      </div>
    </>
  )
}
