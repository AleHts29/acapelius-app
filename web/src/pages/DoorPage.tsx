import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import { formatDateTime } from '../lib/format'

// DoorPage: la recepcion elige la funcion del dia y entra al modo puerta.
export function DoorPage() {
  const { data, isPending } = useQuery({
    queryKey: ['functions'],
    queryFn: () => api.listFunctions(),
  })

  return (
    <>
      <h1 className="page-title">Modo puerta</h1>
      <p className="muted" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
        Elegi la funcion de hoy.
      </p>

      {isPending ? (
        <p className="muted">Cargando funciones...</p>
      ) : data && data.functions.length > 0 ? (
        <div className="stack">
          {data.functions.map((fn) => (
            <Link key={fn.id} className="nav-card" to={`/puerta/${fn.id}`}>
              <span>
                <strong>{fn.name ?? fn.venue}</strong>
                <br />
                <span className="muted">{formatDateTime(fn.starts_at)}</span>
              </span>
              <span className="muted">›</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">No hay funciones cargadas.</p>
      )}
    </>
  )
}
