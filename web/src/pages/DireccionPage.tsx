import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  LineChart,
  Mail,
  Mic2,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { activeSeason, api } from '../api/client'
import type { Alert, FunctionSummary } from '../api/client'
import { dayLabel, daysAgo, formatMoney } from '../lib/format'
import { AlertCard, ProgressBar } from '../ui/controls'

/** Cada tipo de alerta define su ícono, su tono, su copy y a dónde lleva. */
function alertProps(alert: Alert, seasonId: number): {
  tone: 'warn' | 'blue'
  icon: ReactNode
  title: string
  context: string
  actionLabel: string
  href: string
} {
  switch (alert.kind) {
    case 'settlement':
      return {
        tone: 'warn',
        icon: <Wallet size={15} />,
        title: `${alert.name} debe rendir ${formatMoney(alert.amount_cents ?? 0)}`,
        context: alert.since ? `Última venta cobrada ${daysAgo(alert.since)}` : 'Todavía sin rendir',
        actionLabel: 'Registrar',
        href: `/panel/rendiciones/${alert.seller_id}`,
      }
    case 'allocation':
      return {
        tone: 'warn',
        icon: <Ticket size={15} />,
        title: `${alert.name}: ${alert.missing} ${alert.missing === 1 ? 'entrada' : 'entradas'} sin asignar`,
        context: `${alert.starts_at ? dayLabel(alert.starts_at) : ''} · cupo ${alert.capacity}`,
        actionLabel: 'Asignar',
        href: `/temporadas/${seasonId}?fn=${alert.function_id}`,
      }
    case 'invite':
      return {
        tone: 'blue',
        icon: <Mail size={15} />,
        title: `${alert.name} nunca entró a la app`,
        context: alert.since ? `Invitada ${daysAgo(alert.since)}` : 'Invitación pendiente',
        actionLabel: 'Reenviar',
        href: `/usuarios?u=${alert.user_id}`,
      }
  }
}

/** Mini-card de función: barra de venta, vendidas sobre cupo y recaudado. */
function FunctionCard({ fn, seasonId }: { fn: FunctionSummary; seasonId: number }) {
  const start = new Date(fn.starts_at)
  const now = Date.now()
  const isToday = new Date().toDateString() === start.toDateString()
  const done = start.getTime() < now && !isToday
  const missing = fn.capacity - fn.assigned

  return (
    <Link className={`fncard ${done ? 'fncard--done' : ''}`} to={`/temporadas/${seasonId}?fn=${fn.id}`}>
      <div className="fncard__h">
        <b>{fn.name ?? fn.venue}</b>
        {isToday ? (
          <span className="fnpill fnpill--hoy">Hoy</span>
        ) : done ? (
          <span className="fnpill fnpill--hecha">Hecha</span>
        ) : (
          <span className="fncard__date">{dayLabel(fn.starts_at)}</span>
        )}
      </div>
      <ProgressBar value={fn.sold} max={fn.capacity} tone={done ? 'ok' : 'blue'} />
      <div className="fncard__leg">
        <span>
          <b>
            {fn.sold}/{fn.capacity}
          </b>{' '}
          vendidas
          {/* El día de la función el dato que importa es la puerta, y antes no
              se mostraba ninguno de los dos: "ingresaron" era sólo para las
              hechas y "sin asignar" sólo para las futuras. */}
          {done || isToday ? (
            <>
              {' '}
              · <b className="g">{fn.entered}</b> ingresaron
            </>
          ) : missing > 0 ? (
            <> · {missing} sin asignar</>
          ) : null}
        </span>
        <span>
          Recaudó <b className="g">{formatMoney(fn.collected_cents)}</b>
        </span>
      </div>
    </Link>
  )
}

/** Ritmo de ventas: barras por día, sin librería de charts. */
function SalesRhythm({ seasonId }: { seasonId: number }) {
  const timeline = useQuery({
    queryKey: ['sales-timeline', seasonId],
    queryFn: () => api.salesTimeline(seasonId, 14),
  })

  const data = timeline.data
  if (!data || data.total === 0) return null

  const peak = Math.max(...data.days.map((d) => d.tickets), 1)
  // La última semana se pinta llena: es la que cuenta el delta.
  const hotFrom = data.days.length - 7

  return (
    <div className="rhythm">
      <div className="rhythm__h">
        <b>Ritmo de ventas · últimas 2 semanas</b>
        <span className={data.delta >= 0 ? 'g' : 'y'}>
          {data.delta >= 0 ? '↑' : '↓'} {Math.abs(data.delta)}
        </span>
      </div>
      <div
        className="rhythm__bars"
        role="img"
        aria-label={`${data.total} entradas vendidas en 14 días`}
      >
        {data.days.map((day, i) => (
          <i
            key={day.day}
            className={i >= hotFrom ? 'hot' : ''}
            style={{ height: `${Math.max((day.tickets / peak) * 100, 3)}%` }}
            title={`${day.day}: ${day.tickets}`}
          />
        ))}
      </div>
    </div>
  )
}

function AccessCard({ to, icon, title, subtitle }: { to: string; icon: ReactNode; title: string; subtitle: string }) {
  return (
    <Link className="acc" to={to}>
      <span className="acc__ic" aria-hidden>
        {icon}
      </span>
      <b>{title}</b>
      <span>{subtitle}</span>
    </Link>
  )
}

/**
 * DireccionPage (C9): un asistente, no un tablero. Primero los KPIs con
 * contexto, después todo lo accionable en un solo lugar, después el pulso de
 * la temporada función por función, y al final los accesos.
 */
export function DireccionPage() {
  const navigate = useNavigate()
  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.listSeasons() })
  const all = seasons.data?.seasons ?? []
  const season = activeSeason(all)
  const seasonId = season?.id

  const attention = useQuery({
    queryKey: ['attention', seasonId],
    queryFn: () => api.attention(seasonId!),
    enabled: seasonId !== undefined,
  })
  const summary = useQuery({
    queryKey: ['functions-summary', seasonId],
    queryFn: () => api.functionsSummary(seasonId!),
    enabled: seasonId !== undefined,
  })
  const settlements = useQuery({
    queryKey: ['settlements-report', seasonId],
    queryFn: () => api.settlementsReport(seasonId!),
    enabled: seasonId !== undefined,
  })

  const fns = summary.data?.functions ?? []
  const totals = fns.reduce(
    (acc, fn) => ({
      sold: acc.sold + fn.sold,
      capacity: acc.capacity + fn.capacity,
      collected: acc.collected + fn.collected_cents,
    }),
    { sold: 0, capacity: 0, collected: 0 },
  )
  const done = fns.filter((fn) => new Date(fn.starts_at).getTime() < Date.now()).length

  const debtors = (settlements.data?.rows ?? []).filter((row) => row.balance_cents > 0)
  const toSettle = debtors.reduce((acc, row) => acc + row.balance_cents, 0)

  const alerts = attention.data?.alerts ?? []

  if (!season) {
    return (
      <>
        <h1 className="page-title">Dirección</h1>
        <p className="muted">
          Todavía no hay temporadas. <Link to="/temporadas">Creá la primera</Link> para empezar.
        </p>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Dirección</h1>
        {all.length > 1 ? (
          <span className="att-fnsel">
            <select
              aria-label="Temporada"
              value={seasonId}
              onChange={(e) => navigate(`/temporadas/${e.target.value}`)}
            >
              {all.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <ChevronDown size={12} aria-hidden />
          </span>
        ) : (
          <Link className="season-pill" to={`/temporadas/${season.id}`}>
            {season.name}
          </Link>
        )}
      </div>

      <div className="kpis kpis--tight">
        <div className="kpi">
          <b className="g">{formatMoney(totals.collected)}</b>
          <span>Recaudado</span>
        </div>
        <div className="kpi">
          <b className={toSettle > 0 ? 'y' : 'g'}>{formatMoney(toSettle)}</b>
          <span>Por rendir</span>
          <div className="kpi__sub">
            {toSettle > 0
              ? `en manos de ${debtors.length} ${debtors.length === 1 ? 'corista' : 'coristas'}`
              : 'todas al día'}
          </div>
        </div>
        <div className="kpi">
          <b className="b">
            {totals.sold} <span className="kpi__of">/ {totals.capacity}</span>
          </b>
          <span>Vendidas</span>
        </div>
        <div className="kpi">
          <b>
            {done}/{fns.length}
          </b>
          <span>Funciones hechas</span>
        </div>
      </div>

      <div className="ghead">
        <b>Necesita tu atención</b>
        {alerts.length > 0 && <span className="n-warn">{alerts.length}</span>}
      </div>

      {attention.isPending ? (
        <p className="muted">Cargando…</p>
      ) : alerts.length === 0 ? (
        <AlertCard
          tone="ok"
          icon={<CheckCircle2 size={16} />}
          title="Todo en orden"
          context="Sin rendiciones pendientes ni tareas abiertas. ¡Gran temporada!"
        />
      ) : (
        alerts.map((alert, i) => {
          const props = alertProps(alert, season.id)
          return (
            <AlertCard
              key={`${alert.kind}-${alert.seller_id ?? alert.function_id ?? alert.user_id ?? i}`}
              tone={props.tone}
              icon={props.icon}
              title={props.title}
              context={props.context}
              actionLabel={props.actionLabel}
              onAction={() => navigate(props.href)}
            />
          )
        })
      )}

      {fns.length > 0 && (
        <>
          <div className="ghead">
            <b>La temporada, función por función</b>
          </div>
          <div className="fngrid">
            {fns.map((fn) => (
              <FunctionCard key={fn.id} fn={fn} seasonId={season.id} />
            ))}
          </div>
          <SalesRhythm seasonId={season.id} />
        </>
      )}

      <div className="ghead">
        <b>Administración</b>
      </div>
      <div className="grid2">
        <AccessCard
          to="/panel/ventas"
          icon={<LineChart size={16} />}
          title="Panel de ventas"
          subtitle="Por corista y función"
        />
        <AccessCard
          to="/panel/asistencia"
          icon={<Users size={16} />}
          title="Asistencia"
          subtitle="Quién entró"
        />
        <AccessCard
          to="/panel/rendiciones"
          icon={<Wallet size={16} />}
          title="Rendiciones"
          subtitle="Quién debe y quién rindió"
        />
        <AccessCard
          to="/temporadas"
          icon={<CalendarDays size={16} />}
          title="Temporadas"
          subtitle="Funciones y cupos"
        />
        <AccessCard
          to="/usuarios"
          icon={<Mic2 size={16} />}
          title="Equipo"
          subtitle="Coristas y roles"
        />
      </div>
    </>
  )
}
