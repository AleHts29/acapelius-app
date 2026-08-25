import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import { useSession } from '../auth/session'
import { formatDateTime, formatMoney } from '../lib/format'

/** Objetivos de venta de la corista: cuantas le asigno Eli y como viene. */
function SellerAllocationsCard() {
  const { data } = useQuery({
    queryKey: ['my-allocations'],
    queryFn: () => api.myAllocations(),
  })

  const allocations = data?.allocations ?? []
  if (allocations.length === 0) return null

  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <p className="panel__label">Mis entradas asignadas</p>
      {allocations.map((a) => (
        <div key={a.function_id} className="alloc-row">
          <span>
            {a.function_name ?? a.venue}
            <br />
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {formatDateTime(a.starts_at)}
            </span>
          </span>
          <span className={`alloc-progress ${a.sold >= a.assigned ? 'report-summary__ok' : ''}`}>
            {a.sold} / {a.assigned}
            {a.sold >= a.assigned && ' ✓'}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Saldo a rendir de la vendedora en la temporada mas nueva (spec §3). */
function SellerBalanceCard() {
  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.listSeasons() })
  const seasonId = seasons.data?.seasons[0]?.id

  const report = useQuery({
    queryKey: ['settlements-report', seasonId],
    queryFn: () => api.settlementsReport(seasonId!),
    enabled: seasonId !== undefined,
  })

  const row = report.data?.rows[0]
  if (!row || (row.collected_cents === 0 && row.settled_cents === 0)) return null

  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <p className="panel__label">Mi saldo a rendir</p>
      <p className="report-summary__big" style={{ margin: 0 }}>
        {row.balance_cents > 0 ? (
          <span className="report-summary__warn">{formatMoney(row.balance_cents)}</span>
        ) : (
          <span className="report-summary__ok">Al dia</span>
        )}
      </p>
      <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
        Cobraste {formatMoney(row.collected_cents)} y rendiste {formatMoney(row.settled_cents)}
        {row.pending_cents > 0 && <> · te deben {formatMoney(row.pending_cents)}</>}
      </p>
    </div>
  )
}

function NavCard({ to, title, subtitle }: { to: string; title: string; subtitle: string }) {
  return (
    <Link className="nav-card" to={to}>
      <span>
        <strong>{title}</strong>
        <br />
        <span className="muted">{subtitle}</span>
      </span>
      <span className="muted">›</span>
    </Link>
  )
}

export function HomePage() {
  const { user } = useSession()
  if (!user) return null

  return (
    <>
      <div className="panel">
        <p className="panel__label">Sesion iniciada</p>
        <h2>{user.name}</h2>
        <p className="muted" style={{ margin: '0.25rem 0 0' }}>
          {user.email}
        </p>
      </div>

      {user.role === 'seller' && (
        <>
          <SellerAllocationsCard />
          <SellerBalanceCard />
        </>
      )}

      <nav className="stack" style={{ marginTop: '1rem' }} aria-label="Puerta">
        <NavCard to="/puerta" title="Modo puerta" subtitle="Escanear QR y marcar ingresos" />
      </nav>

      {(user.role === 'admin' || user.role === 'seller') && (
        <nav className="stack" style={{ marginTop: '0.75rem' }} aria-label="Ventas">
          <NavCard
            to="/ventas/nueva"
            title={user.role === 'admin' ? 'Nueva venta o cortesia' : 'Nueva venta'}
            subtitle="Registrar y mandar la entrada"
          />
          <NavCard
            to="/ventas"
            title={user.role === 'admin' ? 'Ventas' : 'Mis ventas'}
            subtitle="Pagos, links y reenvios"
          />
        </nav>
      )}

      {user.role === 'admin' && (
        <>
          <nav className="stack" style={{ marginTop: '0.75rem' }} aria-label="Panel">
            <NavCard to="/panel/ventas" title="Panel de ventas" subtitle="Totales, pagas y pendientes" />
            <NavCard
              to="/panel/rendiciones"
              title="Rendiciones"
              subtitle="Quien debe cuanto, registrar entregas"
            />
            <NavCard to="/panel/asistencia" title="Asistencia" subtitle="Quien entro y a que hora" />
          </nav>
          <nav className="stack" style={{ marginTop: '0.75rem' }} aria-label="Administracion">
            <NavCard to="/temporadas" title="Temporadas y funciones" subtitle="Fechas, cupos y precios" />
            <NavCard to="/usuarios" title="Usuarios" subtitle="Vendedoras, puerta y direccion" />
          </nav>
        </>
      )}
    </>
  )
}
