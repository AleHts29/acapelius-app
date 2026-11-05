import { useSyncExternalStore } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

import { getTheme, setTheme } from '../lib/theme'
import type { Theme } from '../lib/theme'

const OPCIONES: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
]

// El tema se lee de un solo lugar para que las dos presentaciones del toggle
// (la de texto y la compacta del riel) nunca muestren valores distintos.
let actual: Theme = getTheme()
const oyentes = new Set<() => void>()
function suscribir(fn: () => void) {
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}
function elegir(next: Theme) {
  setTheme(next)
  actual = next
  oyentes.forEach((fn) => fn())
}

/**
 * Claro / Oscuro / Sistema. En el menú de la cuenta y al pie de la lateral.
 * `compact` es un solo botón que rota entre los tres: es el del riel.
 */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const theme = useSyncExternalStore(suscribir, () => actual, () => 'system' as Theme)

  if (compact) {
    const i = OPCIONES.findIndex((o) => o.value === theme)
    const hoy = OPCIONES[i] ?? OPCIONES[2]
    const siguiente = OPCIONES[(i + 1) % OPCIONES.length]
    const Icon = hoy.icon
    return (
      <button
        className="themesel--one"
        type="button"
        aria-label={`Modo de color: ${hoy.label}. Cambiar a ${siguiente.label}`}
        title={`Modo ${hoy.label.toLowerCase()}`}
        onClick={() => elegir(siguiente.value)}
      >
        <Icon size={16} aria-hidden />
      </button>
    )
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
