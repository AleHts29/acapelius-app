import { Eye, EyeOff } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { setPlataOculta, usePlataOculta } from '../lib/plata'

/** El botón del ojito: muestra u oculta los montos de toda la app. */
/**
 * Los montos salen de formatMoney, que lee el ojito al dibujar. Para que se
 * redibujen sin desarmar la pantalla (modales abiertos, lo escrito, el scroll),
 * a cada consulta en caché se le da una copia de sus mismos datos: los
 * componentes que la usan vuelven a renderizar, nada se remonta ni se pide de nuevo.
 */
function redibujarMontos(queryClient: QueryClient) {
  for (const query of queryClient.getQueryCache().getAll()) {
    const data = query.state.data
    if (data === undefined || data === null || typeof data !== 'object') continue
    query.setState({ data: Array.isArray(data) ? [...data] : { ...data } })
  }
}

export function OjoPlata({ className = 'ojo' }: { className?: string }) {
  const oculta = usePlataOculta()
  const queryClient = useQueryClient()
  const Icono = oculta ? EyeOff : Eye
  return (
    <button
      className={className}
      type="button"
      onClick={() => {
        setPlataOculta(!oculta)
        redibujarMontos(queryClient)
      }}
      aria-pressed={oculta}
      aria-label={oculta ? 'Mostrar los montos' : 'Ocultar los montos'}
      title={oculta ? 'Mostrar los montos' : 'Ocultar los montos'}
    >
      <Icono size={17} aria-hidden />
    </button>
  )
}
