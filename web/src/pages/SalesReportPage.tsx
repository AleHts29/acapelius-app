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
      <h1 className="page-title">Panel de ventas</h1>

      <div className="kpis">
        <div className="kpi"><b className="g">{formatMoney(totals.paid)}</b><span>Cobrado</span></div>
        <div className="kpi"><b className="y">{formatMoney(totals.pending)}</b><span>Por cobrar</span></div>
        <div className="kpi"><b className="b">{totals.tickets}</b><span>Vendidas</span></div>
        <div className="kpi"><b>{totals.comps}</b><span>Cortesías</span></div>
      </div>

      <div className="segmented" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={groupBy === 'seller'}
          className={groupBy === 'seller' ? 'on' : ''}
          onClick={() => setGroupBy('seller')}
        >
          Por corista
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={groupBy === 'function'}
          className={groupBy === 'function' ? 'on' : ''}
          onClick={() => setGroupBy('function')}
        >
          Por función
        </button>
      </div>

      {isPending ? (
        <p className="muted">Cargando…</p>
      ) : groups.length === 0 ? (
        <p className="muted">Todavía no hay ventas.</p>
      ) : (
        <div className="stack">
          {groups.map((group) => (
            <div key={group.key} className="lrow">
              <div className="lrow__head">
                <span>
                  <b>{group.label}</b>
                  {group.sublabel && <span className="lrow__sub" style={{ display: 'block' }}>{group.sublabel}</span>}
                </span>
                <span className="chip chip--blue">
                  {group.ticketsSold} {group.ticketsSold === 1 ? 'entrada' : 'entradas'}
                  {group.compTickets > 0 && ` +${group.compTickets} cort.`}
                </span>
              </div>
              <div className="report-stat">
                <span className="report-stat__item">
                  Cobrado <strong className="stat-ok">{formatMoney(group.paidCents)}</strong>
                </span>
                {group.pendingCents > 0 && (
                  <span className="report-stat__item">
                    Por cobrar <strong className="stat-warn">{formatMoney(group.pendingCents)}</strong>
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
