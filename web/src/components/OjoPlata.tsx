import { Eye, EyeOff } from 'lucide-react'

import { setPlataOculta, usePlataOculta } from '../lib/plata'

/** El botón del ojito: muestra u oculta los montos de toda la app. */
export function OjoPlata({ className = 'ojo' }: { className?: string }) {
  const oculta = usePlataOculta()
  const Icono = oculta ? EyeOff : Eye
  return (
    <button
      className={className}
      type="button"
      onClick={() => setPlataOculta(!oculta)}
      aria-pressed={oculta}
      aria-label={oculta ? 'Mostrar los montos' : 'Ocultar los montos'}
      title={oculta ? 'Mostrar los montos' : 'Ocultar los montos'}
    >
      <Icono size={17} aria-hidden />
    </button>
  )
}
