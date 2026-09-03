import { useEffect, useState } from 'react'

/** El breakpoint de escritorio de C11. Igual que el del CSS, en un solo lugar. */
const DESKTOP = '(min-width: 1024px)'

/**
 * Cierto en escritorio. Casi todo C11 se resuelve con media queries y no
 * necesita esto; se usa sólo donde el tamaño cambia QUÉ se monta, no cómo se
 * ve: el modo puerta no tiene que montar la cámara en una notebook, y la vista
 * de rendiciones decide entre master-detail y una sola columna.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP)
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', onChange)
    setIsDesktop(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return isDesktop
}
