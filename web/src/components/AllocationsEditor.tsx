import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'
import type { ShowFunction } from '../api/client'
import { repartirPorIgual } from '../lib/reparto'
import { Button } from '../ui/Button'
import { Stepper } from '../ui/Stepper'
import { Row } from '../ui/Row'
import { Status } from '../ui/Status'

/**
 * Tablero de asignacion de cupos de una funcion (C8; sistema B en C19):
 * a qué roles se les reparte (C22: coristas por defecto; se puede sumar
 * dirección o un rol propio), cuánto se repartió del cupo, una fila por
 * persona con stepper, y
 * guardado en batch. El "−" se frena en lo ya vendido. Con `soloLectura` (la
 * función ya pasó) muestra el reparto como quedó, sin nada que tocar.
 * `onCambios` avisa si hay cambios sin guardar.
 */
export function AllocationsEditor({
  fn,
  soloLectura = false,
  onCambios,
}: {
  fn: Pick<ShowFunction, 'id' | 'capacity'>
  soloLectura?: boolean
  onCambios?: (hay: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<number, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // El reparto anterior a "Repartir por igual", para poder deshacerlo.
  const [antesDeIgualar, setAntesDeIgualar] = useState<Record<number, number> | null>(null)

  const board = useQuery({
    queryKey: ['function-allocations', fn.id],
    queryFn: () => api.functionAllocations(fn.id),
  })

  const roles = useMutation({
    meta: { exito: 'Listo: cambió a quién se le reparte' },
    mutationFn: (keys: string[]) => api.putAllocationRoles(fn.id, keys),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['function-allocations', fn.id] })
      void queryClient.invalidateQueries({ queryKey: ['my-allocations'] })
      void queryClient.invalidateQueries({ queryKey: ['functions-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['home'] })
      void queryClient.invalidateQueries({ queryKey: ['direccion'] })
      void queryClient.invalidateQueries({ queryKey: ['team'] })
      void queryClient.invalidateQueries({ queryKey: ['seasons-overview'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar a quién se le reparte.'),
  })

  const save = useMutation({
    meta: { exito: 'Reparto guardado' },
    mutationFn: (entries: Array<{ user_id: number; quantity: number }>) =>
      api.putAllocations(fn.id, entries),
    onSuccess: () => {
      setError(null)
      setDrafts({})
      setAntesDeIgualar(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      void queryClient.invalidateQueries({ queryKey: ['function-allocations', fn.id] })
      void queryClient.invalidateQueries({ queryKey: ['my-allocations'] })
      // Repartir el cupo puede cerrar la alerta de Dirección (C9).
      void queryClient.invalidateQueries({ queryKey: ['attention'] })
      void queryClient.invalidateQueries({ queryKey: ['functions-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['home'] })
      void queryClient.invalidateQueries({ queryKey: ['direccion'] })
      void queryClient.invalidateQueries({ queryKey: ['team'] })
      void queryClient.invalidateQueries({ queryKey: ['seasons-overview'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudieron guardar las asignaciones.'),
  })

  // Solo cuentan los cambios de quien sigue en el tablero: si se sacó su rol
  // del reparto, su borrador ya no aplica.
  const pendientes = Object.entries(drafts).filter(([userId, qty]) => {
    const fila = board.data?.allocations.find((r) => r.user_id === Number(userId))
    return fila !== undefined && fila.assigned !== qty
  })
  const dirty = pendientes.length > 0
  useEffect(() => onCambios?.(dirty), [dirty, onCambios])

  if (board.isPending) return <p className="rs">Cargando el reparto…</p>
  if (!board.data) return <p className="st st--bad">No se pudo cargar el tablero.</p>

  const rows = board.data.allocations
  const elegidos = board.data.roles
  const opciones = board.data.role_options

  // A quién se le reparte: un botón por rol que vende. Se guarda al tocarlo;
  // quien queda afuera pierde su cupo (el server frena si ya vendió).
  function alternarRol(key: string) {
    const siguiente = elegidos.includes(key) ? elegidos.filter((k) => k !== key) : [...elegidos, key]
    if (siguiente.length === 0) return
    setAntesDeIgualar(null)
    roles.mutate(siguiente)
  }
  const selectorDeRoles = (
    <div className="reparto-roles">
      <span className="reparto-roles__t">Se reparte a</span>
      <div className="reparto-roles__ops" role="group" aria-label="Roles que reciben entradas">
        {opciones.map((o) => {
          const activo = elegidos.includes(o.key)
          const ultimo = activo && elegidos.length === 1
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={activo}
              disabled={soloLectura || roles.isPending || ultimo}
              title={ultimo ? 'Tiene que quedar al menos un rol' : undefined}
              onClick={() => alternarRol(o.key)}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )

  if (rows.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
        {selectorDeRoles}
        {error && (
          <p className="st st--bad" role="alert">
            {error}
          </p>
        )}
        <p className="rs">Nadie activo en esta temporada tiene esos roles.</p>
      </div>
    )
  }

  const value = (userId: number, assigned: number) => drafts[userId] ?? assigned
  const totalAssigned = rows.reduce((acc, r) => acc + value(r.user_id, r.assigned), 0)
  const totalSold = rows.reduce((acc, r) => acc + r.sold, 0)
  const unassigned = Math.max(fn.capacity - totalAssigned, 0)
  const overCapacity = totalAssigned > fn.capacity

  const iguales = repartirPorIgual(fn.capacity, rows.map((r) => r.sold))
  const yaIgualado = rows.every((r, i) => value(r.user_id, r.assigned) === iguales[i])
  function repartirIgual() {
    setAntesDeIgualar(drafts)
    setDrafts(Object.fromEntries(rows.map((r, i) => [r.user_id, iguales[i]])))
    setSaved(false)
  }
  const menos = Math.min(...iguales)
  const mas = Math.max(...iguales)
  const resultadoIgual =
    menos === mas
      ? `${menos} para cada persona`
      : mas - menos === 1
        ? `Entre ${menos} y ${mas} para cada persona`
        : `Entre ${menos} y ${mas} para cada persona, porque nadie baja de lo que ya vendió`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
      {selectorDeRoles}
      <div>
        <div className="tile__meta">
          <span className="tile__q">
            {totalAssigned} <em>de {fn.capacity} repartidas · {totalSold} vendidas</em>
          </span>
          {soloLectura ? (
            <Status tone="mute">Ya pasó</Status>
          ) : overCapacity ? (
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

      {soloLectura && (
        <p className="rs" style={{ whiteSpace: 'normal', margin: 0 }}>
          Esta función ya pasó: el reparto quedó así y no se puede cambiar.
        </p>
      )}

      {error && (
        <p className="st st--bad" role="alert">
          {error}
        </p>
      )}

      {!soloLectura && (
        <div className="reparto-igual">
          <Button disabled={yaIgualado} onClick={repartirIgual}>
            Repartir por igual
          </Button>
          {antesDeIgualar !== null && (
            <span className="rs">
              {resultadoIgual}. Falta guardar.{' '}
              <button
                type="button"
                className="card__a"
                onClick={() => {
                  setDrafts(antesDeIgualar)
                  setAntesDeIgualar(null)
                }}
              >
                Deshacer
              </button>
            </span>
          )}
        </div>
      )}

      <div className="mini">
        {rows.map((row) => {
          const current = value(row.user_id, row.assigned)
          return (
            <Row
              key={row.user_id}
              title={row.seller_name}
              sub={
                current > 0 ? (
                  <>
                    Vendió {row.sold} de {current}
                    <div className="tile__bar" aria-hidden>
                      <i style={{ width: `${Math.min(100, (row.sold / current) * 100)}%` }} />
                    </div>
                  </>
                ) : (
                  'Sin cupo'
                )
              }
              amount={soloLectura ? String(current) : undefined}
              status={
                soloLectura ? undefined : (
                  <Stepper
                    value={current}
                    min={row.sold}
                    onChange={(n) => {
                      setDrafts({ ...drafts, [row.user_id]: n })
                      setAntesDeIgualar(null)
                    }}
                  />
                )
              }
            />
          )
        })}
      </div>
      {!soloLectura && (
        <>
          <p className="rs" style={{ whiteSpace: 'normal', margin: 0 }}>
            El − se frena en lo ya vendido: no podés bajar un cupo por debajo de eso.
          </p>

          <Button
            go
            wide
            disabled={!dirty || overCapacity || save.isPending}
            onClick={() =>
              save.mutate(
                pendientes.map(([userId, qty]) => ({
                  user_id: Number(userId),
                  quantity: qty,
                })),
              )
            }
          >
            {save.isPending ? 'Guardando…' : saved ? 'Guardado' : 'Guardar el reparto'}
          </Button>
        </>
      )}
    </div>
  )
}
