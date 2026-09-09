import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Copy, LayoutList, Lock, Pencil, Plus, Receipt, Trash2, UserCheck, Users, X } from 'lucide-react'

import { ApiError, activeSeason, api } from '../api/client'
import type { FunctionSummary } from '../api/client'
import { AllocationsEditor } from '../components/AllocationsEditor'
import {
  calendarDaysUntil,
  dayAndMonth,
  formatMoney,
  functionDay,
  functionTime,
  isoToLocalInput,
  localInputToISO,
  pesosToCents,
} from '../lib/format'
import { ActionPanel } from '../ui/ActionPanel'
import { Menu } from '../ui/Menu'
import { EmptyState, PageHead, ProgressBar } from '../ui/controls'

/** La misma gracia que usa Inicio: a las 21:00 la función de las 20:00 no "pasó". */
const GRACIA_MS = 3 * 60 * 60 * 1000

function nombre(fn: FunctionSummary): string {
  return fn.name && fn.name !== '' ? fn.name : fn.venue
}

function yaPaso(fn: FunctionSummary): boolean {
  return new Date(fn.starts_at).getTime() < Date.now() - GRACIA_MS
}

/** Con ingresos registrados el server ya no acepta editarla (spec §5.1). */
function congelada(fn: FunctionSummary): boolean {
  return fn.entered > 0
}

function sinAsignar(fn: FunctionSummary): number {
  return Math.max(fn.capacity - fn.assigned, 0)
}

/** "Hoy" / "Mañana" / "En 4 días" para la función más cercana. */
function cuandoFalta(iso: string): string {
  const dias = calendarDaysUntil(iso)
  if (dias <= 0) return 'Hoy'
  if (dias === 1) return 'Mañana'
  return `En ${dias} días`
}

// --- Formulario de función ---------------------------------------------------

interface FormValues {
  name: string
  venue: string
  startsAtLocal: string
  capacity: string
  pricePesos: string
}

const vacio: FormValues = { name: '', venue: '', startsAtLocal: '', capacity: '', pricePesos: '' }

function desdeFuncion(fn: FunctionSummary, conFecha: boolean): FormValues {
  return {
    name: fn.name ?? '',
    venue: fn.venue,
    // Duplicar deja la fecha en blanco a propósito: es el único dato que
    // seguro cambia, y prellenarlo con el de la función vieja es la forma
    // segura de crear dos funciones el mismo día sin darse cuenta.
    startsAtLocal: conFecha ? isoToLocalInput(fn.starts_at) : '',
    capacity: String(fn.capacity),
    pricePesos: String(fn.price_cents / 100),
  }
}

function parsear(
  values: FormValues,
):
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

type Modo = 'nueva' | 'editar' | 'duplicar'

const titulos: Record<Modo, string> = {
  nueva: 'Nueva función',
  editar: 'Editar función',
  duplicar: 'Duplicar función',
}

/**
 * Crear, editar y duplicar son el mismo formulario: los tres escriben los
 * mismos cinco campos. Lo único que cambia es de dónde salen los valores
 * iniciales y a qué endpoint va el submit.
 */
function FuncionForm({
  modo,
  fn,
  seasonId,
  onDone,
}: {
  modo: Modo
  fn?: FunctionSummary
  seasonId: number
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<FormValues>(
    fn ? desdeFuncion(fn, modo === 'editar') : vacio,
  )
  const [error, setError] = useState<string | null>(null)
  // El precio arranca bloqueado cuando ya se vendió: se puede destrabar, pero
  // a mano y después de leer por qué.
  const [precioTrabado, setPrecioTrabado] = useState(modo === 'editar' && (fn?.sold ?? 0) > 0)

  function refrescar() {
    // Por prefijo: ['functions'] alcanza también a ['functions', seasonId], que
    // es la lista que leen Vender, Puerta, Asistencia e Inicio.
    void queryClient.invalidateQueries({ queryKey: ['functions'] })
    void queryClient.invalidateQueries({ queryKey: ['functions-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['direccion'] })
    void queryClient.invalidateQueries({ queryKey: ['attention'] })
    void queryClient.invalidateQueries({ queryKey: ['home'] })
    onDone()
  }

  const fallo = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'No se pudo guardar la función.')

  const crear = useMutation({
    mutationFn: (input: Parameters<typeof api.createFunction>[0]) => api.createFunction(input),
    onSuccess: refrescar,
    onError: fallo,
  })
  const editar = useMutation({
    mutationFn: (input: Parameters<typeof api.updateFunction>[1]) =>
      api.updateFunction(fn!.id, input),
    onSuccess: refrescar,
    onError: fallo,
  })
  const guardando = crear.isPending || editar.isPending

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const p = parsear(values)
    if (!p.ok) {
      setError(p.message)
      return
    }
    const campos = {
      name: p.name,
      venue: p.venue,
      starts_at: p.startsAt,
      capacity: p.capacity,
      price_cents: p.priceCents,
    }
    if (modo === 'editar') editar.mutate(campos)
    else crear.mutate({ season_id: seasonId, ...campos })
  }

  const set = (patch: Partial<FormValues>) => setValues({ ...values, ...patch })

  return (
    <form className="sheet-form" onSubmit={handleSubmit}>
      <div className="sheet-head">
        <span>
          <b>{titulos[modo]}</b>
          {fn && modo !== 'nueva' && (
            <span>
              {nombre(fn)}
              {modo === 'editar' && fn.sold > 0 && ` · ${fn.sold} entradas vendidas`}
            </span>
          )}
        </span>
      </div>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <label className="field">
        <span className="field__label">Nombre</span>
        <input
          className="field__input"
          type="text"
          autoFocus
          value={values.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Función de gala"
        />
      </label>
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
            placeholder="80"
          />
        </label>
        <label className="field">
          <span className="field__label">Precio ($)</span>
          <input
            className="field__input"
            type="text"
            inputMode="decimal"
            disabled={precioTrabado}
            value={values.pricePesos}
            onChange={(e) => set({ pricePesos: e.target.value })}
            placeholder="8000"
          />
        </label>
      </div>

      {precioTrabado && fn && (
        <div className="lockmsg">
          <Lock size={13} aria-hidden />
          <div>
            <p>
              Ya se vendieron {fn.sold} entradas a {formatMoney(fn.price_cents)}. Esas ventas
              guardan su propio importe y no cambian, pero de acá en adelante la misma función
              tendría dos precios distintos.
            </p>
            <button type="button" className="linkish" onClick={() => setPrecioTrabado(false)}>
              Cambiar el precio igual
            </button>
          </div>
        </div>
      )}

      <div className="form-row" style={{ marginTop: 14 }}>
        <button className="button" type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : modo === 'editar' ? 'Guardar cambios' : 'Crear función'}
        </button>
        <button className="button button--ghost form-row__action" type="button" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

// --- Fila de función ---------------------------------------------------------

function Fila({
  fn,
  destacada,
  onAsignar,
  onEditar,
  onDuplicar,
  onCancelar,
}: {
  fn: FunctionSummary
  destacada: boolean
  onAsignar: () => void
  onEditar: () => void
  onDuplicar: () => void
  onCancelar: () => void
}) {
  const navigate = useNavigate()
  const pasada = yaPaso(fn)
  const trabada = congelada(fn)
  const faltan = sinAsignar(fn)

  return (
    <article className={`fnline${destacada ? ' fnline--next' : ''}`}>
      <div className="fnline__nm">
        <div className="fnline__t">
          <b>{nombre(fn)}</b>
          {destacada ? (
            <span className="fntag fntag--next">{cuandoFalta(fn.starts_at)}</span>
          ) : pasada ? (
            <span className="fntag">Hecha</span>
          ) : null}
        </div>
        {fn.name && fn.name !== '' && <div className="fnline__v">{fn.venue}</div>}
      </div>

      <div className="fnline__dt">
        <b>{functionDay(fn.starts_at)}</b>
        <span>
          {functionTime(fn.starts_at)} · cupo {fn.capacity} · {formatMoney(fn.price_cents)}
        </span>
      </div>

      <div className="fnline__prog">
        <ProgressBar value={fn.sold} max={fn.capacity} tone={pasada ? 'ok' : 'blue'} />
        <div className="fnline__lg">
          <span>
            <b>{fn.sold}</b>/{fn.capacity} vendidas
          </span>
          <span>{pasada ? `${fn.entered} entraron` : `${fn.assigned} asignadas`}</span>
        </div>
      </div>

      <div className="fnline__money">
        <b>{formatMoney(fn.collected_cents)}</b>
        <span>Recaudado</span>
      </div>

      <div className="fnline__acts">
        {!pasada && (
          <>
            <button
              className={`button button--sm${faltan > 0 ? ' button--warn' : ' button--ghost'}`}
              type="button"
              onClick={onAsignar}
            >
              <Users size={13} aria-hidden />
              {faltan > 0 ? `Asignar · faltan ${faltan}` : 'Asignar'}
            </button>
            {!trabada && (
              <button className="button button--ghost button--sm" type="button" onClick={onEditar}>
                <Pencil size={13} aria-hidden />
                Editar
              </button>
            )}
          </>
        )}
        {trabada && (
          <span
            className="fntag fntag--lock"
            title={`Ya tiene ${fn.entered} ingresos registrados en la puerta: cambiarle fecha, lugar o cupo a esta altura sólo genera lío`}
          >
            <Lock size={11} aria-hidden />
            {/* "Cerrada" sólo se entiende si la función ya pasó; en una que
                todavía se vende, el chip tiene que decir qué es lo que no se
                puede hacer. */}
            {pasada ? 'Cerrada' : 'No se edita'}
          </span>
        )}
        <Menu
          trigger="kebab"
          label={`Más opciones de ${nombre(fn)}`}
          align="right"
          groups={[
            {
              options: [
                {
                  id: 'editar',
                  label: 'Editar función',
                  icon: <Pencil size={15} />,
                  disabled: trabada,
                  disabledReason: `Ya tiene ${fn.entered} ingresos registrados en la puerta`,
                  onSelect: onEditar,
                },
                {
                  id: 'duplicar',
                  label: 'Duplicar',
                  hint: 'Mismo lugar, cupo y precio, con otra fecha',
                  icon: <Copy size={15} />,
                  onSelect: onDuplicar,
                },
                {
                  id: 'asistencia',
                  label: 'Ver asistencia',
                  icon: <UserCheck size={15} />,
                  onSelect: () => navigate(`/panel/asistencia?fn=${fn.id}`),
                },
                {
                  id: 'ventas',
                  label: 'Ver ventas',
                  icon: <Receipt size={15} />,
                  // /ventas es el listado de ventas (dirección lo ve completo);
                  // /panel/ventas es el reporte agregado, sin filtro por función.
                  onSelect: () => navigate(`/ventas?fn=${fn.id}`),
                },
              ],
            },
            {
              separated: true,
              options: [
                {
                  id: 'cancelar',
                  label: 'Cancelar función',
                  tone: 'danger',
                  icon: <X size={15} />,
                  disabled: fn.sold > 0,
                  disabledReason: `Ya vendió ${fn.sold} entradas: primero hay que resolver los reembolsos`,
                  onSelect: onCancelar,
                },
              ],
            },
          ]}
        />
      </div>
    </article>
  )
}

// --- Pantalla ----------------------------------------------------------------

type Panel =
  | { kind: 'funcion'; modo: Modo; fn?: FunctionSummary }
  | { kind: 'asignar'; fn: FunctionSummary }
  | { kind: 'cancelar'; fn: FunctionSummary }
  | null

export function SeasonPage() {
  const { seasonId: rawSeasonId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // ?fn=N llega de las alertas de Dirección: esa función abre asignaciones.
  const [searchParams] = useSearchParams()
  const focoId = Number(searchParams.get('fn')) || undefined
  const [panel, setPanel] = useState<Panel>(null)
  // Una sola vez: si no, cerrar el panel que abrió la alerta lo volvería a abrir.
  const foco = useRef(false)
  const [errorTemporada, setErrorTemporada] = useState<string | null>(null)

  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.listSeasons() })
  const todas = seasons.data?.seasons ?? []
  const enCurso = activeSeason(todas)
  // Sin :seasonId en la URL se mira la temporada en curso, que es lo que
  // quiere ver dirección el 99% de las veces.
  const season = rawSeasonId ? todas.find((s) => s.id === Number(rawSeasonId)) : enCurso
  const seasonId = season?.id

  const summary = useQuery({
    queryKey: ['functions-summary', seasonId],
    queryFn: () => api.functionsSummary(seasonId!),
    enabled: seasonId !== undefined,
  })

  // Llegó desde una alerta de Dirección apuntando a una función: se abre
  // directamente el panel de asignaciones de esa función.
  const cargadas = summary.data?.functions
  useEffect(() => {
    if (!focoId || foco.current || !cargadas) return
    const objetivo = cargadas.find((fn) => fn.id === focoId)
    if (!objetivo) return
    foco.current = true
    setPanel({ kind: 'asignar', fn: objetivo })
  }, [focoId, cargadas])

  // Cambiar la temporada en curso mueve todo lo que se calcula por temporada.
  function refrescarTemporadas() {
    setErrorTemporada(null)
    for (const key of [
      ['seasons'],
      ['seasons-overview'],
      ['settlements-report'],
      ['settlements-history'],
      ['attention'],
      ['functions-summary'],
      ['sales-timeline'],
      ['direccion'],
      ['home'],
    ]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const activar = useMutation({
    mutationFn: (id: number) => api.activateSeason(id),
    onSuccess: refrescarTemporadas,
    onError: (err) =>
      setErrorTemporada(
        err instanceof ApiError ? err.message : 'No se pudo cambiar la temporada en curso.',
      ),
  })

  const cancelar = useMutation({
    mutationFn: (id: number) => api.deleteFunction(id),
    onSuccess: () => {
      setPanel(null)
      refrescarTemporadas()
    },
    onError: (err) => {
      setPanel(null)
      setErrorTemporada(
        err instanceof ApiError ? err.message : 'No se pudo cancelar la función.',
      )
    },
  })

  if (seasons.isPending) return <p className="muted">Cargando…</p>

  // El alta de temporadas vive en el índice: acá no se duplica el formulario.
  if (todas.length === 0) {
    return (
      <>
        <PageHead title="Temporada" />
        <EmptyState icon={<CalendarDays size={20} />} title="Todavía no hay ninguna temporada">
          <Link to="/temporadas">Creá la primera</Link> para empezar a cargar funciones.
        </EmptyState>
      </>
    )
  }

  if (!season) return <p className="alert">Esa temporada no existe.</p>

  const funciones = summary.data?.functions ?? []
  const proximas = funciones.filter((fn) => !yaPaso(fn))
  const pasadas = funciones.filter(yaPaso).reverse()

  const cupo = funciones.reduce((acc, fn) => acc + fn.capacity, 0)
  const vendidas = funciones.reduce((acc, fn) => acc + fn.sold, 0)
  const recaudado = funciones.reduce((acc, fn) => acc + fn.collected_cents, 0)
  // Sólo de las próximas: repartir cupo de una función que ya pasó no arregla
  // nada, y contarlo dejaría un número en ámbar que nunca se puede bajar.
  const libres = proximas.reduce((acc, fn) => acc + sinAsignar(fn), 0)

  const primera = funciones[0]
  const ultima = funciones[funciones.length - 1]
  const sub =
    funciones.length === 0
      ? 'Todavía sin funciones'
      : `${funciones.length} ${funciones.length === 1 ? 'función' : 'funciones'}` +
        (funciones.length > 1
          ? ` · del ${dayAndMonth(primera.starts_at)} al ${dayAndMonth(ultima.starts_at)}`
          : ` · ${dayAndMonth(primera.starts_at)}`)

  const abrirAsignar = (fn: FunctionSummary) => setPanel({ kind: 'asignar', fn })

  return (
    <>
      <PageHead
        title={season.name}
        sub={sub}
        action={{ label: 'Agregar función', onClick: () => setPanel({ kind: 'funcion', modo: 'nueva' }) }}
      >
        <Menu
          trigger="pill"
          label={season.name}
          value={String(season.id)}
          groups={[
            {
              label: 'Temporadas',
              options: todas.map((s) => ({
                id: String(s.id),
                label: s.name,
                hint: s.id === enCurso?.id ? 'En curso' : 'Cerrada',
                onSelect: () => navigate(`/temporadas/${s.id}`),
              })),
            },
            {
              separated: true,
              options: [
                {
                  id: 'nueva',
                  label: 'Crear temporada…',
                  icon: <Plus size={15} />,
                  tone: 'action',
                  onSelect: () => navigate('/temporadas?nueva=1'),
                },
                {
                  id: 'todas',
                  label: 'Ver todas las temporadas',
                  icon: <LayoutList size={15} />,
                  onSelect: () => navigate('/temporadas'),
                },
              ],
            },
          ]}
        />
      </PageHead>

      {season.id !== enCurso?.id && (
        <div className="seasonbar">
          <span>
            Estás mirando una temporada que no está en curso. Inicio, Rendiciones y Dirección
            siguen mostrando <b>{enCurso?.name}</b>.
          </span>
          <button
            className="button button--sm"
            type="button"
            disabled={activar.isPending}
            onClick={() => activar.mutate(season.id)}
          >
            Usar esta temporada
          </button>
        </div>
      )}
      {errorTemporada && (
        <p className="alert" role="alert">
          {errorTemporada}
        </p>
      )}

      <div className="tstrip">
        <div>
          <b>{funciones.length}</b>
          <span>Funciones</span>
        </div>
        <div>
          <b>
            {vendidas} <small>/ {cupo}</small>
          </b>
          <span>Entradas vendidas</span>
        </div>
        <div>
          <b className="g">{formatMoney(recaudado)}</b>
          <span>Recaudado</span>
        </div>
        <div title="En las funciones que todavía no pasaron">
          <b className={libres > 0 ? 'y' : undefined}>{libres}</b>
          <span>Sin asignar</span>
        </div>
      </div>

      {summary.isPending ? (
        <p className="muted">Cargando funciones…</p>
      ) : funciones.length === 0 ? (
        <EmptyState icon={<CalendarDays size={20} />} title="Esta temporada todavía no tiene funciones">
          Agregá la primera con fecha, cupo y precio: recién ahí se le puede repartir entradas a
          las coristas.
        </EmptyState>
      ) : (
        <>
          {proximas.length > 0 && (
            <>
              <p className="sectrule">
                <b>Próximas · {proximas.length}</b>
              </p>
              <div className="fnlines">
                {proximas.map((fn, i) => (
                  <Fila
                    key={fn.id}
                    fn={fn}
                    destacada={i === 0}
                    onAsignar={() => abrirAsignar(fn)}
                    onEditar={() => setPanel({ kind: 'funcion', modo: 'editar', fn })}
                    onDuplicar={() => setPanel({ kind: 'funcion', modo: 'duplicar', fn })}
                    onCancelar={() => setPanel({ kind: 'cancelar', fn })}
                  />
                ))}
              </div>
            </>
          )}
          {pasadas.length > 0 && (
            <>
              <p className="sectrule">
                <b>Ya pasaron · {pasadas.length}</b>
              </p>
              <div className="fnlines fnlines--done">
                {pasadas.map((fn) => (
                  <Fila
                    key={fn.id}
                    fn={fn}
                    destacada={false}
                    onAsignar={() => abrirAsignar(fn)}
                    onEditar={() => setPanel({ kind: 'funcion', modo: 'editar', fn })}
                    onDuplicar={() => setPanel({ kind: 'funcion', modo: 'duplicar', fn })}
                    onCancelar={() => setPanel({ kind: 'cancelar', fn })}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {panel?.kind === 'funcion' && (
        <ActionPanel label={titulos[panel.modo]} size="form" onClose={() => setPanel(null)}>
          <FuncionForm
            modo={panel.modo}
            fn={panel.fn}
            seasonId={season.id}
            onDone={() => setPanel(null)}
          />
        </ActionPanel>
      )}

      {panel?.kind === 'asignar' && (
        <ActionPanel
          label={`Asignar entradas de ${nombre(panel.fn)}`}
          size="form"
          onClose={() => setPanel(null)}
        >
          <div className="sheet-head">
            <span>
              <b>Asignar entradas</b>
              <span>
                {nombre(panel.fn)} · {functionDay(panel.fn.starts_at)}
              </span>
            </span>
          </div>
          <AllocationsEditor fn={{ id: panel.fn.id, capacity: panel.fn.capacity }} />
        </ActionPanel>
      )}

      {panel?.kind === 'cancelar' && (
        <ActionPanel label={`Cancelar ${nombre(panel.fn)}`} onClose={() => setPanel(null)}>
          <div className="sheet-head">
            <span>
              <b>¿Cancelar {nombre(panel.fn)}?</b>
              <span>
                {functionDay(panel.fn.starts_at)} · {functionTime(panel.fn.starts_at)}
              </span>
            </span>
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: '12px 2px 0', lineHeight: 1.55 }}>
            La función se borra de la temporada junto con el cupo que tengan repartido las
            coristas. No se puede deshacer, pero como todavía no vendió nada, no hay entradas ni
            plata en juego.
          </p>
          <div className="form-row" style={{ marginTop: 14 }}>
            <button
              className="button button--danger-solid"
              type="button"
              disabled={cancelar.isPending}
              onClick={() => cancelar.mutate(panel.fn.id)}
            >
              <Trash2 size={15} aria-hidden />
              {cancelar.isPending ? 'Cancelando…' : 'Sí, cancelar la función'}
            </button>
            <button
              className="button button--ghost form-row__action"
              type="button"
              onClick={() => setPanel(null)}
            >
              No, volver
            </button>
          </div>
        </ActionPanel>
      )}
    </>
  )
}
