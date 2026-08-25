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
      <h1 className="page-title" style={{ marginBottom: 2 }}>Modo puerta</h1>
      <p className="eyebrow" style={{ margin: '0 0 12px' }}>Elegí la función de hoy</p>

      {isPending ? (
        <p className="muted">Cargando funciones…</p>
      ) : data && data.functions.length > 0 ? (
        <div className="stack">
          {data.functions.map((fn) => (
            <Link
              key={fn.id}
              to={`/puerta/${fn.id}`}
              className="lrow"
              style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
            >
              <div className="lrow__head">
                <span>
                  <b>{fn.name ?? fn.venue}</b>
                  <span className="lrow__sub" style={{ display: 'block' }}>
                    {formatDateTime(fn.starts_at)} · {fn.sold} de {fn.capacity} vendidas
                  </span>
                </span>
                <span className="muted" aria-hidden>›</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">No hay funciones cargadas.</p>
      )}
    </>
  )
}
