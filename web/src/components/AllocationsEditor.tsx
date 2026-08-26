import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'
import type { ShowFunction } from '../api/client'
import { StackedBar, Stepper } from '../ui/controls'

/**
 * Tablero de asignacion de cupos de una funcion (C8, mockup
 * acapelius-usuarios-cupos pantallas 3-4): barra apilada vendidas /
 * asignadas / sin asignar, una fila por corista activa con stepper, y
 * guardado en batch. El "−" se frena en lo ya vendido.
 */
export function AllocationsEditor({ fn }: { fn: ShowFunction }) {
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
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudieron guardar las asignaciones.'),
  })

  if (board.isPending) return <p className="muted">Cargando coristas…</p>
  if (!board.data) return <p className="alert">No se pudo cargar el tablero.</p>

  const rows = board.data.allocations
  if (rows.length === 0) {
    return <p className="muted">No hay coristas activas para asignar.</p>
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
    <div className="team-edit">
      <StackedBar
        label={`${totalSold} vendidas, ${totalAssigned - totalSold} asignadas sin vender, ${unassigned} sin asignar`}
        total={fn.capacity}
        segments={[
          { value: totalSold, tone: 'ok' },
          { value: Math.max(totalAssigned - totalSold, 0), tone: 'blue' },
          { value: unassigned, tone: 'line' },
        ]}
      />
      <p className="eyebrow" style={{ margin: '6px 0 4px', color: overCapacity ? 'var(--danger)' : undefined }}>
        {overCapacity
          ? `Te pasaste por ${totalAssigned - fn.capacity} del cupo de ${fn.capacity}`
          : `Quedan ${unassigned} sin asignar · cupo ${fn.capacity}`}
      </p>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {rows.map((row) => {
        const current = value(row.user_id, row.assigned)
        return (
          <div key={row.user_id} className="alloc-row">
            <span>
              {row.seller_name}
              <br />
              <span className="muted" style={{ fontSize: 11 }}>
                Vendió {row.sold} de {current}
              </span>
            </span>
            <Stepper
              value={current}
              min={row.sold}
              onChange={(n) => setDrafts({ ...drafts, [row.user_id]: n })}
              maxReason={undefined}
            />
          </div>
        )
      })}
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 10.5 }}>
        El − se frena en lo ya vendido: no podés bajar un cupo por debajo de eso.
      </p>

      <button
        className="button"
        style={{ marginTop: 10 }}
        type="button"
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
        {save.isPending ? 'Guardando…' : saved ? 'Guardado ✓' : 'Guardar asignaciones'}
      </button>
    </div>
  )
}
