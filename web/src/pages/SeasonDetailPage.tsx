import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'
import type { ShowFunction } from '../api/client'
import { AllocationsEditor } from '../components/AllocationsEditor'
import { formatDateTime, formatMoney, isoToLocalInput, localInputToISO, pesosToCents } from '../lib/format'

interface FunctionFormValues {
  name: string
  venue: string
  startsAtLocal: string
  capacity: string
  pricePesos: string
}

const emptyForm: FunctionFormValues = {
  name: '',
  venue: '',
  startsAtLocal: '',
  capacity: '',
  pricePesos: '',
}

function formFromFunction(fn: ShowFunction): FunctionFormValues {
  return {
    name: fn.name ?? '',
    venue: fn.venue,
    startsAtLocal: isoToLocalInput(fn.starts_at),
    capacity: String(fn.capacity),
    pricePesos: String(fn.price_cents / 100),
  }
}

/** Valida el formulario y lo convierte a los tipos de la API. */
function parseForm(values: FunctionFormValues):
  | { ok: true; venue: string; name: string; startsAt: string; capacity: number; priceCents: number }
  | { ok: false; message: string } {
  if (values.venue.trim() === '') return { ok: false, message: 'Falta el lugar.' }
  if (values.startsAtLocal === '') return { ok: false, message: 'Falta la fecha y hora.' }

  const capacity = Number(values.capacity)
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return { ok: false, message: 'El cupo tiene que ser un número mayor a cero.' }
  }

  const priceCents = pesosToCents(values.pricePesos)
  if (priceCents === null) {
    return { ok: false, message: 'El precio no es válido. Ejemplo: 8000 o 8000,50.' }
  }

  return {
    ok: true,
    venue: values.venue.trim(),
    name: values.name,
    startsAt: localInputToISO(values.startsAtLocal),
    capacity,
    priceCents,
  }
}

function FunctionFields({
  values,
  onChange,
}: {
  values: FunctionFormValues
  onChange: (values: FunctionFormValues) => void
}) {
  const set = (patch: Partial<FunctionFormValues>) => onChange({ ...values, ...patch })
  return (
    <>
      <label className="field">
        <span className="field__label">Lugar</span>
        <input
          className="field__input"
          type="text"
          value={values.venue}
          onChange={(e) => set({ venue: e.target.value })}
          placeholder="Teatro Municipal"
        />
      </label>
      <label className="field">
        <span className="field__label">Fecha y hora</span>
        <input
          className="field__input"
          type="datetime-local"
          value={values.startsAtLocal}
          onChange={(e) => set({ startsAtLocal: e.target.value })}
        />
      </label>
      <div className="form-grid">
        <label className="field">
          <span className="field__label">Cupo</span>
          <input
            className="field__input"
            type="number"
            min={1}
            inputMode="numeric"
            value={values.capacity}
            onChange={(e) => set({ capacity: e.target.value })}
            placeholder="250"
          />
        </label>
        <label className="field">
          <span className="field__label">Precio ($)</span>
          <input
            className="field__input"
            type="text"
            inputMode="decimal"
            value={values.pricePesos}
            onChange={(e) => set({ pricePesos: e.target.value })}
            placeholder="8000"
          />
        </label>
      </div>
      <label className="field">
        <span className="field__label">Nombre (opcional)</span>
        <input
          className="field__input"
          type="text"
          value={values.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Función de gala"
        />
      </label>
    </>
  )
}

function FunctionCard({
  fn,
  focused,
}: {
  fn: ShowFunction
  /** Llegó desde una alerta de Dirección (C9): abre las asignaciones sola. */
  focused?: boolean
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [showAllocations, setShowAllocations] = useState(focused ?? false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Si vino enfocada desde una alerta, se trae la tarjeta a la vista.
  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focused])
  const [values, setValues] = useState<FunctionFormValues>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const sinAsignar = Math.max(fn.capacity - fn.assigned, 0)

  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updateFunction>[1]) => api.updateFunction(fn.id, input),
    onSuccess: () => {
      setEditing(false)
      setError(null)
      // ['functions'] a secas: por prefijo alcanza también a ['functions', id],
      // que es la de esta pantalla. Al revés no: invalidar la de la temporada
      // dejaba con datos viejos a Vender, Ventas, Puerta, Asistencia e Inicio,
      // que piden la lista completa.
      void queryClient.invalidateQueries({ queryKey: ['functions'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo guardar.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = parseForm(values)
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    update.mutate({
      name: parsed.name,
      venue: parsed.venue,
      starts_at: parsed.startsAt,
      capacity: parsed.capacity,
      price_cents: parsed.priceCents,
    })
  }

  if (editing) {
    return (
      <form className="panel" onSubmit={handleSubmit}>
        <p className="panel__label">Editar función</p>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <FunctionFields values={values} onChange={setValues} />
        <div className="form-row">
          <button className="button" type="submit" disabled={update.isPending}>
            {update.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            className="button button--ghost form-row__action"
            type="button"
            onClick={() => {
              setEditing(false)
              setError(null)
            }}
          >
            Cancelar
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className={`panel ${focused ? 'panel--focused' : ''}`} ref={cardRef}>
      <div className="lrow__head">
        <div>
          <h3 style={{ fontSize: 16 }}>{fn.name ?? fn.venue}</h3>
          {fn.name && <p className="lrow__sub" style={{ margin: 0 }}>{fn.venue}</p>}
        </div>
        {/* Con ingresos registrados la función queda congelada (spec §5.1):
            cambiar fecha, lugar o cupo a esa altura sólo genera lío en la
            puerta. Antes el botón estaba igual y el 409 aparecía recién al
            guardar, con el formulario ya completo. */}
        {fn.entered > 0 ? (
          <span className="muted" style={{ fontSize: 10.5, textAlign: 'right', maxWidth: 130 }}>
            Ya tiene ingresos: no se edita
          </span>
        ) : (
          <button
            className="button button--ghost"
            type="button"
            onClick={() => {
              setValues(formFromFunction(fn))
              setEditing(true)
            }}
          >
            Editar
          </button>
        )}
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 13 }}>{formatDateTime(fn.starts_at)}</p>
      <p className="lrow__sub" style={{ margin: '1px 0 0' }}>
        Cupo {fn.capacity} · {formatMoney(fn.price_cents)} por entrada · {fn.sold} vendidas
      </p>

      {/* Repartir el cupo es la tarea de dirección que menos se encuentra: el
          botón dice cuánto falta y pesa como acción principal cuando queda
          algo sin repartir. */}
      <button
        className={`button${sinAsignar > 0 && !showAllocations ? '' : ' button--ghost'}`}
        style={{ marginTop: 10 }}
        type="button"
        onClick={() => setShowAllocations(!showAllocations)}
      >
        {showAllocations
          ? 'Cerrar asignaciones'
          : sinAsignar > 0
            ? `Asignar entradas a coristas · faltan ${sinAsignar}`
            : 'Asignar entradas a coristas'}
      </button>
      {showAllocations && <AllocationsEditor fn={fn} />}
    </div>
  )
}

export function SeasonDetailPage() {
  const { seasonId: rawSeasonId } = useParams()
  const seasonId = Number(rawSeasonId)
  // ?fn=N llega de las alertas de Dirección: esa función abre asignaciones.
  const [searchParams] = useSearchParams()
  const focusFunctionId = Number(searchParams.get('fn')) || undefined
  const queryClient = useQueryClient()

  const [values, setValues] = useState<FunctionFormValues>(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.listSeasons() })
  const functions = useQuery({
    queryKey: ['functions', seasonId],
    queryFn: () => api.listFunctions(seasonId),
    enabled: Number.isInteger(seasonId),
  })

  const season = seasons.data?.seasons.find((s) => s.id === seasonId)

  const create = useMutation({
    mutationFn: (input: Parameters<typeof api.createFunction>[0]) => api.createFunction(input),
    onSuccess: () => {
      setValues(emptyForm)
      setShowForm(false)
      setError(null)
      // ['functions'] a secas: por prefijo alcanza también a ['functions', id],
      // que es la de esta pantalla. Al revés no: invalidar la de la temporada
      // dejaba con datos viejos a Vender, Ventas, Puerta, Asistencia e Inicio,
      // que piden la lista completa.
      void queryClient.invalidateQueries({ queryKey: ['functions'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la funcion.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = parseForm(values)
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    create.mutate({
      season_id: seasonId,
      name: parsed.name,
      venue: parsed.venue,
      starts_at: parsed.startsAt,
      capacity: parsed.capacity,
      price_cents: parsed.priceCents,
    })
  }

  if (!Number.isInteger(seasonId)) {
    return <p className="alert">Temporada inválida.</p>
  }

  return (
    <>
      <h1 className="page-title">{season?.name ?? 'Temporada'}</h1>

      {showForm ? (
        <form className="panel" onSubmit={handleSubmit}>
          <p className="panel__label">Nueva función</p>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <FunctionFields values={values} onChange={setValues} />
          <div className="form-row">
            <button className="button" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creando…' : 'Crear función'}
            </button>
            <button
              className="button button--ghost form-row__action"
              type="button"
              onClick={() => {
                setShowForm(false)
                setError(null)
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button className="button" type="button" onClick={() => setShowForm(true)}>
          Agregar funcion
        </button>
      )}

      <div className="stack" style={{ marginTop: 12 }}>
        {functions.isPending ? (
          <p className="muted">Cargando funciones…</p>
        ) : functions.data && functions.data.functions.length > 0 ? (
          functions.data.functions.map((fn) => (
            <FunctionCard key={fn.id} fn={fn} focused={fn.id === focusFunctionId} />
          ))
        ) : (
          <p className="muted">Esta temporada todavía no tiene funciones.</p>
        )}
      </div>
    </>
  )
}
