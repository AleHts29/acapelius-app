import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { ShowFunction } from '../api/client'
import { useSession } from '../auth/session'
import { formatDateTime, formatMoney } from '../lib/format'
import { BalanceChip, Chip } from '../ui/StatusChip'

/** Elige la funcion del hero: la proxima; si no hay futuras, la ultima. */
function heroFunction(functions: ShowFunction[]): ShowFunction | null {
  if (functions.length === 0) return null
  const now = Date.now()
  const upcoming = functions.filter((f) => new Date(f.starts_at).getTime() >= now - 3 * 3600_000)
  return upcoming[0] ?? functions[functions.length - 1]
}

function heroEyebrow(fn: ShowFunction): string {
  const start = new Date(fn.starts_at)
  const days = Math.ceil((start.getTime() - Date.now()) / 86400_000)
  const hour = start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  if (days < 0) return 'Última función'
  if (days === 0) return `Hoy · ${hour}`
  if (days === 1) return 'Próxima función · mañana'
  return `Próxima función · en ${days} días`
}

function Hero({ fn }: { fn: ShowFunction }) {
  const pct = fn.capacity > 0 ? Math.round((fn.sold / fn.capacity) * 100) : 0
  return (
    <Link to="/ventas" style={{ textDecoration: 'none', display: 'block' }}>
      <div className="hero">
        <div className="hero__watermark" aria-hidden>♪</div>
        <div className="eyebrow">{heroEyebrow(fn)}</div>
        <div className="hero__fn">{fn.name ?? fn.venue}</div>
        <p className="hero__meta">
          {formatDateTime(fn.starts_at)} · {fn.venue}
        </p>
        <div className="hero__bar" role="img" aria-label={`${fn.sold} de ${fn.capacity} vendidas`}>
          <i style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="hero__barlbl">
          <span>
            {fn.sold} de {fn.capacity} vendidas
          </span>
          <span>{pct}%</span>
        </div>
      </div>
    </Link>
  )
}

function CatItem({ to, title, subtitle }: { to: string; title: string; subtitle: string }) {
  return (
    <Link className="cat__item" to={to}>
      <span>
        <span className="t">{title}</span>
        <span className="s" style={{ display: 'block' }}>{subtitle}</span>
      </span>
      <span className="chev" aria-hidden>›</span>
    </Link>
  )
}

/** Objetivos y saldo de la corista, dentro de la categoria Ventas. */
function SellerSeasonCard() {
  const allocations = useQuery({ queryKey: ['my-allocations'], queryFn: () => api.myAllocations() })
  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.listSeasons() })
  const seasonId = seasons.data?.seasons[0]?.id
  const balance = useQuery({
    queryKey: ['settlements-report', seasonId],
    queryFn: () => api.settlementsReport(seasonId!),
    enabled: seasonId !== undefined,
  })

  const rows = allocations.data?.allocations ?? []
  const myRow = balance.data?.rows[0]
  const hasBalance = myRow && (myRow.collected_cents > 0 || myRow.settled_cents > 0)
  if (rows.length === 0 && !hasBalance) return null

  return (
    <div className="cat cat--sales">
      <div className="cat__edge" />
      <div className="cat__inner">
        <div className="cat__head">
          <b>Mi temporada</b>
          {myRow && hasBalance && <BalanceChip balanceCents={myRow.balance_cents} />}
        </div>
        {rows.map((a) => (
          <div key={a.function_id} className="cat__item" style={{ minHeight: 34 }}>
            <span>
              <span className="t">{a.function_name ?? a.venue}</span>
              <span className="s" style={{ display: 'block' }}>{formatDateTime(a.starts_at)}</span>
            </span>
            <span className={`alloc-progress ${a.sold >= a.assigned ? 'stat-ok' : ''}`}>
              {a.sold} / {a.assigned}
              {a.sold >= a.assigned && ' ✓'}
            </span>
          </div>
        ))}
        {hasBalance && myRow && (
          <p className="s muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
            Cobraste {formatMoney(myRow.collected_cents)} y rendiste {formatMoney(myRow.settled_cents)}.
          </p>
        )}
      </div>
    </div>
  )
}

export function HomePage() {
  const { user } = useSession()

  const functions = useQuery({ queryKey: ['functions'], queryFn: () => api.listFunctions() })
  const sales = useQuery({
    queryKey: ['sales'],
    queryFn: () => api.listSales(),
    enabled: user?.role === 'admin' || user?.role === 'seller',
  })
  const seasons = useQuery({
    queryKey: ['seasons'],
    queryFn: () => api.listSeasons(),
    enabled: user?.role === 'admin',
  })
  const seasonId = seasons.data?.seasons[0]?.id
  const settlements = useQuery({
    queryKey: ['settlements-report', seasonId],
    queryFn: () => api.settlementsReport(seasonId!),
    enabled: user?.role === 'admin' && seasonId !== undefined,
  })

  if (!user) return null

  const fn = heroFunction(functions.data?.functions ?? [])
  const pendingCount = (sales.data?.sales ?? []).filter(
    (s) => s.voided_at === null && !s.is_comp && s.payment_status === 'pending',
  ).length
  const totalOwed = (settlements.data?.rows ?? []).reduce(
    (acc, r) => acc + Math.max(r.balance_cents, 0),
    0,
  )

  return (
    <div className="stack">
      {fn && <Hero fn={fn} />}

      <div className="cat cat--sales">
        <div className="cat__edge" />
        <div className="cat__inner">
          <div className="cat__head">
            <b>Ventas</b>
            {pendingCount > 0 && <Chip tone="blue">{pendingCount} pendiente{pendingCount > 1 ? 's' : ''}</Chip>}
          </div>
          <CatItem to="/ventas/nueva" title={user.role === 'admin' ? 'Nueva venta o cortesía' : 'Nueva venta'} subtitle="Registrar y enviar QR" />
          <CatItem to="/ventas" title={user.role === 'admin' ? 'Ventas' : 'Mis ventas'} subtitle="Pagos, links y reenvíos" />
        </div>
      </div>

      {user.role === 'seller' && <SellerSeasonCard />}

      <div className="cat cat--door">
        <div className="cat__edge" />
        <div className="cat__inner">
          <div className="cat__head"><b>Operación</b></div>
          <CatItem to="/puerta" title="Modo puerta" subtitle="Escanear QR y marcar ingresos" />
        </div>
      </div>

      {user.role === 'admin' && (
        <div className="cat cat--admin">
          <div className="cat__edge" />
          <div className="cat__inner">
            <div className="cat__head">
              <b>Administración</b>
              {totalOwed > 0 && <Chip tone="warn">Debe {formatMoney(totalOwed)}</Chip>}
            </div>
            <CatItem to="/panel/rendiciones" title="Rendiciones" subtitle="Quién debe cuánto, registrar entregas" />
            <CatItem to="/panel/asistencia" title="Asistencia" subtitle="Quién entró y a qué hora" />
            <CatItem to="/temporadas" title="Temporadas y funciones" subtitle="Fechas, cupos, precios y asignaciones" />
            <CatItem to="/usuarios" title="Equipo" subtitle="Coristas, puerta y dirección" />
          </div>
        </div>
      )}
    </div>
  )
}
