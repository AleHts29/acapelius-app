import { useSyncExternalStore } from 'react'
import { Check } from 'lucide-react'

/**
 * El aviso verde de "se guardó" (C21). Lo dispara solo cada mutación que
 * termina bien, con el texto de su `meta.exito` (ver main.tsx): así ninguna
 * pantalla tiene que acordarse de avisar.
 */
type Estado = { id: number; texto: string } | null

let estado: Estado = null
let timer: ReturnType<typeof setTimeout> | undefined
const oyentes = new Set<() => void>()

function emitir(nuevo: Estado) {
  estado = nuevo
  for (const o of oyentes) o()
}

export function avisar(texto: string) {
  clearTimeout(timer)
  emitir({ id: (estado?.id ?? 0) + 1, texto })
  timer = setTimeout(() => emitir(null), 2600)
}

function suscribir(o: () => void) {
  oyentes.add(o)
  return () => oyentes.delete(o)
}

export function Avisos() {
  const actual = useSyncExternalStore(suscribir, () => estado)
  return (
    <div className="aviso-zona" role="status" aria-live="polite">
      {actual && (
        <div className="aviso" key={actual.id}>
          <Check size={16} strokeWidth={2.6} aria-hidden />
          {actual.texto}
        </div>
      )}
    </div>
  )
}
