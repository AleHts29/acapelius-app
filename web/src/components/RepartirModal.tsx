import { useState } from 'react'

import type { FunctionSummary } from '../api/client'
import { dayLabel, functionTime } from '../lib/format'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Row } from '../ui/Row'
import { Status } from '../ui/Status'
import { AllocationsEditor } from './AllocationsEditor'

/**
 * Repartir cupos: elegir la función y, adentro, el tablero de siempre. Lo
 * abren Equipo ("Repartir cupos", "Cambiar cupo") y el popup de una función
 * en Temporadas, que llega con la función ya elegida.
 */
export function RepartirModal({
  funciones,
  inicial,
  onClose,
}: {
  funciones: FunctionSummary[]
  inicial?: FunctionSummary
  onClose: () => void
}) {
  const [elegida, setElegida] = useState<FunctionSummary | null>(
    inicial ?? (funciones.length === 1 ? funciones[0] : null),
  )
  return (
    <Modal
      open
      onClose={onClose}
      label="Repartir cupos"
      title={elegida ? `${dayLabel(elegida.starts_at)} · ${functionTime(elegida.starts_at)}` : 'Elegí la función'}
      sub={elegida ? elegida.venue : undefined}
      footer={
        elegida && funciones.length > 1 ? <Button onClick={() => setElegida(null)}>Otra función</Button> : undefined
      }
    >
      {elegida ? (
        <AllocationsEditor fn={{ id: elegida.id, capacity: elegida.capacity }} />
      ) : funciones.length === 0 ? (
        <p className="rs">Esta temporada todavía no tiene funciones.</p>
      ) : (
        <div className="mini">
          {funciones.map((fn) => {
            const libres = Math.max(fn.capacity - fn.assigned, 0)
            return (
              <Row
                key={fn.id}
                title={dayLabel(fn.starts_at)}
                sub={fn.venue}
                status={
                  libres > 0 ? <Status tone="mute">Sin repartir · {libres}</Status> : <Status tone="ok">Repartida</Status>
                }
                onClick={() => setElegida(fn)}
              />
            )
          })}
        </div>
      )}
    </Modal>
  )
}
