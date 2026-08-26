import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Hand, Minus, ScanLine } from 'lucide-react'

import { api } from '../api/client'
import type { AttendanceSale } from '../api/client'
import { initials, normalizeText } from '../lib/search'
import { EmptyState, Hl, LiveDot, ProgressBar, SearchBar, SegmentedToggle } from '../ui/controls'
import { CounterChip } from '../ui/StatusChip'

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** "Gala · vie 4": etiqueta compacta de la pill selectora de función. */
function fnLabel(name: string | null, venue: string, startsAt: string): string {
  const when = new Date(startsAt)
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' })
    .replace(/[.,]/g, '')
  return `${name ?? venue} · ${when}`
}

/** Ícono del método de ingreso: escaneado o manual (C6, nunca emoji). */
function MethodIcon({ method }: { method: 'scan' | 'manual' }) {
  return method === 'scan' ? (
    <ScanLine size={13} aria-label="escaneado" className="att-m" />
  ) : (
    <Hand size={13} aria-label="manual" className="att-m" />
  )
}

/** Subtítulo de la fila: quién la vendió (o emitió, si es cortesía). */
function SellerLine({ sale, q, extra }: { sale: AttendanceSale; q: string; extra?: string }) {
  return (
    <span>
      {sale.is_comp ? 'cortesía · emitió ' : 'vendió '}
      <Hl text={sale.seller_name} q={q} />
      {extra && ` · ${extra}`}
    </span>
  )
}

/** Cuánto le falta a una venta parcial o sin usar ("falta 1 de 3"). */
function missingLabel(sale: AttendanceSale): string {
  const missing = sale.total - sale.entered
  if (sale.entered === 0) {
    return sale.total === 1 ? '1 entrada' : `${sale.total} entradas`
  }
  return missing === 1 ? `falta 1 de ${sale.total}` : `faltan ${missing} de ${sale.total}`
}

/**
 * Fila por comprador (C6): colapsada muestra chip k/N, método y hora del
 * último ingreso; expandida, el detalle de cada entrada con quién registró.
 */
function BuyerRow({
  sale,
  q,
  tab,
  expanded,
  onToggle,
}: {
  sale: AttendanceSale
  q: string
  tab: 'ingresaron' | 'faltan'
  expanded: boolean
  onToggle: () => void
}) {
  const complete = sale.entered >= sale.total
  const header = (
    <>
      <span className={`att-ini ${complete ? 'att-ini--ok' : 'att-ini--warn'}`} aria-hidden>
        {initials(sale.buyer_name)}
      </span>
      <span className="mrow__mid">
        <b>
          <Hl text={sale.buyer_name} q={q} />
        </b>
        <SellerLine sale={sale} q={q} extra={tab === 'faltan' ? missingLabel(sale) : undefined} />
      </span>
      <CounterChip count={sale.entered} total={sale.total} />
      {tab === 'ingresaron' && sale.last_method && <MethodIcon method={sale.last_method} />}
      {tab === 'ingresaron' && sale.last_checkin_at && (
        <span className="att-when">{timeOf(sale.last_checkin_at)}</span>
      )}
    </>
  )

  if (!expanded) {
    return (
      <button className="mrow" type="button" aria-expanded={false} onClick={onToggle}>
        {header}
      </button>
    )
  }

  return (
    <div className="att-x">
      <button className="att-x__h" type="button" aria-expanded onClick={onToggle}>
        {header}
      </button>
      <div className="att-x__tks">
        {sale.tickets.map((ticket, i) => (
          <div key={ticket.ticket_id} className="att-tk">
            <span className="att-tk__l">
              <i className={`att-tk__st ${ticket.checkin ? 'in' : 'no'}`} aria-hidden>
                {ticket.checkin ? <Check size={10} strokeWidth={3} /> : <Minus size={10} strokeWidth={3} />}
              </i>
              Entrada {i + 1}
            </span>
            {ticket.checkin ? (
              <span className="att-tk__meta">
                <MethodIcon method={ticket.checkin.method} /> {timeOf(ticket.checkin.at)} ·{' '}
                {ticket.checkin.method === 'scan' ? 'escaneó' : 'manual ·'} {ticket.checkin.by_name}
              </span>
            ) : (
              <span className="att-tk__meta">sin ingresar</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function AttendancePage() {
  const [functionId, setFunctionId] = useState<number | null>(null)
  const [tab, setTab] = useState<'ingresaron' | 'faltan'>('ingresaron')
  const [q, setQ] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const functions = useQuery({ queryKey: ['functions'], queryFn: () => api.listFunctions() })
  // Sin eleccion, la funcion mas cercana a ahora (pasada o no): la de "anoche"
  // o la de hoy es lo que Eli quiere mirar.
  const effectiveFunctionId =
    functionId ??
    (functions.data && functions.data.functions.length > 0
      ? [...functions.data.functions].sort(
          (a, b) =>
            Math.abs(new Date(a.starts_at).getTime() - Date.now()) -
            Math.abs(new Date(b.starts_at).getTime() - Date.now()),
        )[0].id
      : null)

  const report = useQuery({
    queryKey: ['attendance', effectiveFunctionId],
    queryFn: () => api.attendanceReport(effectiveFunctionId!),
    enabled: effectiveFunctionId !== null,
    // "En tiempo real" con polling alcanza (spec §11: sin websockets).
    refetchInterval: 15_000,
  })

  const data = report.data
  const nq = normalizeText(q)
  const matches = (sale: AttendanceSale) =>
    nq === '' || normalizeText(sale.buyer_name).includes(nq) || normalizeText(sale.seller_name).includes(nq)

  const filtered = (data?.sales ?? []).filter(matches)
  // Ingresaron: orden del server (último ingreso primero). Faltan: por nombre.
  const entered = filtered.filter((sale) => sale.entered > 0)
  const missing = [...filtered.filter((sale) => sale.entered < sale.total)].sort((a, b) =>
    a.buyer_name.localeCompare(b.buyer_name, 'es'),
  )
  const missingTickets = missing.reduce((acc, sale) => acc + (sale.total - sale.entered), 0)
  const occupancy = data && data.issued > 0 ? Math.round((data.entered / data.issued) * 100) : 0

  const rows = tab === 'ingresaron' ? entered : missing

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Asistencia</h1>
        {functions.data && functions.data.functions.length > 1 && (
          <span className="att-fnsel">
            <select
              aria-label="Función"
              value={effectiveFunctionId ?? ''}
              onChange={(e) => {
                setFunctionId(Number(e.target.value))
                setExpandedId(null)
              }}
            >
              {functions.data.functions.map((fn) => (
                <option key={fn.id} value={fn.id}>
                  {fnLabel(fn.name, fn.venue, fn.starts_at)}
                </option>
              ))}
            </select>
            <ChevronDown size={12} aria-hidden />
          </span>
        )}
      </div>

      {report.isPending ? (
        <p className="muted">Cargando…</p>
      ) : !data ? (
        <p className="muted">No hay funciones cargadas.</p>
      ) : (
        <>
          <div className="att-live" aria-live="polite">
            <div className="att-live__r1">
              <b className="att-live__n">
                {data.entered}
                <span> / {data.issued}</span>
              </b>
              <LiveDot label="En vivo" />
            </div>
            <ProgressBar value={data.entered} max={data.issued} tone="ok" />
            <div className="att-live__leg">
              <span>
                <b>{data.buyers_complete}</b> de {data.buyers_total} compradores completos
              </span>
              <span>{occupancy}%</span>
            </div>
          </div>

          <div className="sticky-bar">
            <SearchBar value={q} onChange={setQ} placeholder="Buscar comprador o vendedora…" />
            <div style={{ marginTop: 8 }}>
              <SegmentedToggle<'ingresaron' | 'faltan'>
                value={tab}
                onChange={(next) => {
                  setTab(next)
                  setExpandedId(null)
                }}
                options={[
                  { value: 'ingresaron', label: `Ingresaron · ${entered.length}` },
                  { value: 'faltan', label: `Faltan · ${missing.length}` },
                ]}
              />
            </div>
          </div>

          <div className="ghead">
            <b>{tab === 'ingresaron' ? 'Últimos ingresos' : 'Sin ingresar aún'}</b>
            {tab === 'faltan' && missingTickets > 0 && (
              <span>{missingTickets === 1 ? '1 entrada' : `${missingTickets} entradas`}</span>
            )}
          </div>

          {rows.length === 0 ? (
            q !== '' ? (
              <EmptyState icon="🔍" title="Sin resultados">
                Nadie coincide con «{q}» en esta pestaña.
              </EmptyState>
            ) : tab === 'ingresaron' ? (
              <EmptyState icon="🎭" title="Todavía no entró nadie">
                Apenas se escanee la primera entrada la vas a ver acá.
              </EmptyState>
            ) : (
              <EmptyState icon="🎉" title="Están todos adentro">
                No queda ninguna entrada sin usar.
              </EmptyState>
            )
          ) : (
            rows.map((sale) => (
              <BuyerRow
                key={sale.sale_id}
                sale={sale}
                q={q}
                tab={tab}
                expanded={expandedId === sale.sale_id}
                onToggle={() => setExpandedId(expandedId === sale.sale_id ? null : sale.sale_id)}
              />
            ))
          )}
        </>
      )}
    </>
  )
}
