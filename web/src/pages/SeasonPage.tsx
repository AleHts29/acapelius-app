import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'
import type { FunctionSummary } from '../api/client'
import { RepartirModal } from '../components/RepartirModal'
import { SeasonAssignments } from '../components/SeasonAssignments'
import { DEPENDEN_DE_LA_TEMPORADA } from '../season/NuevaTemporada'
import { useSeason } from '../season/SeasonProvider'
import {
  centavosAMonto,
  escribirMonto,
  calendarDaysUntil,
  dayAndMonthShort,
  dayLabel,
  formatMoney,
  functionDay,
  functionTime,
  isoToLocalInput,
  localInputToISO,
  pesosToCents,
  weekdayLong,
  funcionTerminada,
} from '../lib/format'
import { Button, Seg } from '../ui/Button'
import { Card } from '../ui/Card'
import { DataList } from '../ui/DataList'
import { Figure, SubFigs } from '../ui/Figure'
import { Label } from '../ui/Label'
import { Menu } from '../ui/Menu'
import { Modal } from '../ui/Modal'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'
import { Status } from '../ui/Status'
import { Entrada, TalonCifra } from '../ui/Entrada'

// Temporada (C19 §5.5, design/acapelius-B-entidades.html §04). Una función es
// una ENTIDAD: tarjeta con la fecha en Anton, y el detalle en el popup. El
// formulario de función (crear, editar, duplicar) no cambia.

/** La misma gracia que usa Inicio: a las 21:00 la función de las 20:00 no "pasó". */

function nombre(fn: FunctionSummary): string {
  return fn.name && fn.name !== '' ? fn.name : fn.venue
}

function yaPaso(fn: FunctionSummary): boolean {
  return funcionTerminada(fn.starts_at)
}

/** Con ingresos registrados el server ya no acepta editarla (spec §5.1). */
function congelada(fn: FunctionSummary): boolean {
  return fn.entered > 0
}

function sinAsignar(fn: FunctionSummary): number {
  return Math.max(fn.capacity - fn.assigned, 0)
}

/** "hoy" / "mañana" / "en 4 días". */
function cuandoFalta(iso: string): string {
  const dias = calendarDaysUntil(iso)
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'mañana'
  return `en ${dias} días`
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
    pricePesos: centavosAMonto(fn.price_cents),
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
    return { ok: false, message: 'El precio no es válido. Ejemplo: 8.000 o 8.000,50.' }
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
    // El selector y Temporadas cuentan funciones: sin esto decían "0 funciones".
    void queryClient.invalidateQueries({ queryKey: ['seasons-overview'] })
    onDone()
  }

  const fallo = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'No se pudo guardar la función.')

  const crear = useMutation({
    meta: { exito: 'Función creada' },
    mutationFn: (input: Parameters<typeof api.createFunction>[0]) => api.createFunction(input),
    onSuccess: refrescar,
    onError: fallo,
  })
  const editar = useMutation({
    meta: { exito: 'Función guardada' },
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
    <Modal
      open
      onClose={onDone}
      label="Función"
      title={titulos[modo]}
      sub={
        fn && modo !== 'nueva'
          ? `${nombre(fn)}${modo === 'editar' && fn.sold > 0 ? ` · ${fn.sold} entradas vendidas` : ''}`
          : 'Fecha, lugar, cupo y precio'
      }
      footer={
        <>
          <Button onClick={onDone}>Cancelar</Button>
          <Button go type="submit" form="funcion-form" disabled={guardando}>
            {guardando ? 'Guardando…' : modo === 'editar' ? 'Guardar cambios' : 'Crear función'}
          </Button>
        </>
      }
    >
      <form id="funcion-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          <span className="lbl">Nombre</span>
          <input className="field__input" type="text" autoFocus value={values.name} onChange={(e) => set({ name: e.target.value })} placeholder="Función de gala" />
        </label>
        <label className="field">
          <span className="lbl">Lugar</span>
          <input className="field__input" type="text" value={values.venue} onChange={(e) => set({ venue: e.target.value })} placeholder="Teatro Municipal" />
        </label>
        <label className="field">
          <span className="lbl">Fecha y hora</span>
          <input className="field__input" type="datetime-local" value={values.startsAtLocal} onChange={(e) => set({ startsAtLocal: e.target.value })} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span className="lbl">Cupo</span>
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
            <span className="lbl">Precio ($)</span>
            <input
              className="field__input"
              type="text"
              inputMode="decimal"
              disabled={precioTrabado}
              value={values.pricePesos}
              onChange={(e) => set({ pricePesos: escribirMonto(e.target.value) })}
              placeholder="8.000"
            />
          </label>
        </div>

        {precioTrabado && fn && (
          <div className="banner" style={{ margin: 0 }}>
            <span>
              Ya se vendieron {fn.sold} entradas a {formatMoney(fn.price_cents)}. Esas ventas guardan su
              propio importe y no cambian, pero de acá en adelante la misma función tendría dos precios.
            </span>
            <button type="button" className="card__a" onClick={() => setPrecioTrabado(false)}>
              Cambiar el precio igual
            </button>
          </div>
        )}
      </form>
    </Modal>
  )
}

// --- La tarjeta de función ------------------------------------------------------

function FuncionTile({
  fn,
  proxima,
  onClick,
  onEditar,
  onEliminar,
}: {
  fn: FunctionSummary
  /** La que viene: va en naranja. */
  proxima?: boolean
  onClick: () => void
  onEditar: () => void
  onEliminar: () => void
}) {
  const pasada = yaPaso(fn)
  const libres = sinAsignar(fn)
  const agotada = fn.sold >= fn.capacity
  const dia = weekdayLong(fn.starts_at)
  const label = pasada ? dia : `${dia} · ${cuandoFalta(fn.starts_at)}`
  const pctEntro = fn.sold > 0 ? Math.round((fn.entered / fn.sold) * 100) : 0
  // Sólo lo que se puede hacer: el popup de la función explica por qué no.
  // Una función que ya pasó es historia: no se edita ni se borra.
  const editable = !pasada && !congelada(fn)
  const eliminable = !pasada && fn.sold === 0
  const conAcciones = editable || eliminable

  const estadoReparto = pasada ? (
    <>
      <Status tone={fn.entered > 0 ? 'ok' : 'mute'}>{fn.entered} entraron</Status>
      {!conAcciones && <span className="rs">{pctEntro}%</span>}
    </>
  ) : fn.assigned === 0 ? (
    <Status tone="mute">Sin repartir</Status>
  ) : libres > 0 ? (
    <Status tone="warn">{libres} sin repartir</Status>
  ) : (
    <Status tone="ok">Repartida</Status>
  )

  return (
    <div className="fn-con">
    <Entrada
      tono={proxima ? 'ticket' : 'papel'}
      apagada={pasada}
      label={label}
      nombre={fn.name ?? fn.venue}
      datos={`${dayAndMonthShort(fn.starts_at)} · ${functionTime(fn.starts_at)}${fn.name ? ` · ${fn.venue}` : ''}`}
      talon={
        <>
          <TalonCifra
            label={formatMoney(fn.collected_cents)}
            valor={!pasada && agotada ? 'AGOTADA' : `${fn.sold} de ${fn.capacity}`}
            barra={{ value: fn.sold, max: fn.capacity }}
          />
          <div className="tile__f">{estadoReparto}</div>
        </>
      }
      onClick={onClick}
    />
    {/* Van afuera de la tarjeta: es un botón y no puede tener botones adentro. */}
    {conAcciones && (
      <div className="fn-con__a">
        {editable && (
          <Button aria-label={`Editar ${nombre(fn)}`} onClick={onEditar}>
            Editar
          </Button>
        )}
        {eliminable && (
          <Button className="btn--bad" aria-label={`Eliminar ${nombre(fn)}`} onClick={onEliminar}>
            Eliminar
          </Button>
        )}
      </div>
    )}
    </div>
  )
}

// --- El nombre de la temporada -------------------------------------------------

/**
 * El título de la página se edita en el lugar: se escribe encima y se guarda al
 * salir o con Enter. Esc vuelve al nombre anterior. Sólo se ofrece mientras la
 * temporada no tiene cupos ni ventas.
 */
function TituloEditable({ id, nombre }: { id: number; nombre: string }) {
  const queryClient = useQueryClient()
  const [valor, setValor] = useState(nombre)
  const [error, setError] = useState<string | null>(null)
  const [guardado, setGuardado] = useState(false)
  // Esc también dispara el blur: esto evita que guarde lo que se está descartando.
  const descartar = useRef(false)

  const guardar = useMutation({
    meta: { exito: 'Nombre guardado' },
    mutationFn: (nuevo: string) => api.updateSeason(id, nuevo),
    onSuccess: () => {
      setError(null)
      setGuardado(true)
      for (const key of DEPENDEN_DE_LA_TEMPORADA) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
    onError: (err) => {
      setValor(nombre)
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar el nombre.')
    },
  })

  function alSalir() {
    const nuevo = valor.trim()
    if (descartar.current || nuevo === '') {
      descartar.current = false
      setValor(nombre)
      return
    }
    setValor(nuevo)
    if (nuevo !== nombre) guardar.mutate(nuevo)
  }

  return (
    <>
      <input
        className="pgt-edit"
        type="text"
        aria-label="Nombre de la temporada"
        value={valor}
        onChange={(e) => {
          setValor(e.target.value)
          setGuardado(false)
          setError(null)
        }}
        onBlur={alSalir}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            // Esc no cierra nada acá: sólo descarta lo escrito.
            e.stopPropagation()
            descartar.current = true
            e.currentTarget.blur()
          }
        }}
      />
      <span className="pgt-edit__s" role={error ? 'alert' : 'status'}>
        {error ?? (guardar.isPending ? 'Guardando…' : guardado ? 'Nombre guardado' : '')}
      </span>
    </>
  )
}

// --- El popup de una función -------------------------------------------------

function FuncionModal({
  fn,
  seasonName,
  onClose,
  onEditar,
  onDuplicar,
  onCancelar,
  onRepartir,
}: {
  fn: FunctionSummary
  seasonName: string
  onClose: () => void
  onEditar: () => void
  onDuplicar: () => void
  onCancelar: () => void
  onRepartir: () => void
}) {
  const navigate = useNavigate()
  const pasada = yaPaso(fn)
  const trabada = pasada || congelada(fn)
  const libres = sinAsignar(fn)

  const tablero = useQuery({
    queryKey: ['function-allocations', fn.id],
    queryFn: () => api.functionAllocations(fn.id),
  })
  const ventas = useQuery({
    queryKey: ['sales', 'fn-summary', fn.id],
    queryFn: () => api.listSales({ functionId: fn.id }),
  })
  const anuladas = useQuery({
    queryKey: ['sales', 'fn-void', fn.id],
    queryFn: () => api.listSales({ functionId: fn.id, status: 'void' }),
  })
  const conCupo = (tablero.data?.allocations ?? []).filter((a) => a.assigned > 0)

  return (
    <Modal
      open
      onClose={onClose}
      label={`Función · ${seasonName}`}
      title={`${dayLabel(fn.starts_at)} · ${functionTime(fn.starts_at)}`}
      sub={`${fn.name ? `${fn.name} · ` : ''}${fn.venue}${pasada ? '' : ` · ${cuandoFalta(fn.starts_at)}`}`}
      footer={
        <>
          {!trabada && <Button onClick={onEditar}>Editar</Button>}
          <Button onClick={() => navigate(`/ventas?fn=${fn.id}`)}>Ver ventas</Button>
          {pasada ? (
            <Button go onClick={() => navigate(`/panel/asistencia?fn=${fn.id}`)}>
              Ver asistencia
            </Button>
          ) : (
            <Button go onClick={onRepartir}>
              {libres > 0 ? `Repartir las ${libres}` : 'Cambiar el reparto'}
            </Button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', gap: 'var(--s6)', flexWrap: 'wrap' }}>
        <Figure label="Vendidas" unit={`/ ${fn.capacity}`}>
          {fn.sold}
        </Figure>
        <Figure ojo label="Recaudado" tone="ok">
          {formatMoney(fn.collected_cents)}
        </Figure>
      </div>

      <div>
        <Label>Cupos por corista</Label>
        <div className="mini" style={{ marginTop: 7 }}>
          {tablero.isPending && <Row title="Cargando…" />}
          {conCupo.map((a) => (
            <Row
              key={a.user_id}
              title={a.seller_name}
              sub={
                <div className="tile__bar" aria-hidden>
                  <i style={{ width: `${Math.min(100, (a.sold / a.assigned) * 100)}%` }} />
                </div>
              }
              amount={`${a.sold} / ${a.assigned}`}
            />
          ))}
          {!pasada && libres > 0 && <Row title="Sin repartir" sub="nadie las puede vender" amount={String(libres)} warn />}
        </div>
      </div>

      <DataList
        rows={[
          ['Capacidad', `${fn.capacity} lugares`],
          ['Precio', formatMoney(fn.price_cents)],
          ...(ventas.data
            ? ([['Cortesías', `${ventas.data.summary.comp_tickets} usadas`]] as Array<[string, string]>)
            : []),
          ...(anuladas.data
            ? ([['Anuladas', String(anuladas.data.filtered.total_count)]] as Array<[string, string]>)
            : []),
        ]}
      />

      <div>
        <Label>Más</Label>
        <div className="mini" style={{ marginTop: 7 }}>
          <Row title="Duplicar" sub="Mismo lugar, cupo y precio, con otra fecha" onClick={onDuplicar} />
          {!pasada && <Row title="Ver asistencia" onClick={() => navigate(`/panel/asistencia?fn=${fn.id}`)} />}
          {pasada ? null : fn.sold > 0 ? (
            <Row title="Eliminar función" sub={`Ya vendió ${fn.sold}: primero hay que resolver los reembolsos`} dim />
          ) : (
            <Row title="Eliminar función" sub="Se borra con su cupo repartido" onClick={onCancelar} />
          )}
        </div>
        {trabada && (
          <p className="rs" style={{ whiteSpace: 'normal', margin: 'var(--s1) 0 0' }}>
            {pasada
              ? 'Ya pasó: queda como historial, no se edita ni se elimina.'
              : `Ya tiene ${fn.entered} ingresos en la puerta: la fecha, el lugar y el cupo no se editan.`}
          </p>
        )}
      </div>
    </Modal>
  )
}

// --- Pantalla ----------------------------------------------------------------

type Panel =
  | { kind: 'funcion'; modo: Modo; fn?: FunctionSummary }
  | { kind: 'ver'; fn: FunctionSummary }
  | { kind: 'asignar'; fn: FunctionSummary }
  | { kind: 'cancelar'; fn: FunctionSummary }
  | { kind: 'eliminar-temporada' }
  | null

type Vista = 'funciones' | 'asignaciones'

export function SeasonPage() {
  const { seasonId: rawSeasonId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // ?fn=N llega de las alertas de Dirección: esa función abre el reparto.
  const [searchParams, setSearchParams] = useSearchParams()
  const focoId = Number(searchParams.get('fn')) || undefined
  // La pestaña queda en la URL: recargar o compartir no te saca de Asignaciones.
  const vista: Vista = searchParams.get('vista') === 'asignaciones' ? 'asignaciones' : 'funciones'
  function cambiarVista(nueva: Vista) {
    const next = new URLSearchParams(searchParams)
    if (nueva === 'asignaciones') next.set('vista', nueva)
    else next.delete('vista')
    setSearchParams(next, { replace: true })
  }
  const [panel, setPanel] = useState<Panel>(null)
  // Una sola vez: si no, cerrar el panel que abrió la alerta lo volvería a abrir.
  const foco = useRef(false)
  const [errorTemporada, setErrorTemporada] = useState<string | null>(null)

  // La temporada la manda el selector global (C16). La ruta vieja
  // /temporadas/:id sigue andando: al entrar, alinea el selector.
  const { seasons: todas, season, current: enCurso, elegir, loading } = useSeason()
  const seasonId = season?.id
  const dePath = Number(rawSeasonId) || undefined
  useEffect(() => {
    if (dePath !== undefined && dePath !== seasonId && todas.some((s) => s.id === dePath)) {
      elegir(dePath)
    }
  }, [dePath, seasonId, todas, elegir])

  const summary = useQuery({
    queryKey: ['functions-summary', seasonId],
    queryFn: () => api.functionsSummary(seasonId!),
    enabled: seasonId !== undefined,
  })

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
    meta: { exito: 'Temporada en uso' },
    mutationFn: (id: number) => api.activateSeason(id),
    onSuccess: refrescarTemporadas,
    onError: (err) =>
      setErrorTemporada(
        err instanceof ApiError ? err.message : 'No se pudo cambiar la temporada en curso.',
      ),
  })

  const cancelar = useMutation({
    meta: { exito: 'Función eliminada' },
    mutationFn: (id: number) => api.deleteFunction(id),
    onSuccess: () => {
      setPanel(null)
      refrescarTemporadas()
    },
    onError: (err) => {
      setPanel(null)
      setErrorTemporada(
        err instanceof ApiError ? err.message : 'No se pudo eliminar la función.',
      )
    },
  })

  const eliminarTemporada = useMutation({
    meta: { exito: 'Temporada eliminada' },
    mutationFn: (id: number) => api.deleteSeason(id),
    onSuccess: () => {
      for (const key of DEPENDEN_DE_LA_TEMPORADA) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
      navigate('/temporadas')
    },
    onError: (err) => {
      setPanel(null)
      setErrorTemporada(err instanceof ApiError ? err.message : 'No se pudo eliminar la temporada.')
    },
  })

  if (loading) return <p className="rs">Cargando…</p>

  // El alta de temporadas vive en el índice: acá no se duplica el formulario.
  if (todas.length === 0) {
    return (
      <>
        <PageHeader title="Temporada" />
        <Card title="Todavía no hay ninguna temporada">
          <p className="rs" style={{ padding: '0 0 var(--s3)', whiteSpace: 'normal', margin: 0 }}>
            <Link to="/temporadas">Creá la primera</Link> para empezar a cargar funciones.
          </p>
        </Card>
      </>
    )
  }

  if (!season) return <p className="st st--bad">Esa temporada no existe.</p>

  const funciones = summary.data?.functions ?? []
  const proximas = funciones.filter((fn) => !yaPaso(fn))
  const pasadas = funciones.filter(yaPaso).reverse()

  const cupo = funciones.reduce((acc, fn) => acc + fn.capacity, 0)
  const vendidas = funciones.reduce((acc, fn) => acc + fn.sold, 0)
  const potencial = funciones.reduce((acc, fn) => acc + fn.capacity * fn.price_cents, 0)
  const precios = [...new Set(funciones.map((fn) => fn.price_cents))].sort((x, y) => x - y)
  const ingresos = pasadas.reduce((acc, fn) => acc + fn.entered, 0)
  const anio = funciones[0]
    ? new Date(funciones[0].starts_at).getFullYear()
    : (/\b(20\d\d)\b/.exec(season.name)?.[1] ?? new Date(season.created_at).getFullYear())
  const repartidas = funciones.reduce((acc, fn) => acc + fn.assigned, 0)
  // Sin cupos ni ventas todavía es un borrador: se renombra y se elimina. El
  // server revisa además rendiciones y ventas anuladas, y responde el motivo.
  const esBorrador = summary.data !== undefined && vendidas === 0 && repartidas === 0
  const esEnCurso = season.id === enCurso?.id
  // Si se borra la en curso, pasa a estar en curso la más nueva de las otras
  // (el server elige igual). Sin otra no se borra: dirección quedaría sin rol.
  const queda = esEnCurso ? todas.find((s) => s.id !== season.id) : undefined
  const eliminable = esBorrador && (!esEnCurso || queda !== undefined)
  const queSeBorra =
    funciones.length === 0
      ? 'su equipo'
      : funciones.length === 1
        ? 'su función y su equipo'
        : `sus ${funciones.length} funciones y su equipo`

  return (
    <>
      <PageHeader
        eyebrow={`Temporadas · ${anio}`}
        title={<TituloEditable key={`${season.id}:${season.name}`} id={season.id} nombre={season.name} />}
        actions={
          <>
            {eliminable && (
              <Button onClick={() => setPanel({ kind: 'eliminar-temporada' })}>Eliminar temporada</Button>
            )}
            <Menu
              trigger="btn"
              label="Cambiar temporada"
              ariaLabel="Cambiar temporada"
              align="right"
              groups={[
                {
                  label: 'Temporadas',
                  options: todas.map((s) => ({
                    id: String(s.id),
                    label: s.name,
                    hint: s.id === enCurso?.id ? 'En curso' : undefined,
                    onSelect: () => elegir(s.id),
                  })),
                },
                {
                  separated: true,
                  options: [
                    { id: 'todas', label: 'Ver todas las temporadas', onSelect: () => navigate('/temporadas') },
                  ],
                },
              ]}
            />
            <Button go onClick={() => setPanel({ kind: 'funcion', modo: 'nueva' })}>
              Nueva función
            </Button>
          </>
        }
      />

      {!esEnCurso && (
        <div className="banner">
          <span>
            Estás mirando una temporada que no está en curso. Inicio, Rendiciones y Dirección
            siguen mostrando <b>{enCurso?.name}</b>.
          </span>
          <Button disabled={activar.isPending} onClick={() => activar.mutate(season.id)}>
            Usar esta temporada
          </Button>
        </div>
      )}
      {errorTemporada && (
        <p className="st st--bad" role="alert">
          {errorTemporada}
        </p>
      )}

      <div style={{ marginBottom: 'var(--s4)' }}>
        <Seg<Vista>
          label="Qué mirar de la temporada"
          options={[
            { value: 'funciones', label: 'Funciones' },
            { value: 'asignaciones', label: 'Asignaciones' },
          ]}
          value={vista}
          onChange={cambiarVista}
        />
      </div>

      {/* Asignaciones queda montada y oculta: pasar a Funciones no borra un reparto sin guardar. */}
      <div hidden={vista !== 'asignaciones'}>
        {funciones.length > 0 ? (
          <SeasonAssignments key={season.id} funciones={funciones} />
        ) : (
          !summary.isPending && (
            <Card title="Esta temporada todavía no tiene funciones">
              <p className="rs" style={{ padding: '0 0 var(--s3)', whiteSpace: 'normal', margin: 0 }}>
                Cuando cargues una función, acá vas a poder repartirle las entradas a las coristas.
              </p>
            </Card>
          )
        )}
      </div>

      <div hidden={vista !== 'funciones'}>
      {funciones.length > 0 && (
        <div style={{ marginBottom: 'var(--s5)' }}>
          <SubFigs
            items={[
              { label: 'Funciones', value: funciones.length },
              { label: 'Vendidas', value: vendidas, unit: `/ ${cupo}` },
              {
                label: 'Precio',
                value:
                  precios.length === 1
                    ? formatMoney(precios[0])
                    : `${formatMoney(precios[0])} a ${formatMoney(precios[precios.length - 1])}`,
              },
              { label: 'Si se vende todo', value: formatMoney(potencial), tone: 'ok' },
            ]}
          />
        </div>
      )}

      {summary.isPending ? (
        <p className="rs">Cargando funciones…</p>
      ) : funciones.length === 0 ? (
        <Card title="Esta temporada todavía no tiene funciones">
          <p className="rs" style={{ padding: '0 0 var(--s3)', whiteSpace: 'normal', margin: 0 }}>
            Agregá la primera con fecha, cupo y precio: recién ahí se le puede repartir entradas a
            las coristas.
          </p>
        </Card>
      ) : (
        <>
          {proximas.length > 0 && (
            <section className="grp">
              <div className="grp__h">
                <h2 className="lbl">Vienen</h2>
                <span className="grp__n">
                  {proximas.length} {proximas.length === 1 ? 'función' : 'funciones'} ·{' '}
                  {proximas.reduce((acc, fn) => acc + fn.capacity, 0)} lugares
                </span>
              </div>
              <div className="tiles tiles--3">
                {proximas.map((fn, i) => (
                  <FuncionTile
                    key={fn.id}
                    fn={fn}
                    proxima={i === 0}
                    onClick={() => setPanel({ kind: 'ver', fn })}
                    onEditar={() => setPanel({ kind: 'funcion', modo: 'editar', fn })}
                    onEliminar={() => setPanel({ kind: 'cancelar', fn })}
                  />
                ))}
              </div>
            </section>
          )}
          {pasadas.length > 0 && (
            <section className="grp">
              <div className="grp__h">
                <h2 className="lbl">Ya pasaron</h2>
                <span className="grp__n">
                  {pasadas.length} {pasadas.length === 1 ? 'función' : 'funciones'} · {ingresos} ingresos
                </span>
              </div>
              <div className="tiles tiles--3">
                {pasadas.map((fn) => (
                  <FuncionTile
                    key={fn.id}
                    fn={fn}
                    onClick={() => setPanel({ kind: 'ver', fn })}
                    onEditar={() => setPanel({ kind: 'funcion', modo: 'editar', fn })}
                    onEliminar={() => setPanel({ kind: 'cancelar', fn })}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      </div>

      {summary.data && !esBorrador && vendidas === 0 && (
        <p className="rs" style={{ whiteSpace: 'normal', margin: 0 }}>
          Tiene {repartidas} {repartidas === 1 ? 'entrada repartida' : 'entradas repartidas'}: mientras tanto, la
          temporada no se puede eliminar.
        </p>
      )}
      {esBorrador && !eliminable && (
        <p className="rs" style={{ whiteSpace: 'normal', margin: 0 }}>
          Es la única temporada: no se puede eliminar.
        </p>
      )}

      {panel?.kind === 'ver' && (
        <FuncionModal
          fn={panel.fn}
          seasonName={season.name}
          onClose={() => setPanel(null)}
          onEditar={() => setPanel({ kind: 'funcion', modo: 'editar', fn: panel.fn })}
          onDuplicar={() => setPanel({ kind: 'funcion', modo: 'duplicar', fn: panel.fn })}
          onCancelar={() => setPanel({ kind: 'cancelar', fn: panel.fn })}
          onRepartir={() => setPanel({ kind: 'asignar', fn: panel.fn })}
        />
      )}

      {panel?.kind === 'funcion' && (
        <FuncionForm modo={panel.modo} fn={panel.fn} seasonId={season.id} onDone={() => setPanel(null)} />
      )}

      {panel?.kind === 'asignar' && (
        <RepartirModal funciones={funciones} inicial={panel.fn} onClose={() => setPanel(null)} />
      )}

      {panel?.kind === 'eliminar-temporada' && (
        <Modal
          open
          onClose={() => setPanel(null)}
          label="Eliminar temporada"
          title={`¿Eliminar ${season.name}?`}
          sub={`También se borra ${queSeBorra}`}
          footer={
            <>
              <Button onClick={() => setPanel(null)}>No, volver</Button>
              <Button
                className="btn--bad"
                disabled={eliminarTemporada.isPending}
                onClick={() => eliminarTemporada.mutate(season.id)}
              >
                {eliminarTemporada.isPending ? 'Eliminando…' : 'Sí, eliminarla'}
              </Button>
            </>
          }
        >
          <p className="note">
            No se puede deshacer, pero como todavía no tiene cupos ni ventas, no hay entradas ni plata en juego.
            {queda && ` ${queda.name} pasa a ser la temporada en curso.`}
          </p>
        </Modal>
      )}

      {panel?.kind === 'cancelar' && (
        <Modal
          open
          onClose={() => setPanel(null)}
          label="Eliminar función"
          title={`¿Eliminar ${nombre(panel.fn)}?`}
          sub={`${functionDay(panel.fn.starts_at)} · ${functionTime(panel.fn.starts_at)}`}
          footer={
            <>
              <Button onClick={() => setPanel(null)}>No, volver</Button>
              <Button className="btn--bad" disabled={cancelar.isPending} onClick={() => cancelar.mutate(panel.fn.id)}>
                {cancelar.isPending ? 'Eliminando…' : 'Sí, eliminarla'}
              </Button>
            </>
          }
        >
          <p className="note">
            La función se borra de la temporada junto con el cupo que tengan repartido las coristas. No se
            puede deshacer, pero como todavía no vendió nada, no hay entradas ni plata en juego.
          </p>
        </Modal>
      )}
    </>
  )
}
