import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import { formatMoney } from '../lib/format'
import { BalanceChip } from '../ui/StatusChip'

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

// DireccionPage: el vistazo de Eli — KPIs de la temporada, quien debe cuanto,
// y las puertas al resto de la administracion (mockup "Direccion").
export function DireccionPage() {
  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.listSeasons() })
  const season = seasons.data?.seasons[0]

  const report = useQuery({ queryKey: ['sales-report'], queryFn: () => api.salesReport() })
  const settlements = useQuery({
    queryKey: ['settlements-report', season?.id],
    queryFn: () => api.settlementsReport(season!.id),
    enabled: season !== undefined,
  })
  const functions = useQuery({ queryKey: ['functions'], queryFn: () => api.listFunctions() })

  const rows = report.data?.rows ?? []
  const totals = rows.reduce(
    (acc, r) => ({
      sold: acc.sold + r.tickets_sold,
      paid: acc.paid + r.paid_cents,
      pending: acc.pending + r.pending_cents,
    }),
    { sold: 0, paid: 0, pending: 0 },
  )
  const fns = functions.data?.functions ?? []
  const done = fns.filter((f) => new Date(f.starts_at).getTime() < Date.now()).length

  const settled = (settlements.data?.rows ?? []).filter(
    (r) => r.collected_cents > 0 || r.settled_cents > 0,
  )

  return (
    <>
      <h1 className="page-title" style={{ marginBottom: 2 }}>Dirección</h1>
      {season && <p className="eyebrow" style={{ margin: '0 0 12px' }}>{season.name}</p>}

      <div className="kpis">
        <div className="kpi"><b className="g">{formatMoney(totals.paid)}</b><span>Recaudado</span></div>
        <div className="kpi"><b className="y">{formatMoney(totals.pending)}</b><span>Por cobrar</span></div>
        <div className="kpi"><b className="b">{totals.sold}</b><span>Vendidas</span></div>
        <div className="kpi"><b>{done}/{fns.length}</b><span>Funciones hechas</span></div>
      </div>

      <p className="eyebrow" style={{ margin: '18px 0 8px' }}>Rendiciones</p>
      {settlements.isPending ? (
        <p className="muted">Cargando…</p>
      ) : settled.length === 0 ? (
        <p className="muted">Todavía no hay plata en movimiento.</p>
      ) : (
        <div className="stack" style={{ marginBottom: 4 }}>
          {settled.map((row) => (
            <Link key={row.seller_id} to="/panel/rendiciones" className="lrow" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <div className="lrow__head">
                <span>
                  <b>{row.seller_name}</b>
                  <span className="lrow__sub" style={{ display: 'block' }}>
                    Cobró {formatMoney(row.collected_cents)} · rindió {formatMoney(row.settled_cents)}
                  </span>
                </span>
                <BalanceChip balanceCents={row.balance_cents} />
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="cat cat--admin" style={{ marginTop: 14 }}>
        <div className="cat__edge" />
        <div className="cat__inner">
          <div className="cat__head"><b>Administración</b></div>
          <CatItem to="/panel/ventas" title="Panel de ventas" subtitle="Totales por corista y por función" />
          <CatItem to="/panel/asistencia" title="Asistencia" subtitle="Quién entró y a qué hora" />
          <CatItem to="/temporadas" title="Temporadas y funciones" subtitle="Fechas, cupos, precios y asignaciones" />
          <CatItem to="/usuarios" title="Equipo" subtitle="Coristas, puerta y dirección" />
        </div>
      </div>
    </>
  )
}
