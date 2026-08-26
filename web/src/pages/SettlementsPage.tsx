import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, History } from 'lucide-react'

import { ApiError, api } from '../api/client'
import type { PaymentMethod, Settlement, SettlementReportRow } from '../api/client'
import { dayLabel, formatMoney, pesosToCents, timeShort } from '../lib/format'
import { BottomSheet } from '../ui/BottomSheet'
import { EmptyState, FilterChips, ProgressBar, SegmentedToggle } from '../ui/controls'
import { BalanceChip } from '../ui/StatusChip'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** Temporada activa (la mas nueva). */
function useSeason() {
  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.listSeasons() })
  return seasons.data?.seasons[0]
}

function useReport(seasonId: number | undefined) {
  return useQuery({
    queryKey: ['settlements-report', seasonId],
    queryFn: () => api.settlementsReport(seasonId!),
    enabled: seasonId !== undefined,
  })
}

/* ========================================================================== *
 * Sheet de registro (C5.4): monto precargado, "Todo ($X)" / "Otra cifra",
 * preview "queda al dia" cuando salda.
 * ========================================================================== */

function RegisterSheet({
  row,
  seasonId,
  onClose,
}: {
  row: SettlementReportRow
  seasonId: number
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const debt = Math.max(row.balance_cents, 0)
  const [mode, setMode] = useState<'todo' | 'otra'>(debt > 0 ? 'todo' : 'otra')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('transfer')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const cents = mode === 'todo' ? debt : (pesosToCents(amount) ?? 0)
  const settlesAll = debt > 0 && cents >= debt

  const create = useMutation({
    mutationFn: () =>
      api.createSettlement({
        seller_id: row.seller_id,
        season_id: seasonId,
        amount_cents: cents,
        method,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settlements-report', seasonId] })
      void queryClient.invalidateQueries({ queryKey: ['settlements-history'] })
      // La alerta "debe rendir" del panel de Dirección (C9) sale de la misma
      // plata: si no se invalida, queda mostrando una deuda ya saldada.
      void queryClient.invalidateQueries({ queryKey: ['attention'] })
      onClose()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar la rendición.'),
  })

  return (
    <BottomSheet open onClose={onClose} label={`Registrar rendición de ${row.seller_name}`}>
      <div className="sheet-head">
        <span className="ini">{initials(row.seller_name)}</span>
        <span>
          <b>{row.seller_name}</b>
          <span>
            {debt > 0 ? `Debe ${formatMoney(debt)}` : 'Está al día'} · cobró{' '}
            {formatMoney(row.collected_cents)}
          </span>
        </span>
      </div>

      {error && (
        <p className="alert" role="alert" style={{ margin: '12px 0 0' }}>
          {error}
        </p>
      )}

      {debt > 0 && (
        <div style={{ marginTop: 12 }}>
          <FilterChips<'todo' | 'otra'>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'todo', label: `Todo (${formatMoney(debt)})` },
              { value: 'otra', label: 'Otra cifra' },
            ]}
          />
        </div>
      )}

      {(mode === 'otra' || debt === 0) && (
        <label className="field">
          <span className="field__label">Monto ($)</span>
          <input
            className="field__input"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={debt > 0 ? String(debt / 100) : '30000'}
            autoFocus
          />
        </label>
      )}

      <div className="field">
        <span className="field__label">Método</span>
        <SegmentedToggle<PaymentMethod>
          value={method}
          onChange={setMethod}
          options={[
            { value: 'transfer', label: 'Transferencia' },
            { value: 'cash', label: 'Efectivo' },
          ]}
        />
      </div>

      <label className="field">
        <span className="field__label">Nota (opcional)</span>
        <input
          className="field__input"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="En el ensayo del jueves"
        />
      </label>

      {settlesAll && (
        <p className="settle-preview">✓ Después de esto {row.seller_name} queda al día.</p>
      )}

      <button
        className="button"
        style={{ marginTop: 12 }}
        type="button"
        disabled={cents <= 0 || create.isPending}
        onClick={() => create.mutate()}
      >
        {create.isPending ? 'Registrando…' : `Registrar ${cents > 0 ? formatMoney(cents) : 'rendición'}`}
      </button>
    </BottomSheet>
  )
}

/* ========================================================================== *
 * Filas de historial (C5.5)
 * ========================================================================== */

function HistoryRow({ settlement, withName }: { settlement: Settlement; withName: boolean }) {
  return (
    <div className="hrow">
      <span className="hrow__ic" aria-hidden>
        <Check size={14} />
      </span>
      <div className="hrow__mid">
        {withName && <>{settlement.seller_name} rindió </>}
        {!withName && <>Rindió </>}
        <span className="amt">{formatMoney(settlement.amount_cents)}</span> ·{' '}
        {settlement.method === 'cash' ? 'efectivo' : 'transferencia'}
        {settlement.notes && <div className="hrow__note">“{settlement.notes}”</div>}
      </div>
      <span className="hrow__when">
        {dayLabel(settlement.created_at).replace(/^Hoy · |^Ayer · /, '')}
        <br />
        {timeShort(settlement.created_at)}
      </span>
    </div>
  )
}

/** Agrupa por dia, ya viene ordenado descendente del server. */
function groupByDay(settlements: Settlement[]): Array<{ label: string; items: Settlement[] }> {
  const groups: Array<{ label: string; items: Settlement[] }> = []
  for (const settlement of settlements) {
    const label = dayLabel(settlement.created_at)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(settlement)
    else groups.push({ label, items: [settlement] })
  }
  return groups
}

/* ========================================================================== *
 * 1. Listado principal
 * ========================================================================== */

export function SettlementsPage() {
  const navigate = useNavigate()
  const season = useSeason()
  const report = useReport(season?.id)
  const [sheetFor, setSheetFor] = useState<SettlementReportRow | null>(null)

  const rows = report.data?.rows ?? []
  const debtors = rows.filter((r) => r.balance_cents > 0)
  const upToDate = rows.filter((r) => r.balance_cents <= 0)
  const totalDebt = debtors.reduce((acc, r) => acc + r.balance_cents, 0)
  const totalCollected = rows.reduce((acc, r) => acc + r.collected_cents, 0)
  const totalSettled = rows.reduce((acc, r) => acc + r.settled_cents, 0)
  const totalPending = rows.reduce((acc, r) => acc + r.pending_cents, 0)

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Rendiciones</h1>
        <Link className="hbtn" to="/panel/rendiciones/historial">
          <History size={13} aria-hidden /> Historial
        </Link>
      </div>

      {report.isPending ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          <div className="settle-sum">
            <div className="settle-sum__big">
              <b className={totalDebt === 0 ? 'ok' : ''}>{formatMoney(totalDebt)}</b>
              <span>Por rendir</span>
            </div>
            <ProgressBar value={totalSettled} max={totalCollected} tone="ok" />
            <div className="settle-sum__leg">
              <span>
                Rendido <b className="stat-ok">{formatMoney(totalSettled)}</b>
              </span>
              <span>
                Cobrado <b>{formatMoney(totalCollected)}</b>
              </span>
            </div>
          </div>

          {debtors.length > 0 && (
            <>
              <div className="ghead"><b>Deben rendir · {debtors.length}</b></div>
              {debtors.map((row) => (
                <div key={row.seller_id} className="debt-card">
                  <button
                    style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }}
                    type="button"
                    onClick={() => navigate(`/panel/rendiciones/${row.seller_id}`)}
                  >
                    <div className="debt-card__head">
                      <b>{row.seller_name}</b>
                      <BalanceChip balanceCents={row.balance_cents} />
                    </div>
                    <div className="debt-card__det">
                      Cobró <b>{formatMoney(row.collected_cents)}</b> · rindió{' '}
                      <b>{formatMoney(row.settled_cents)}</b>
                    </div>
                  </button>
                  <button className="button" type="button" onClick={() => setSheetFor(row)}>
                    Registrar rendición
                  </button>
                </div>
              ))}
            </>
          )}

          {debtors.length === 0 && (
            <div style={{ marginTop: 12 }}>
              <EmptyState icon={<Check size={18} />} title="Nadie debe rendir">
                Toda la plata cobrada ya está en manos de dirección.
              </EmptyState>
            </div>
          )}

          {upToDate.length > 0 && (
            <>
              <div className="ghead"><b>Al día · {upToDate.length}</b></div>
              {upToDate.map((row) => (
                <button
                  key={row.seller_id}
                  className="okrow"
                  type="button"
                  onClick={() => navigate(`/panel/rendiciones/${row.seller_id}`)}
                >
                  <span className="okrow__l">
                    <b>{row.seller_name}</b>
                    <span>
                      {row.collected_cents > 0
                        ? `Cobró ${formatMoney(row.collected_cents)} · rindió ${formatMoney(row.settled_cents)}`
                        : 'Todavía no cobró ventas'}
                    </span>
                  </span>
                  <span className="okrow__r">
                    <BalanceChip balanceCents={row.balance_cents} />
                    <span className="muted" aria-hidden>›</span>
                  </span>
                </button>
              ))}
            </>
          )}

          {totalPending > 0 && (
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
              Aparte, compradores deben {formatMoney(totalPending)} a las coristas (no exigible aún).
            </p>
          )}
        </>
      )}

      {sheetFor && season && (
        <RegisterSheet row={sheetFor} seasonId={season.id} onClose={() => setSheetFor(null)} />
      )}
    </>
  )
}

/* ========================================================================== *
 * 2. Detalle por corista
 * ========================================================================== */

export function SettlementDetailPage() {
  const { sellerId: raw } = useParams()
  const sellerId = Number(raw)
  const season = useSeason()
  const report = useReport(season?.id)
  const [sheetOpen, setSheetOpen] = useState(false)

  const salesReport = useQuery({ queryKey: ['sales-report'], queryFn: () => api.salesReport() })
  const history = useQuery({
    queryKey: ['settlements-history', season?.id, sellerId],
    queryFn: () => api.listSettlements(season!.id, sellerId),
    enabled: season !== undefined && Number.isInteger(sellerId),
  })

  const row = report.data?.rows.find((r) => r.seller_id === sellerId)
  if (report.isPending) return <p className="muted">Cargando…</p>
  if (!row) return <p className="alert">No encontramos a esa corista.</p>

  const salesCount = (salesReport.data?.rows ?? [])
    .filter((r) => r.seller_id === sellerId)
    .reduce((acc, r) => acc + r.tickets_sold, 0)
  const settlements = history.data?.settlements ?? []

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        <Link to="/panel/rendiciones" style={{ color: 'var(--ink)', fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
          ‹ Rendiciones
        </Link>
      </p>

      <div className="profile">
        <div className="profile__head">
          <span className="ini">{initials(row.seller_name)}</span>
          <span>
            <b>{row.seller_name}</b>
            <span className="profile__role">
              Corista · {salesCount} {salesCount === 1 ? 'entrada vendida' : 'entradas vendidas'} esta temporada
            </span>
          </span>
          <span className="profile__chip">
            <BalanceChip balanceCents={row.balance_cents} />
          </span>
        </div>
        <div className="kpis3">
          <div className="k"><b>{formatMoney(row.collected_cents)}</b><span>Cobró</span></div>
          <div className="k"><b className="g">{formatMoney(row.settled_cents)}</b><span>Rindió</span></div>
          <div className="k"><b className="y">{formatMoney(Math.max(row.balance_cents, 0))}</b><span>Debe</span></div>
        </div>
        {/* CTA siempre disponible: cubre correcciones aunque este al dia. */}
        <button className="button" type="button" onClick={() => setSheetOpen(true)}>
          Registrar rendición
        </button>
        {row.pending_cents > 0 && (
          <p className="profile__note">
            Aparte, compradores le deben {formatMoney(row.pending_cents)} (no exigible aún)
          </p>
        )}
      </div>

      <div className="ghead"><b>Su historial</b></div>
      {history.isPending ? (
        <p className="muted">Cargando…</p>
      ) : settlements.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center', fontSize: 11.5 }}>
          Todavía no rindió nada.
        </p>
      ) : (
        <>
          {settlements.map((settlement) => (
            <HistoryRow key={settlement.id} settlement={settlement} withName={false} />
          ))}
          {settlements.length === 1 && (
            <p className="muted" style={{ textAlign: 'center', fontSize: 10.5 }}>
              Una sola rendición hasta ahora
            </p>
          )}
        </>
      )}

      {sheetOpen && season && (
        <RegisterSheet row={row} seasonId={season.id} onClose={() => setSheetOpen(false)} />
      )}
    </>
  )
}

/* ========================================================================== *
 * 3. Historial general
 * ========================================================================== */

export function SettlementsHistoryPage() {
  const season = useSeason()
  const report = useReport(season?.id)
  const [sellerFilter, setSellerFilter] = useState<string>('all')

  const sellerId = sellerFilter === 'all' ? undefined : Number(sellerFilter)
  const history = useQuery({
    queryKey: ['settlements-history', season?.id, sellerId ?? 'all'],
    queryFn: () => api.listSettlements(season!.id, sellerId),
    enabled: season !== undefined,
  })

  // Chips: Todas + las coristas con movimientos.
  const withActivity = (report.data?.rows ?? []).filter((r) => r.settled_cents > 0)
  const settlements = history.data?.settlements ?? []
  const groups = groupByDay(settlements)

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        <Link to="/panel/rendiciones" style={{ color: 'var(--ink)', fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
          ‹ Rendiciones
        </Link>
      </p>
      <h1 className="page-title">Historial</h1>

      <FilterChips
        value={sellerFilter}
        onChange={setSellerFilter}
        options={[
          { value: 'all', label: 'Todas' },
          ...withActivity.map((r) => ({ value: String(r.seller_id), label: r.seller_name })),
        ]}
      />

      {history.isPending ? (
        <p className="muted" style={{ marginTop: 10 }}>Cargando…</p>
      ) : settlements.length === 0 ? (
        <p className="muted" style={{ marginTop: 10 }}>Todavía no hay rendiciones registradas.</p>
      ) : (
        groups.map((group) => (
          <div key={group.label}>
            <div className="dg">{group.label}</div>
            {group.items.map((settlement) => (
              <HistoryRow key={settlement.id} settlement={settlement} withName />
            ))}
          </div>
        ))
      )}
    </>
  )
}
