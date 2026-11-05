import { useEffect, useSyncExternalStore } from 'react'

// Estado del menú lateral de escritorio (C20): abierto o riel de íconos. Se
// guarda por dispositivo y se aplica como `data-nav` en <html>, igual que el
// tema, para que el CSS decida el ancho sin esperar a React.

const KEY = 'acapelius-nav'

function leer(): boolean {
  try {
    return localStorage.getItem(KEY) === 'rail'
  } catch {
    return false
  }
}

let rail = leer()
const oyentes = new Set<() => void>()

/** Pone el atributo en <html>. Se llama al arrancar y en cada cambio. */
export function applyNav(): void {
  document.documentElement.setAttribute('data-nav', rail ? 'rail' : 'open')
}

export function setRail(next: boolean): void {
  rail = next
  try {
    if (next) localStorage.setItem(KEY, 'rail')
    else localStorage.removeItem(KEY)
  } catch {
    // sin storage: se aplica igual, sólo no persiste
  }
  applyNav()
  oyentes.forEach((fn) => fn())
}

function suscribir(fn: () => void) {
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}

/** El estado del menú y el toggle. ⌘B / Ctrl+B lo cambian desde cualquier lado. */
export function useSideNavRail(): { rail: boolean; toggle: () => void } {
  const actual = useSyncExternalStore(suscribir, () => rail, () => false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setRail(!rail)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { rail: actual, toggle: () => setRail(!rail) }
}
