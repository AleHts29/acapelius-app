import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { AttendanceReport, AttendanceSale } from '../api/client'
import { dayLabel, functionTime } from '../lib/format'
import { porMinuto, ritmo } from '../lib/rhythm'
import { normalizeText } from '../lib/search'
import { useIsDesktop } from '../lib/viewport'
import { Button, Search } from '../ui/Button'
import { Card } from '../ui/Card'
import { DataList } from '../ui/DataList'
import { Entrada } from '../ui/Entrada'
import { Heel } from '../ui/Heel'
import { PageHeader } from '../ui/Page'
import { Rhythm } from '../ui/Rhythm'
import { Row } from '../ui/Row'
import { Modal } from '../ui/Modal'
import { Sheet } from '../ui/Sheet'
import { Status } from '../ui/Status'

// Asistencia (C19 §5.3, design/acapelius-B-entidades.html §02). Es una
// pantalla en vivo: el talón cuenta quién entró y a qué ritmo, a la derecha
// están los que faltan, y abajo el registro de la puerta, la hora primero.

const MIN = 60_000
/** Ventana del ritmo: una hora antes y una después de la función. */
const ANTES = 60 * MIN
const DESPUES = 60 * MIN

const hora = (d: Date | string) =>
  new Date(d).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  })

const entradas = (n: number) => `${n} ${n === 1 ? 'entrada' : 'entradas'}`
const primerNombre = (nombre: string) => nombre.trim().split(/\s+/)[0] ?? nombre

/** Un renglón del registro: las entradas de una compra que entraron juntas. */
interface Ingreso {
  key: string
  at: string
  sale: AttendanceSale
  cantidad: number
}

/**
 * El registro de la puerta. Las entradas de una misma compra que entraron en
 * el mismo minuto, con la misma persona en la puerta, son un solo renglón:
 * "2 entradas", no dos filas iguales.
 */
function registro(data: AttendanceReport): Ingreso[] {
  const grupos = new Map<string, Ingreso>()
  for (const sale of data.sales) {
    for (const t of sale.tickets) {
      if (!t.checkin) continue
      const key = `${sale.sale_id}·${t.checkin.at.slice(0, 16)}·${t.checkin.by_name}`
      const g = grupos.get(key)
      if (g) g.cantidad++
      else grupos.set(key, { key, at: t.checkin.at, sale, cantidad: 1 })
    }
  }
  return [...grupos.values()].sort((a, b) => b.at.localeCompare(a.at))
}

/** Sin elección, la función más cercana a ahora: la de hoy o la de anoche. */
function masCercana<T extends { id: number; starts_at: string }>(fns: T[]): T | undefined {
  return [...fns].sort(
    (a, b) =>
      Math.abs(new Date(a.starts_at).getTime() - Date.now()) -
      Math.abs(new Date(b.starts_at).getTime() - Date.now()),
  )[0]
}

// --- El detalle de una compra: entrada por entrada ---------------------------

function DetalleCompra({ sale, onClose }: { sale: AttendanceSale; onClose: () => void }) {
  const escritorio = useIsDesktop()
  const filas: Array<[string, string]> = sale.tickets.map((t, i) => [
    `Entrada ${i + 1}`,
    t.checkin
      ? `${hora(t.checkin.at)} · ${t.checkin.method === 'scan' ? 'QR escaneado por' : 'marcada a mano por'} ${t.checkin.by_name}`
      : 'Todavía no entró',
  ])
  const sub = `${sale.is_comp ? 'Cortesía de' : 'Le vendió'} ${sale.seller_name}`
  const estado =
    sale.entered >= sale.total ? (
      <Status tone="ok">{sale.total === 1 ? 'Entró' : `Entraron las ${sale.total}`}</Status>
    ) : sale.entered > 0 ? (
      <Status tone="warn">
        Entraron {sale.entered} de {sale.total} · {sale.total - sale.entered === 1 ? 'falta 1' : `faltan ${sale.total - sale.entered}`}
      </Status>
    ) : (
      <Status tone="mute">{sale.total === 1 ? 'Todavía no entró' : 'Todavía no entró nadie'}</Status>
    )
  return escritorio ? (
    <Modal open onClose={onClose} label="Entradas de esta compra" title={sale.buyer_name} sub={sub}>
      {estado}
      <DataList rows={filas} />
    </Modal>
  ) : (
    <Sheet open onClose={onClose} title={sale.buyer_name} sub={sub} status={estado}>
      <DataList rows={filas} />
    </Sheet>
  )
}

// --- Pantalla ----------------------------------------------------------------

export function AttendancePage() {
  const navigate = useNavigate()
  // ?fn=N llega del popup de una función en Temporadas.
  const [searchParams, setSearchParams] = useSearchParams()
  const fnDeURL = Number(searchParams.get('fn')) || undefined
  const [q, setQ] = useState('')
  const [todosFaltan, setTodosFaltan] = useState(false)
  const [todoElRegistro, setTodoElRegistro] = useState(false)
  const [abierta, setAbierta] = useState<AttendanceSale | null>(null)

  const functions = useQuery({ queryKey: ['functions'], queryFn: () => api.listFunctions() })
  const lista = functions.data?.functions ?? []
  const elegida = lista.find((fn) => fn.id === fnDeURL) ?? masCercana(lista)

  const report = useQuery({
    queryKey: ['attendance', elegida?.id],
    queryFn: () => api.attendanceReport(elegida!.id),
    enabled: elegida !== undefined,
    // Al cambiar de función queda lo anterior hasta que llega lo nuevo: la
    // pantalla no se vacía bajo el dedo.
    placeholderData: keepPreviousData,
    // "En tiempo real" con polling alcanza (spec §11: sin websockets).
    refetchInterval: 15_000,
  })
  const data = report.data

  if (functions.isPending || (elegida && report.isPending)) return <p className="rs">Cargando…</p>
  if (!elegida || !data) {
    return (
      <>
        <PageHeader title="Asistencia" />
        <Card title="No hay funciones cargadas" />
      </>
    )
  }

  const ahora = new Date()
  const inicio = new Date(data.function.starts_at)
  const desde = new Date(inicio.getTime() - ANTES)
  const hasta = new Date(inicio.getTime() + DESPUES)
  const enVivo = ahora >= desde && ahora <= hasta

  const checkins = data.sales.flatMap((s) => s.tickets.flatMap((t) => (t.checkin ? [t.checkin.at] : [])))
  const r = ritmo(checkins, desde, hasta, ahora)
  const mitad = new Date((desde.getTime() + hasta.getTime()) / 2)
  const ejes = [
    hora(desde),
    hora(mitad),
    enVivo ? `Ahora ${hora(ahora)}` : hora(new Date(mitad.getTime() + (hasta.getTime() - mitad.getTime()) / 2)),
    hora(hasta),
  ]

  const faltanEntradas = Math.max(data.issued - data.entered, 0)
  const comps = data.sales.filter((s) => s.is_comp)
  const compsTotal = comps.reduce((acc, s) => acc + s.total, 0)
  const compsUsadas = comps.reduce((acc, s) => acc + s.entered, 0)

  const nq = normalizeText(q)
  const coincide = (s: AttendanceSale) =>
    nq === '' || normalizeText(s.buyer_name).includes(nq) || normalizeText(s.seller_name).includes(nq)
  const faltan = data.sales
    .filter((s) => s.entered < s.total && coincide(s))
    .sort((a, b) => a.buyer_name.localeCompare(b.buyer_name, 'es'))
  const ingresos = registro(data).filter((i) => coincide(i.sale))

  const verFaltan = todosFaltan || nq !== '' ? faltan : faltan.slice(0, 3)
  const verIngresos = todoElRegistro || nq !== '' ? ingresos : ingresos.slice(0, 6)

  const elegir = (id: number) => {
    setSearchParams({ fn: String(id) }, { replace: true })
    setAbierta(null)
  }

  return (
    <>
      <PageHeader
        title="Asistencia"
        label={`${dayLabel(data.function.starts_at)} · ${functionTime(data.function.starts_at)} · ${data.function.venue}`}
        actions={
          enVivo ? <Status tone="ok">En vivo</Status> : <Status tone="mute">Fuera de horario</Status>
        }
      />

      {/* Las funciones a la vista, como en Ventas: en un desplegable pasaban
          desapercibidas. */}
      <div className={lista.length > 1 ? 'asist__top' : 'asist__panel'}>
        {lista.length > 1 && (
          <div className="entradas entradas--v">
            {lista.map((fn) =>
              fn.id === elegida.id ? (
                <Entrada
                  key={fn.id}
                  chica
                  tono="ticket"
                  label={`${dayLabel(fn.starts_at)} · ${functionTime(fn.starts_at)}`}
                  nombre={`${fn.entered}/${fn.sold}`}
                  talon={`entraron · ${fn.name ?? fn.venue}`}
                />
              ) : (
                <Entrada
                  key={fn.id}
                  chica
                  label={dayLabel(fn.starts_at)}
                  nombre={`${fn.entered}/${fn.sold}`}
                  talon={fn.name ?? fn.venue}
                  onClick={() => elegir(fn.id)}
                />
              ),
            )}
          </div>
        )}

          <Heel>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--s3)' }}>
              <div aria-live="polite">
                <span className="lbl">Ingresaron</span>
                <div className="heel__n" style={{ marginTop: 6 }}>
                  {data.entered} <span>de {data.issued}</span>
                </div>
              </div>
              {enVivo && (
                <div style={{ textAlign: 'right' }}>
                  <span className="lbl">Entrando ahora</span>
                  <div className="heel__rate" style={{ marginTop: 6 }}>
                    {porMinuto(checkins, ahora)} / min
                  </div>
                </div>
              )}
            </div>

            <Rhythm
              tramos={r.tramos}
              ahora={r.ahora}
              ejes={ejes}
              label={
                r.pico
                  ? `Ingresos cada 10 minutos. El pico fue a las ${hora(r.pico.desde)}, con ${r.pico.cantidad}.`
                  : 'Ingresos cada 10 minutos. Todavía no entró nadie.'
              }
            />

            <div className="heel__foot">
              <div>
                <span className="lbl">Pico</span>
                <b>{r.pico ? `${hora(r.pico.desde)} · ${r.pico.cantidad} personas` : '—'}</b>
              </div>
              <div>
                <span className="lbl">Faltan</span>
                <b className={faltanEntradas > 0 ? 'warn' : undefined}>
                  {faltanEntradas} {faltanEntradas === 1 ? 'persona' : 'personas'}
                </b>
              </div>
              {compsTotal > 0 && (
                <div>
                  <span className="lbl">Cortesías</span>
                  <b>
                    {compsUsadas} de {compsTotal}
                  </b>
                </div>
              )}
            </div>
          </Heel>

      </div>

      {/* El buscador va arriba de las dos listas, a lo ancho, porque filtra las
          dos: al escribir se ve quién falta y quién ya entró, lado a lado. */}
      <div className="asist__buscar">
        <Search
          aria-label="Buscar comprador o corista en las dos listas"
          placeholder="Buscar por comprador o corista"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="cols cols--2">
        <section className="grp">
          <div className="grp__h">
            <h2 className="lbl">Todavía no llegaron</h2>
            <span className="grp__n">{faltan.length}</span>
          </div>
          <div className="card">
            {faltan.length === 0 ? (
              <Row title={nq !== '' ? 'Nadie coincide' : 'Están todos adentro'} />
            ) : (
              verFaltan.map((s) => (
                <Row
                  key={s.sale_id}
                  title={s.buyer_name}
                  sub={[
                    s.entered > 0 ? `falta ${s.total - s.entered} de ${s.total}` : entradas(s.total),
                    primerNombre(s.seller_name),
                    s.is_comp ? 'cortesía' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  status={
                    // Marcar pasa por la puerta: el ingreso manual tiene su flujo
                    // (cola offline, idempotencia) y no se duplica acá.
                    <Button
                      aria-label={`Marcar el ingreso de ${s.buyer_name} en la puerta`}
                      onClick={() => navigate(`/puerta/${elegida.id}?buscar=${encodeURIComponent(s.buyer_name)}`)}
                    >
                      Marcar
                    </Button>
                  }
                />
              ))
            )}
            {verFaltan.length < faltan.length && (
              <div className="card__f">
                <span>
                  {verFaltan.length} de {faltan.length}
                </span>
                <button className="card__a" type="button" onClick={() => setTodosFaltan(true)}>
                  Ver todos
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="grp">
          <div className="grp__h">
            <h2 className="lbl">Ya entraron</h2>
            <span className="grp__n">
              {enVivo ? 'en vivo · ' : ''}
              {verIngresos.length < ingresos.length
                ? `últimos ${verIngresos.length}`
                : `${ingresos.length} ${ingresos.length === 1 ? 'ingreso' : 'ingresos'}`}
            </span>
          </div>
          <div className="card">
            {ingresos.length === 0 ? (
              <Row title={nq !== '' ? 'Nadie coincide' : 'Todavía no entró nadie'} />
            ) : (
              verIngresos.map((i) => (
                <button key={i.key} className="feed" type="button" onClick={() => setAbierta(i.sale)}>
                  <span className="feed__t">{hora(i.at)}</span>
                  <div>
                    <div className="rt">{i.sale.buyer_name}</div>
                    <div className="rs">
                      {entradas(i.cantidad)} · {i.sale.is_comp ? 'cortesía de' : 'le vendió'} {i.sale.seller_name}
                    </div>
                  </div>
                </button>
              ))
            )}
            {verIngresos.length < ingresos.length && (
              <div className="card__f">
                <span>
                  {verIngresos.length} de {ingresos.length}
                </span>
                <button className="card__a" type="button" onClick={() => setTodoElRegistro(true)}>
                  Ver todos
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {abierta && <DetalleCompra sale={abierta} onClose={() => setAbierta(null)} />}
    </>
  )
}
