import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'
import type { ShowFunction } from '../api/client'
import { Button } from '../ui/Button'
import { Stepper } from '../ui/Stepper'
import { Row } from '../ui/Row'
import { Status } from '../ui/Status'

/**
 * Tablero de asignacion de cupos de una funcion (C8; sistema B en C19):
 * cuánto se repartió del cupo, una fila por corista activa con stepper, y
 * guardado en batch. El "−" se frena en lo ya vendido.
 */
export function AllocationsEditor({ fn }: { fn: Pick<ShowFunction, 'id' | 'capacity'> }) {
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<number, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const board = useQuery({
    queryKey: ['function-allocations', fn.id],
    queryFn: () => api.functionAllocations(fn.id),
  })

  const save = useMutation({
    mutationFn: (entries: Array<{ user_id: number; quantity: number }>) =>
      api.putAllocations(fn.id, entries),
    onSuccess: () => {
      setError(null)
      setDrafts({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      void queryClient.invalidateQueries({ queryKey: ['function-allocations', fn.id] })
      void queryClient.invalidateQueries({ queryKey: ['my-allocations'] })
      // Repartir el cupo puede cerrar la alerta de Dirección (C9).
      void queryClient.invalidateQueries({ queryKey: ['attention'] })
      void queryClient.invalidateQueries({ queryKey: ['functions-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['home'] })
      void queryClient.invalidateQueries({ queryKey: ['direccion'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudieron guardar las asignaciones.'),
  })

  if (board.isPending) return <p className="rs">Cargando coristas…</p>
  if (!board.data) return <p className="st st--bad">No se pudo cargar el tablero.</p>

  const rows = board.data.allocations
  if (rows.length === 0) {
    return <p className="rs">No hay coristas activas para asignar.</p>
  }

  const value = (userId: number, assigned: number) => drafts[userId] ?? assigned
  const totalAssigned = rows.reduce((acc, r) => acc + value(r.user_id, r.assigned), 0)
  const totalSold = rows.reduce((acc, r) => acc + r.sold, 0)
  const unassigned = Math.max(fn.capacity - totalAssigned, 0)
  const dirty = Object.entries(drafts).some(
    ([userId, qty]) => rows.find((r) => r.user_id === Number(userId))?.assigned !== qty,
  )
  const overCapacity = totalAssigned > fn.capacity

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
      <div>
        <div className="tile__meta">
          <span className="tile__q">
            {totalAssigned} <em>de {fn.capacity} repartidas · {totalSold} vendidas</em>
          </span>
          {overCapacity ? (
            <Status tone="bad">Te pasaste por {totalAssigned - fn.capacity}</Status>
          ) : unassigned > 0 ? (
            <Status tone="warn">Sin repartir · {unassigned}</Status>
          ) : (
            <Status tone="ok">Repartida</Status>
          )}
        </div>
        <div className="tile__bar" aria-hidden>
          <i className={overCapacity ? 'tk' : undefined} style={{ width: `${Math.min(100, (totalAssigned / fn.capacity) * 100)}%` }} />
        </div>
      </div>

      {error && (
        <p className="st st--bad" role="alert">
          {error}
        </p>
      )}

      <div className="mini">
        {rows.map((row) => {
          const current = value(row.user_id, row.assigned)
          return (
            <Row
              key={row.user_id}
              title={row.seller_name}
              sub={`Vendió ${row.sold} de ${current}`}
              status={
                <Stepper
                  value={current}
                  min={row.sold}
                  onChange={(n) => setDrafts({ ...drafts, [row.user_id]: n })}
                />
              }
            />
          )
        })}
      </div>
      <p className="rs" style={{ whiteSpace: 'normal', margin: 0 }}>
        El − se frena en lo ya vendido: no podés bajar un cupo por debajo de eso.
      </p>

      <Button
        go
        wide
        disabled={!dirty || overCapacity || save.isPending}
        onClick={() =>
          save.mutate(
            Object.entries(drafts).map(([userId, qty]) => ({
              user_id: Number(userId),
              quantity: qty,
            })),
          )
        }
      >
        {save.isPending ? 'Guardando…' : saved ? 'Guardado' : 'Guardar el reparto'}
      </Button>
    </div>
  )
}
