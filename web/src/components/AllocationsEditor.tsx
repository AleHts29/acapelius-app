import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'

/**
 * Editor de asignaciones de una funcion: cuantas entradas le toca vender a
 * cada corista. Es un objetivo de venta (el tope real sigue siendo el cupo);
 * poner 0 borra la asignacion.
 */
export function AllocationsEditor({ functionId }: { functionId: number }) {
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.listUsers() })
  const allocations = useQuery({
    queryKey: ['function-allocations', functionId],
    queryFn: () => api.functionAllocations(functionId),
  })

  const save = useMutation({
    mutationFn: ({ userId, quantity }: { userId: number; quantity: number }) =>
      api.setAllocation(userId, functionId, quantity),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['function-allocations', functionId] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo guardar.'),
  })

  if (users.isPending || allocations.isPending) {
    return <p className="muted">Cargando coristas...</p>
  }

  const sellers = (users.data?.users ?? []).filter((u) => u.role === 'seller' && u.is_active)
  const byUser = new Map(
    (allocations.data?.allocations ?? []).map((a) => [a.user_id, a]),
  )

  if (sellers.length === 0) {
    return <p className="muted">No hay coristas activas para asignar.</p>
  }

  return (
    <div className="team-edit">
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {sellers.map((seller) => {
        const current = byUser.get(seller.id)
        const draft = drafts[seller.id] ?? (current ? String(current.assigned) : '')
        const changed = draft !== (current ? String(current.assigned) : '')
        return (
          <div key={seller.id} className="alloc-row">
            <span>
              {seller.name}
              {current && (
                <>
                  <br />
                  <span className="muted alloc-progress" style={{ fontSize: '0.85rem' }}>
                    vendio {current.sold} de {current.assigned}
                    {current.sold >= current.assigned && ' ✓'}
                  </span>
                </>
              )}
            </span>
            <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                className="alloc-row__input"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="0"
                value={draft}
                onChange={(e) => setDrafts({ ...drafts, [seller.id]: e.target.value })}
                aria-label={`Entradas asignadas a ${seller.name}`}
              />
              {changed && (
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={save.isPending}
                  onClick={() => {
                    const quantity = Number(draft || '0')
                    if (!Number.isInteger(quantity) || quantity < 0) {
                      setError('La cantidad tiene que ser un numero.')
                      return
                    }
                    save.mutate({ userId: seller.id, quantity })
                  }}
                >
                  Guardar
                </button>
              )}
            </span>
          </div>
        )
      })}
      <p className="muted" style={{ margin: '0.6rem 0 0', fontSize: '0.82rem' }}>
        Es un objetivo de venta, no un limite. Con 0 se borra la asignacion.
      </p>
    </div>
  )
}
