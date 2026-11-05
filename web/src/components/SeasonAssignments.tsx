import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { FunctionSummary } from '../api/client'
import { dayLabel, funcionTerminada, functionTime } from '../lib/format'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Status } from '../ui/Status'
import { AllocationsEditor } from './AllocationsEditor'

// La pestaña Asignaciones de una temporada: la función a la izquierda y su reparto
// a la derecha. Es el mismo tablero del popup de Repartir, como pantalla fija.

function EstadoFuncion({ fn }: { fn: FunctionSummary }) {
  if (funcionTerminada(fn.starts_at)) return <Status tone="mute">Ya pasó</Status>
  const libres = fn.capacity - fn.assigned
  if (libres > 0) return <Status tone="warn">{libres} sin repartir</Status>
  return <Status tone="ok">Repartida</Status>
}

function GrupoFunciones({
  titulo,
  funciones,
  elegida,
  onElegir,
}: {
  titulo: string
  funciones: FunctionSummary[]
  elegida: number | undefined
  onElegir: (id: number) => void
}) {
  if (funciones.length === 0) return null
  return (
    <div className="asigna__grupo">
      <h2 className="lbl">{titulo}</h2>
      {funciones.map((fn) => (
        <button
          key={fn.id}
          type="button"
          className="asigna__fn"
          aria-pressed={fn.id === elegida}
          onClick={() => onElegir(fn.id)}
        >
          <span className="asigna__nombre">{fn.name || fn.venue}</span>
          <span className="asigna__fecha">
            {dayLabel(fn.starts_at)} · {functionTime(fn.starts_at)}
          </span>
          <EstadoFuncion fn={fn} />
        </button>
      ))}
    </div>
  )
}

export function SeasonAssignments({ funciones }: { funciones: FunctionSummary[] }) {
  // ?funcion=N deja compartir o recargar la función que se está mirando.
  const [searchParams, setSearchParams] = useSearchParams()
  const fnDeURL = Number(searchParams.get('funcion')) || undefined
  const [hayCambios, setHayCambios] = useState(false)
  const [pendiente, setPendiente] = useState<number | null>(null)

  const vienen = funciones.filter((fn) => !funcionTerminada(fn.starts_at))
  const pasaron = funciones.filter((fn) => funcionTerminada(fn.starts_at)).reverse()
  // Sin elección, lo que más sirve: la próxima que tiene entradas sin repartir.
  const elegida =
    funciones.find((fn) => fn.id === fnDeURL) ??
    vienen.find((fn) => fn.capacity > fn.assigned) ??
    vienen[0] ??
    pasaron[0]

  // Otra función u otra temporada arrancan sin cambios: el tablero se monta de nuevo.
  useEffect(() => setHayCambios(false), [elegida?.id])

  function mostrar(id: number) {
    const next = new URLSearchParams(searchParams)
    next.set('funcion', String(id))
    setSearchParams(next, { replace: true })
    setPendiente(null)
  }

  function elegir(id: number) {
    if (id === elegida?.id) return
    if (hayCambios) setPendiente(id)
    else mostrar(id)
  }

  return (
    <>
      {elegida && (
        <div className="asigna">
          <nav className="asigna__lista" aria-label="Funciones">
            <GrupoFunciones titulo="Vienen" funciones={vienen} elegida={elegida.id} onElegir={elegir} />
            <GrupoFunciones titulo="Ya pasaron" funciones={pasaron} elegida={elegida.id} onElegir={elegir} />
          </nav>
          <section className="asigna__panel" aria-label={`Reparto de ${elegida.name || elegida.venue}`}>
            <h2 className="asigna__titulo">{elegida.name || elegida.venue}</h2>
            <p className="rs" style={{ margin: '0 0 var(--s3)', whiteSpace: 'normal' }}>
              {dayLabel(elegida.starts_at)} · {functionTime(elegida.starts_at)}
              {elegida.name ? ` · ${elegida.venue}` : ''}
            </p>
            <AllocationsEditor
              key={elegida.id}
              fn={{ id: elegida.id, capacity: elegida.capacity }}
              soloLectura={funcionTerminada(elegida.starts_at)}
              onCambios={setHayCambios}
            />
          </section>
        </div>
      )}

      {pendiente !== null && (
        <Modal
          open
          onClose={() => setPendiente(null)}
          label="Asignaciones"
          title="Tenés cambios sin guardar"
          sub={elegida?.name || elegida?.venue}
          footer={
            <>
              <Button onClick={() => mostrar(pendiente)}>Descartar los cambios</Button>
              <Button go onClick={() => setPendiente(null)}>
                Seguir repartiendo
              </Button>
            </>
          }
        >
          <p className="note">Si cambiás de función ahora, se pierde el reparto que todavía no guardaste.</p>
        </Modal>
      )}
    </>
  )
}
