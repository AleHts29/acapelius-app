import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { SalesReportRow } from '../api/client'
import { formatDateTime, formatMoney } from '../lib/format'

type GroupBy = 'seller' | 'function'

interface GroupTotals {
  key: string
  label: string
  sublabel?: string
  ticketsSold: number
  compTickets: number
  paidCents: number
  pendingCents: number
}

function groupRows(rows: SalesReportRow[], by: GroupBy): GroupTotals[] {
  const groups = new Map<string, GroupTotals>()
  for (const row of rows) {
    const key = by === 'seller' ? `s${row.seller_id}` : `f${row.function_id}`
    let group = groups.get(key)
    if (!group) {
      group =
        by === 'seller'
          ? { key, label: row.seller_name, ticketsSold: 0, compTickets: 0, paidCents: 0, pendingCents: 0 }
          : {
              key,
              label: row.function_name ?? row.function_venue,
              sublabel: formatDateTime(row.function_starts_at),
              ticketsSold: 0,
              compTickets: 0,
              paidCents: 0,
              pendingCents: 0,
            }
      groups.set(key, group)
    }
    group.ticketsSold += row.tickets_sold
    group.compTickets += row.comp_tickets
    group.paidCents += row.paid_cents
    group.pendingCents += row.pending_cents
  }
  return [...groups.values()]
}

export function SalesReportPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>('seller')

  const { data, isPending } = useQuery({
    queryKey: ['sales-report'],
    queryFn: () => api.salesReport(),
  })

  const rows = data?.rows ?? []
  const groups = useMemo(() => groupRows(rows, groupBy), [rows, groupBy])
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          tickets: acc.tickets + row.tickets_sold,
          comps: acc.comps + row.comp_tickets,
          paid: acc.paid + row.paid_cents,
          pending: acc.pending + row.pending_cents,
        }),
        { tickets: 0, comps: 0, paid: 0, pending: 0 },
      ),
    [rows],
  )

  return (
    <>
      <h1 className="page-title">Ventas</h1>

      <div className="panel report-summary">
        <div>
          <p className="panel__label">Vendidas</p>
          <p className="report-summary__big">
            {totals.tickets}
            {totals.comps > 0 && <span className="muted"> +{totals.comps} cort.</span>}
          </p>
        </div>
        <div>
          <p className="panel__label">Cobrado</p>
          <p className="report-summary__big report-summary__ok">{formatMoney(totals.paid)}</p>
        </div>
        <div>
          <p className="panel__label">Por cobrar</p>
          <p className="report-summary__big report-summary__warn">{formatMoney(totals.pending)}</p>
        </div>
      </div>

      <div className="door-tabs" role="tablist" style={{ marginTop: '1rem' }}>
        <button
          type="button"
          role="tab"
          aria-selected={groupBy === 'seller'}
          className={`door-tab${groupBy === 'seller' ? ' door-tab--active' : ''}`}
          onClick={() => setGroupBy('seller')}
        >
          Por corista
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={groupBy === 'function'}
          className={`door-tab${groupBy === 'function' ? ' door-tab--active' : ''}`}
          onClick={() => setGroupBy('function')}
        >
          Por funcion
        </button>
      </div>

      {isPending ? (
        <p className="muted">Cargando...</p>
      ) : groups.length === 0 ? (
        <p className="muted">Todavia no hay ventas.</p>
      ) : (
        <div className="stack">
          {groups.map((group) => (
            <div key={group.key} className="panel">
              <div className="function-card__head">
                <div>
                  <h3 className="function-card__title">{group.label}</h3>
                  {group.sublabel && <p className="muted function-card__line">{group.sublabel}</p>}
                </div>
                <span className="badge">
                  {group.ticketsSold} {group.ticketsSold === 1 ? 'entrada' : 'entradas'}
                  {group.compTickets > 0 && ` + ${group.compTickets} cort.`}
                </span>
              </div>
              <div className="report-stat">
                <span className="report-stat__item">
                  <span className="muted">Cobrado </span>
                  <strong className="report-summary__ok">{formatMoney(group.paidCents)}</strong>
                </span>
                {group.pendingCents > 0 && (
                  <span className="report-stat__item">
                    <span className="muted">Por cobrar </span>
                    <strong className="report-summary__warn">{formatMoney(group.pendingCents)}</strong>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
