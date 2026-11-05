import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'

import { api } from '../api/client'
import { calendarDaysUntil, formatMoney } from '../lib/format'
import { useIsDesktop } from '../lib/viewport'
import { useSeason } from '../season/SeasonProvider'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'

/**
 * La pestaña de dirección en el celular: en la barra de abajo entran cuatro
 * cosas y la dirección tiene seis pantallas más, que sin esto no tenían entrada.
 * Cada fila dice qué hay para hacer ahí. En escritorio esto ya lo hace la lateral.
 */
export function GestionPage() {
  const escritorio = useIsDesktop()
  const { season, seasonId } = useSeason()
  const id = season?.id
  const direccion = useQuery({
    queryKey: ['direccion', id],
    queryFn: () => api.direccion(id!),
    enabled: id !== undefined && !escritorio,
  })
  const home = useQuery({
    queryKey: ['home', seasonId],
    queryFn: () => api.home(seasonId),
    enabled: !escritorio,
  })
  const temporadas = useQuery({
    queryKey: ['seasons-overview'],
    queryFn: () => api.seasonsOverview(),
    enabled: !escritorio,
  })
  const equipo = useQuery({
    queryKey: ['team', seasonId],
    queryFn: () => api.team(seasonId),
    enabled: !escritorio,
  })

  if (escritorio) return <Navigate to="/direccion" replace />

  const money = direccion.data?.money
  // Sólo lo que todavía se puede repartir: el cupo libre de una función que ya
  // pasó no es una tarea.
  const funciones = home.data?.functions
  const sinRepartir = (funciones ?? [])
    .filter((fn) => calendarDaysUntil(fn.starts_at) >= 0)
    .reduce((acc, fn) => acc + Math.max(fn.capacity - fn.assigned, 0), 0)
  const resumen = equipo.data?.summary

  return (
    <>
      <PageHeader title="Gestión" label={season?.name} />
      <div className="card">
        <Row title="Resumen" sub="Cómo viene la temporada" to="/direccion" />
        <Row
          title="Rendiciones"
          sub={
            money
              ? money.sellers_owing > 0
                ? `${money.sellers_owing} ${money.sellers_owing === 1 ? 'corista debe' : 'coristas deben'} ${formatMoney(money.unsettled_cents)}`
                : 'Nadie debe rendir'
              : undefined
          }
          to="/panel/rendiciones"
        />
        {id !== undefined && (
          <Row
            title="Asignaciones"
            sub={funciones ? (sinRepartir > 0 ? `${sinRepartir} entradas sin repartir` : 'Todo repartido') : undefined}
            to={`/temporadas/${id}?vista=asignaciones`}
          />
        )}
        <Row title="Asistencia" sub="Quién entró a cada función" to="/panel/asistencia" />
        <Row
          title="Temporadas"
          sub={temporadas.data ? `${temporadas.data.seasons.length} en total` : undefined}
          to="/temporadas"
        />
        <Row title="Equipo" sub={resumen ? `${resumen.total} personas` : undefined} to="/usuarios" />
      </div>
    </>
  )
}
