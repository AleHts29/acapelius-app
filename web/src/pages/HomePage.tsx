import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, Mail, Ticket, Wallet } from 'lucide-react'

import { useState } from 'react'

import { api, publicSaleURL } from '../api/client'
import type {
  Alert,
  Home,
  HomeFunction,
  HomeSale,
  HomeToDo,
  MySettlement,
  SettlementReportRow,
} from '../api/client'
import { RegisterSheet } from './SettlementsPage'
import { useSession } from '../auth/session'
import { calendarDaysUntil, dayLabel, daysAgo, formatDateTime, formatMoney } from '../lib/format'
import { initials } from '../lib/search'
import { ProgressBar } from '../ui/controls'
import { useNuevaVenta } from '../ui/useNuevaVenta'
import { SaleChip } from '../ui/StatusChip'

/** "Próxima función · en 5 días" / "· hoy" / "Última función". */
function heroEyebrow(startsAt: string): string {
  const dias = calendarDaysUntil(startsAt)
  if (dias < 0) return 'Última función'
  if (dias === 0) return 'Próxima función · hoy'
  if (dias === 1) return 'Próxima función · mañana'
  return `Próxima función · en ${dias} días`
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="hero__st">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

/**
 * El hero: la próxima función. Para dirección el progreso es la venta de la
 * función; para la corista, su venta contra su cupo — el mismo bloque contando
 * la historia que le toca a cada una.
 */
function Hero({ home, fn }: { home: Home; fn: HomeFunction }) {
  const navigate = useNavigate()
  const esCorista = home.role === 'seller'
  const sinCupo = esCorista && fn.no_allocation

  const valor = esCorista ? fn.my_sold : fn.sold
  const total = esCorista ? fn.my_assigned : fn.capacity
  const leyenda = esCorista
    ? sinCupo
      ? 'Sin cupo asignado para esta función'
      : `Vendiste ${fn.my_sold} de tus ${fn.my_assigned} entradas`
    : `${fn.sold} de ${fn.capacity} vendidas`
  const porcentaje = total > 0 ? Math.round((valor / total) * 100) : 0

  return (
    <div className="hero">
      <div className="hero__watermark" aria-hidden>
        ♪
      </div>
      <div className="hero__l">
        <div className="eyebrow hero__eyebrow">{heroEyebrow(fn.starts_at)}</div>
        <div className="hero__fn">{fn.name ?? fn.venue}</div>
        <p className="hero__meta">
          {formatDateTime(fn.starts_at)} · {fn.venue}
        </p>
        <div className="hero__bar" role="img" aria-label={leyenda}>
          <i style={{ width: `${Math.min(porcentaje, 100)}%` }} />
        </div>
        <div className="hero__barlbl">
          <span>{leyenda}</span>
          {!sinCupo && <span>{porcentaje}%</span>}
        </div>
      </div>

      <div className="hero__stats">
        {esCorista ? (
          <>
            <Stat value={String(Math.max(fn.my_assigned - fn.my_sold, 0))} label="Te quedan" />
            <Stat value={formatMoney(fn.my_collected_cents)} label="Cobraste" />
          </>
        ) : (
          <>
            <Stat value={formatMoney(fn.collected_cents)} label="Recaudó" />
            <Stat value={String(Math.max(fn.capacity - fn.assigned, 0))} label="Sin asignar" />
          </>
        )}
      </div>

      {/* La corista no lleva CTA acá: "Nueva venta" ya está una sola vez por
          viewport (C16). Para dirección el botón no es una acción repetida,
          es ir a la función. */}
      {!esCorista && (
        <button
          className="hero__cta"
          type="button"
          onClick={() => navigate(`/temporadas/${home.season?.id}?fn=${fn.id}`)}
        >
          Ver función
        </button>
      )}
    </div>
  )
}

/** Encabezado de sección con su link a la vista completa. */
function Sect({ title, to, linkLabel }: { title: string; to?: string; linkLabel?: string }) {
  return (
    <div className="ghead">
      <b>{title}</b>
      {to && (
        <Link className="ghead__lnk" to={to}>
          {linkLabel ?? 'Ver todo'}
        </Link>
      )}
    </div>
  )
}

/** Tabla corta de últimas ventas: tres filas y el link al listado. */
function LastSales({ sales, esCorista }: { sales: HomeSale[]; esCorista: boolean }) {
  if (sales.length === 0) {
    return <p className="muted">Todavía no hay ventas.</p>
  }
  return (
    <div className="hcard hcard--p0">
      <div className="thead2" aria-hidden>
        <span>Comprador</span>
        <span>{esCorista ? 'Función' : 'Vendedora'}</span>
        <span>Entr.</span>
        <span>Estado</span>
      </div>
      {sales.map((s) => (
        <div key={s.id} className="trow2">
          <span className="trow2__who">
            <span className="ini">{initials(s.buyer_name)}</span>
            <b>{s.buyer_name}</b>
          </span>
          <span className="trow2__dim">
            {esCorista ? s.function_name : s.is_comp ? `emitió ${s.seller_name}` : s.seller_name}
          </span>
          <span>{s.quantity}</span>
          <SaleChip
            sale={{
              voided_at: null,
              is_comp: s.is_comp,
              payment_status: s.paid_cents >= s.amount_cents ? 'paid' : 'pending',
              payment_method: null,
              amount_cents: s.amount_cents,
              paid_cents: s.paid_cents,
            }}
          />
        </div>
      ))}
    </div>
  )
}

/** Una fila de "la temporada" (admin) o "tu cupo por función" (corista). */
function FnRow({ fn, esCorista }: { fn: HomeFunction; esCorista: boolean }) {
  const pasada = calendarDaysUntil(fn.starts_at) < 0
  const valor = esCorista ? fn.my_sold : fn.sold
  const total = esCorista ? fn.my_assigned : fn.capacity
  return (
    <div className="fnrow">
      <span className="fnrow__mid">
        <b>{fn.name ?? fn.venue}</b>
        <ProgressBar value={valor} max={Math.max(total, 1)} tone={pasada ? 'ok' : 'blue'} />
      </span>
      <span className="fnrow__r">
        <span className={`tag${pasada ? '' : ' tag--next'}`}>
          {pasada ? 'Hecha' : dayLabel(fn.starts_at)}
        </span>
        <span>
          {valor}/{total}
        </span>
      </span>
    </div>
  )
}

/**
 * "Tenés que rendir": lo que la corista cobró y todavía no le dio a Eli. Sale
 * del mismo cálculo que Plata —cobrado menos entregado— porque dos cuentas del
 * mismo número terminan discrepando, y esa discusión la pierde ella.
 */
function MiRendicion({ mio }: { mio: MySettlement }) {
  if (mio.balance_cents <= 0) {
    return (
      <div className="rendir rendir--ok">
        <span className="rendir__ic" aria-hidden>
          <Check size={16} />
        </span>
        <span className="rendir__tx">
          <b>Estás al día</b>
          <span>
            {mio.settled_cents > 0
              ? `Ya entregaste ${formatMoney(mio.settled_cents)} de la temporada.`
              : 'No tenés plata del coro en la mano.'}
          </span>
        </span>
      </div>
    )
  }
  return (
    <div className="rendir">
      <span className="rendir__n">{formatMoney(mio.balance_cents)}</span>
      <span className="rendir__tx">
        <b>Tenés que rendir</b>
        <span>
          Lo que cobraste y todavía no le diste a Eli · {mio.sales}{' '}
          {mio.sales === 1 ? 'venta' : 'ventas'}
        </span>
      </span>
    </div>
  )
}

/** Fila accionable de la corista: cobrar, o compartir el link si no hay email. */
function ToDoRow({ item, onAction }: { item: HomeToDo; onAction: (item: HomeToDo) => void }) {
  const sinEmail = !item.has_email && item.balance_cents === 0
  return (
    <div className={`alertrow${sinEmail ? ' alertrow--ind' : ''}`}>
      <span className="alertrow__ic" aria-hidden>
        {sinEmail ? <Mail size={15} /> : <Wallet size={15} />}
      </span>
      <span className="alertrow__mid">
        <b>
          {sinEmail
            ? `${item.buyer_name} no tiene email cargado`
            : `${item.buyer_name} debe ${formatMoney(item.balance_cents)}`}
        </b>
        <span>
          {item.quantity} {item.quantity === 1 ? 'entrada' : 'entradas'} ·{' '}
          {sinEmail ? 'compartile el link' : `vendida ${daysAgo(item.created_at)}`}
        </span>
      </span>
      <button className="alertrow__go" type="button" onClick={() => onAction(item)}>
        {sinEmail ? 'Copiar link' : 'Marcar pago'} ›
      </button>
    </div>
  )
}

export function HomePage() {
  const { user } = useSession()
  const navigate = useNavigate()
  const home = useQuery({ queryKey: ['home'], queryFn: () => api.home() })
  const nuevaVenta = useNuevaVenta()
  // La rendición se resuelve acá mismo (C14): la alerta abre el pop-up y al
  // confirmar desaparece sola, porque la mutación invalida ['home'].
  const [rindiendo, setRindiendo] = useState<SettlementReportRow | null>(null)

  if (!user) return null
  if (home.isPending) return <p className="muted">Cargando…</p>
  if (!home.data) return <p className="alert">No se pudo cargar el inicio.</p>

  const data = home.data
  const esCorista = data.role === 'seller'
  const hoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  async function accionPendiente(item: HomeToDo) {
    if (!item.has_email && item.balance_cents === 0) {
      try {
        await navigator.clipboard.writeText(publicSaleURL(item.code))
        return
      } catch {
        // Sin permiso de portapapeles: al listado, que tiene el link a la vista.
      }
    }
    navigate('/ventas?filtro=deben')
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Hola, {data.name.split(' ')[0]}</h1>
          <p className="page-head__sub">
            {hoy.charAt(0).toUpperCase() + hoy.slice(1)}
            {data.season && ` · ${data.season.name}`}
          </p>
        </div>
        {/* Una sola acción primaria por pantalla (C16). "Modo puerta" salió
            de acá: es una pestaña de la navegación, no un botón de la home. */}
        <div className="page-head__right">
          <button className="button home-cta" type="button" onClick={nuevaVenta.abrir}>
            ＋ Nueva venta
          </button>
        </div>
      </div>

      {data.next_function ? (
        <Hero home={data} fn={data.next_function} />
      ) : (
        <p className="muted">
          Todavía no hay funciones cargadas.{' '}
          {!esCorista && <Link to="/temporadas">Creá la primera</Link>}
        </p>
      )}

      {/* El mismo botón del header, renderizado donde el pulgar lo alcanza.
          En escritorio este bloque no se muestra y manda el del header: es la
          misma acción declarada una vez por breakpoint, no dos botones. */}
      <div className="home-actions">
        <button className="button" type="button" onClick={nuevaVenta.abrir}>
          ＋ Nueva venta
        </button>
      </div>

      {/* Lo que tiene que rendir. Hasta acá este número no se veía en ningún
          lado: el acceso de su home apuntaba a /panel/rendiciones, que está
          bajo RequireAdmin, así que rebotaba al inicio. */}
      {esCorista && data.my_settlement && <MiRendicion mio={data.my_settlement} />}

      <div className="home-cols">
        <div className="home-cols__main">
          {esCorista ? (
            <>
              <Sect
                title={`Te falta cobrar · ${data.todo_total}`}
                to={data.todo_total > data.todo.length ? '/ventas?filtro=deben' : undefined}
              />
              {data.todo.length === 0 ? (
                <p className="muted">Nada pendiente: todo cobrado y compartido.</p>
              ) : (
                <div className="hcard hcard--p0">
                  {data.todo.map((item) => (
                    <ToDoRow key={item.sale_id} item={item} onAction={accionPendiente} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <Sect
                title={`Necesita tu atención · ${data.alert_total}`}
                to={data.alert_total > data.alerts.length ? '/direccion' : undefined}
              />
              {data.alerts.length === 0 ? (
                <p className="muted">
                  Todo en orden: sin rendiciones pendientes ni tareas abiertas.
                </p>
              ) : (
                <div className="hcard hcard--p0">
                  {data.alerts.map((alert, i) => {
                    const clave = `${alert.kind}-${alert.seller_id ?? alert.function_id ?? alert.user_id ?? i}`
                    const destino =
                      alert.kind === 'allocation'
                        ? `/temporadas/${data.season?.id}?fn=${alert.function_id}`
                        : `/usuarios?u=${alert.user_id}`
                    const contenido = (
                      <>
                      <span className="alertrow__ic" aria-hidden>
                        {alert.kind === 'settlement' ? (
                          <Wallet size={15} />
                        ) : alert.kind === 'allocation' ? (
                          <Ticket size={15} />
                        ) : (
                          <Mail size={15} />
                        )}
                      </span>
                      <span className="alertrow__mid">
                        <b>
                          {alert.kind === 'settlement'
                            ? `${alert.name} debe rendir ${formatMoney(alert.amount_cents ?? 0)}`
                            : alert.kind === 'allocation'
                              ? `${alert.name}: ${alert.missing} sin asignar`
                              : `${alert.name} nunca entró a la app`}
                        </b>
                        <span>
                          {alert.kind === 'allocation'
                            ? `${alert.starts_at ? dayLabel(alert.starts_at) : ''} · cupo ${alert.capacity}`
                            : alert.since
                              ? alert.kind === 'settlement'
                                ? `Cobró ${daysAgo(alert.since)}`
                                : `Invitada ${daysAgo(alert.since)}`
                              : ''}
                        </span>
                      </span>
                      <span className="alertrow__go">
                        {alert.kind === 'settlement'
                          ? 'Registrar'
                          : alert.kind === 'allocation'
                            ? 'Asignar'
                            : 'Reenviar'}{' '}
                        ›
                      </span>
                      </>
                    )
                    // Rendir se resuelve sin salir de la home; asignar cupo y
                    // reenviar una invitación viven en su pantalla.
                    return alert.kind === 'settlement' ? (
                      <button
                        key={clave}
                        className="alertrow"
                        type="button"
                        onClick={() => setRindiendo(filaDeAlerta(alert))}
                      >
                        {contenido}
                      </button>
                    ) : (
                      <Link
                        key={clave}
                        className={`alertrow${alert.kind === 'invite' ? ' alertrow--ind' : ''}`}
                        to={destino}
                      >
                        {contenido}
                      </Link>
                    )
                  })}
                </div>
              )}
            </>
          )}

          <Sect
            title={esCorista ? 'Mis últimas ventas' : 'Últimas ventas'}
            to="/ventas"
            linkLabel="Ver todas"
          />
          <LastSales sales={data.last_sales} esCorista={esCorista} />
        </div>

        <div className="home-cols__side">
          <Sect title={esCorista ? 'Tu cupo por función' : 'La temporada'} />
          {data.functions.length === 0 ? (
            <p className="muted">Sin funciones todavía.</p>
          ) : (
            <div className="hcard">
              {data.functions
                .filter((fn) => !esCorista || !fn.no_allocation)
                .map((fn) => (
                  <FnRow key={fn.id} fn={fn} esCorista={esCorista} />
                ))}
            </div>
          )}

        </div>
      </div>

      {nuevaVenta.panel}

      {rindiendo && data.season && (
        <RegisterSheet
          row={rindiendo}
          seasonId={data.season.id}
          onClose={() => setRindiendo(null)}
        />
      )}
    </>
  )
}

/**
 * La alerta trae lo justo para armar la fila que el pop-up de rendición
 * espera; lo que no aplica (lo que los compradores todavía deben) va en cero,
 * que es lo que corresponde: ese número no es parte de esta decisión.
 */
function filaDeAlerta(alert: Alert): SettlementReportRow {
  return {
    seller_id: alert.seller_id ?? 0,
    seller_name: alert.name,
    collected_cents: alert.collected_cents ?? 0,
    pending_cents: 0,
    settled_cents: alert.settled_cents ?? 0,
    balance_cents: alert.amount_cents ?? 0,
  }
}
