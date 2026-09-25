// Modo claro / oscuro de la app. Tres opciones: claro, oscuro o el del
// sistema. Se guarda por dispositivo y se aplica como `data-theme` en <html>
// antes de que React pinte, para que no haya un flash del modo equivocado.

export type Theme = 'light' | 'dark' | 'system'

const KEY = 'acapelius-theme'

export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // sin storage (modo privado): el del sistema
  }
  return 'system'
}

/** Aplica el tema al documento. Con 'system' no se fija nada y manda el
 *  `prefers-color-scheme` del CSS. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // se aplica igual, solo no persiste
  }
  applyTheme(theme)
}

/** El modo efectivo ahora mismo (para tests y para el color de la barra). */
export function resolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
