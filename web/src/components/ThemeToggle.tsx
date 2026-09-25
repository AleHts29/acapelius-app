import { useState } from 'react'

import { getTheme, setTheme } from '../lib/theme'
import type { Theme } from '../lib/theme'

const OPCIONES: Array<{ value: Theme; label: string }> = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'system', label: 'Sistema' },
]

/** Claro / Oscuro / Sistema. Vive en el menú de la cuenta. */
export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(() => getTheme())

  function elegir(next: Theme) {
    setTheme(next)
    setLocal(next)
  }

  return (
    <div className="themesel" role="group" aria-label="Modo de color">
      {OPCIONES.map((o) => (
        <button key={o.value} type="button" aria-pressed={theme === o.value} onClick={() => elegir(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
