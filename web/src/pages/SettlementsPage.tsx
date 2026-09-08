import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, History, Mail } from 'lucide-react'

import { ApiError, activeSeason, api } from '../api/client'
import { useIsDesktop } from '../lib/viewport'
import type {
  PaymentMethod,
  Settlement,
  SettlementReportRow,
  TimelineItem,
} from '../api/client'
import { dayLabel, daysAgo, formatMoney, pesosToCents, timeShort } from '../lib/format'
import { ActionPanel } from '../ui/ActionPanel'
import { EmptyState, FilterChips, ProgressBar, SegmentedToggle } from '../ui/controls'
import { BalanceChip } from '../ui/StatusChip'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** La temporada en curso, la que dirección marcó activa. */
function useSeason() {
  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.listSeasons() })
  return activeSeason(seasons.data?.seasons)
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

export function RegisterSheet({
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
  // El monto arranca cargado con la deuda: el caso normal es que rinda todo, y
  // así el paso más frecuente es un solo clic en Confirmar (C14).
  const [amount, setAmount] = useState(debt > 0 ? String(debt / 100) : '')
  const [method, setMethod] = useState<PaymentMethod>('transfer')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const cents = pesosToCents(amount) ?? 0
  const todo = debt > 0 && cents === debt
  const settlesAll = debt > 0 && cents >= debt
  const restante = debt - cents

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
      // La home muestra la misma alerta y el mismo badge (C12).
      void queryClient.invalidateQueries({ queryKey: ['home'] })
      onClose()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar la rendición.'),
  })

  return (
    <ActionPanel open onClose={onClose} label={`Registrar rendición de ${row.seller_name}`}>
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

      <label className="field">
        <span className="field__label">Cuánto rinde</span>
        <input
          className="field__input field__input--amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="30000"
          autoFocus
        />
      </label>

      {debt > 0 && (
        <div className="quickamt">
          <button
            className={`fchip${todo ? ' fchip--on fchip--ink' : ''}`}
            type="button"
            onClick={() => setAmount(String(debt / 100))}
          >
            Todo ({formatMoney(debt)})
          </button>
          <button
            className={`fchip${todo ? '' : ' fchip--on fchip--ink'}`}
            type="button"
            onClick={() => setAmount('')}
          >
            Otra cifra
          </button>
        </div>
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

      <div className="panel-foot">
        <span className="panel-foot__note">
          {cents <= 0 ? (
            'Poné cuánto rinde para confirmar.'
          ) : settlesAll ? (
            <>
              Después de esto <b className="stat-ok">queda al día</b>.
            </>
          ) : (
            <>
              Le van a quedar <b>{formatMoney(restante)}</b> por rendir.
            </>
          )}
        </span>
        <button className="button button--ghost panel-foot__btn" type="button" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="button panel-foot__btn"
          type="button"
          disabled={cents <= 0 || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Registrando…' : 'Confirmar'}
        </button>
      </div>

    </ActionPanel>
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

export function SettlementsPage({
  embedded = false,
  selectedId,
}: {
  /** Dentro del master-detail de escritorio: el encabezado lo pone la pantalla. */
  embedded?: boolean
  selectedId?: number
} = {}) {
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
      {!embedded && (
        <div className="page-head">
          <h1 className="page-title">Rendiciones</h1>
          <Link className="hbtn" to="/panel/rendiciones/historial">
            <History size={13} aria-hidden /> Historial
          </Link>
        </div>
      )}

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
              <div className="cardgrid">
              {debtors.map((row) => (
                <div
                  key={row.seller_id}
                  className={`debt-card${row.seller_id === selectedId ? ' debt-card--sel' : ''}`}
                >
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
              </div>
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
              <div className="cardgrid">
              {upToDate.map((row) => (
                <button
                  key={row.seller_id}
                  className={`okrow${row.seller_id === selectedId ? ' okrow--sel' : ''}`}
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
              </div>
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

export function SettlementDetailPage({
  sellerId: sellerIdProp,
  embedded = false,
}: {
  sellerId?: number
  /** En el master-detail el "‹ Rendiciones" sobra: la lista está al lado. */
  embedded?: boolean
} = {}) {
  const queryClient = useQueryClient()
  const { sellerId: raw } = useParams()
  const sellerId = sellerIdProp ?? Number(raw)
  const season = useSeason()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const detail = useQuery({
    queryKey: ['seller-detail', season?.id, sellerId],
    queryFn: () => api.sellerDetail(sellerId, season!.id),
    enabled: season !== undefined && Number.isInteger(sellerId),
  })

  const recordar = useMutation({
    mutationFn: () => api.remindSeller(sellerId, season!.id),
    onSuccess: ({ email_status }) => {
      setAviso(
        email_status === 'sent'
          ? 'Recordatorio enviado con el detalle.'
          : 'El recordatorio no salió. Probá de nuevo.',
      )
      void queryClient.invalidateQueries({ queryKey: ['seller-detail'] })
    },
    onError: () => setAviso('El recordatorio no salió. Probá de nuevo.'),
  })

  if (detail.isPending) return <p className="muted">Cargando…</p>
  if (!detail.data) return <p className="alert">No encontramos a esa corista.</p>
  const d = detail.data

  // La fila que espera el pop-up de rendición.
  const row: SettlementReportRow = {
    seller_id: d.seller_id,
    seller_name: d.seller_name,
    collected_cents: d.collected_cents,
    pending_cents: d.uncollected_cents,
    settled_cents: d.settled_cents,
    balance_cents: d.balance_cents,
  }

  return (
    <div className="rd">
      {!embedded && (
        <p style={{ margin: '0 0 8px' }}>
          <Link
            to="/panel/rendiciones"
            style={{ color: 'var(--ink)', fontWeight: 700, textDecoration: 'none', fontSize: 13 }}
          >
            ‹ Rendiciones
          </Link>
        </p>
      )}

      <div className="rd__h">
        <span className={`ini ini--lg${d.balance_cents > 0 ? ' ini--warn' : ''}`}>
          {initials(d.seller_name)}
        </span>
        <span className="rd__who">
          <b>{d.seller_name}</b>
          <span>
            Corista · {d.tickets_sold}{' '}
            {d.tickets_sold === 1 ? 'entrada vendida' : 'entradas vendidas'} esta temporada
          </span>
        </span>
        <span className="rd__acts">
          {d.balance_cents > 0 && (
            <button
              className="button button--ghost"
              type="button"
              disabled={recordar.isPending}
              onClick={() => recordar.mutate()}
            >
              <Mail size={14} aria-hidden /> {recordar.isPending ? 'Enviando…' : 'Recordar'}
            </button>
          )}
          {/* Quien está al día no necesita que la pantalla le pida una
              rendición; la acción sigue disponible en voz baja, para corregir
              un monto mal cargado o registrar una entrega adelantada. */}
          {d.balance_cents > 0 ? (
            <button className="button" type="button" onClick={() => setSheetOpen(true)}>
              Registrar rendición
            </button>
          ) : (
            <button className="linkbtn" type="button" onClick={() => setSheetOpen(true)}>
              Registrar una rendición igual
            </button>
          )}
        </span>
      </div>

      {aviso && (
        <p className="rd__aviso" role="status">
          {aviso}
        </p>
      )}

      <div className="kbar">
        <div className="kbar__k">
          <b>{formatMoney(d.collected_cents)}</b>
          <span>Cobró</span>
          <i>
            {d.paid_sales} {d.paid_sales === 1 ? 'venta' : 'ventas'}
          </i>
        </div>
        <div className="kbar__k">
          <b className="stat-ok">{formatMoney(d.settled_cents)}</b>
          <span>Rindió</span>
          <i>{d.settled_cents === 0 ? 'Nunca' : 'En esta temporada'}</i>
        </div>
        <div className="kbar__k">
          <b className="stat-warn">{formatMoney(Math.max(d.balance_cents, 0))}</b>
          <span>Debe</span>
          <i>{d.last_paid_at ? `Cobró ${daysAgo(d.last_paid_at)}` : 'Sin cobros'}</i>
        </div>
        <div className="kbar__k">
          <b>{formatMoney(d.uncollected_cents)}</b>
          <span>Sin cobrar</span>
          <i>No exigible aún</i>
        </div>
      </div>

      <div className="rd__body">
        <div className="rd__sect">
          <div className="rd__sh">
            <b>De dónde sale la deuda</b>
            <span>
              {d.debt_sources.length}{' '}
              {d.debt_sources.length === 1 ? 'venta cobrada' : 'ventas cobradas'}
            </span>
          </div>
          {d.debt_sources.length === 0 ? (
            <p className="rd__vacio">Todavía no cobró ninguna venta de esta temporada.</p>
          ) : (
            <>
              {d.debt_sources.map((f) => (
                <div key={f.sale_id} className="rd__row">
                  <span className="rd__mid">
                    <b>{f.buyer_name}</b>
                    <span>
                      {f.quantity} {f.quantity === 1 ? 'entrada' : 'entradas'} · {f.function_name}
                    </span>
                  </span>
                  <span className="rd__amt">{formatMoney(f.paid_cents)}</span>
                  <span className="rd__when">{f.paid_at ? dayLabel(f.paid_at) : '—'}</span>
                </div>
              ))}
              <div className="rd__tot">
                <span>Total a rendir</span>
                <b>{formatMoney(Math.max(d.balance_cents, 0))}</b>
              </div>
            </>
          )}
        </div>

        <div className="rd__sect">
          <div className="rd__sh">
            <b>Su historial</b>
            <span>{season?.name}</span>
          </div>
          {d.timeline.length === 0 ? (
            <p className="rd__vacio">Todavía no hay movimientos en esta temporada.</p>
          ) : (
            <div className="tl">
              {d.timeline.map((item, i) => (
                <div key={`${item.kind}-${item.at}-${i}`} className="tl__r">
                  <span className={`tl__dot tl__dot--${item.kind}`} aria-hidden />
                  <span className="tl__mid">
                    <b>{tituloTimeline(item)}</b>
                    <span>
                      {dayLabel(item.at)}, {timeShort(item.at)}
                      {item.method && ` · ${item.method === 'transfer' ? 'transferencia' : 'efectivo'}`}
                    </span>
                    {item.notes && <span className="tl__note">“{item.notes}”</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
          {d.settled_cents === 0 && d.first_paid_at && (
            <p className="rd__vacio">
              Todavía no rindió nada. Tiene plata cobrada desde {daysAgo(d.first_paid_at)}.
            </p>
          )}
        </div>
      </div>

      {sheetOpen && season && (
        <RegisterSheet row={row} seasonId={season.id} onClose={() => setSheetOpen(false)} />
      )}
    </div>
  )
}

/** El título de cada movimiento de la línea de tiempo. */
function tituloTimeline(item: TimelineItem): string {
  switch (item.kind) {
    default:
      return 'Movimiento'
    case 'settlement':
      return `Rindió ${formatMoney(item.amount_cents ?? 0)}`
    case 'reminder':
      return item.detail === 'failed'
        ? 'Recordatorio que no salió'
        : `Recordatorio enviado por ${formatMoney(item.amount_cents ?? 0)}`
    case 'last_paid':
      return 'Última venta cobrada'
    case 'first_paid':
      return 'Primera venta cobrada'
  }
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

/* ========================================================================== *
 * 4. La pantalla de rendiciones (C11)
 * ========================================================================== */

/**
 * El panel cuando no hay nadie elegido. En vez de una caja vacía con una
 * frase: el ranking de deudas con barras comparables —quién debe más se ve de
 * un vistazo— y las dos acciones que aplican a todas.
 */
function SinSeleccion() {
  const queryClient = useQueryClient()
  const season = useSeason()
  const report = useReport(season?.id)
  const [aviso, setAviso] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)

  const rows = report.data?.rows ?? []
  const deudoras = rows
    .filter((r) => r.balance_cents > 0)
    .sort((a, b) => b.balance_cents - a.balance_cents)
  const total = deudoras.reduce((acc, r) => acc + r.balance_cents, 0)
  const cobrado = rows.reduce((acc, r) => acc + r.collected_cents, 0)
  const mayor = deudoras[0]?.balance_cents ?? 1
  const porcentaje = cobrado > 0 ? Math.round((total / cobrado) * 100) : 0

  const recordarTodas = useMutation({
    mutationFn: () => api.remindAll(season!.id),
    onSuccess: ({ sent, failed }) => {
      setConfirmando(false)
      setAviso(
        failed === 0
          ? `Recordatorio enviado a ${sent} ${sent === 1 ? 'corista' : 'coristas'}.`
          : `Salieron ${sent} y fallaron ${failed}. Probá de nuevo con las que faltan.`,
      )
      void queryClient.invalidateQueries({ queryKey: ['seller-detail'] })
    },
    onError: () => {
      setConfirmando(false)
      setAviso('No se pudieron enviar los recordatorios.')
    },
  })

  /** Exporta lo que se ve: quién, cuánto cobró, cuánto rindió y cuánto debe. */
  function exportar() {
    const filas = [
      ['Corista', 'Cobró', 'Rindió', 'Debe'],
      ...deudoras.map((r) => [
        r.seller_name,
        String(r.collected_cents / 100),
        String(r.settled_cents / 100),
        String(r.balance_cents / 100),
      ]),
    ]
    const csv = filas.map((f) => f.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `rendiciones-${season?.name.replace(/\s+/g, '-').toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (deudoras.length === 0) {
    return (
      <EmptyState icon={<Check size={18} />} title="Nadie debe rendir">
        Toda la plata cobrada ya está en manos de dirección.
      </EmptyState>
    )
  }

  return (
    <div className="rank">
      <div className="rank__h">
        <p className="rank__n">{formatMoney(total)}</p>
        <p className="rank__l">
          repartidos entre {deudoras.length}{' '}
          {deudoras.length === 1 ? 'corista' : 'coristas'} · el {porcentaje}% de lo cobrado en la
          temporada
        </p>
        {aviso && (
          <p className="rd__aviso" role="status">
            {aviso}
          </p>
        )}
        <div className="rank__acts">
          {confirmando ? (
            <>
              <button
                className="button"
                type="button"
                disabled={recordarTodas.isPending}
                onClick={() => recordarTodas.mutate()}
              >
                {recordarTodas.isPending
                  ? 'Enviando…'
                  : `Sí, mandar ${deudoras.length} recordatorios`}
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => setConfirmando(false)}
              >
                Cancelar
              </button>
            </>
          ) : (
            <>
              {/* Manda emails de verdad a varias personas: se confirma antes. */}
              <button className="button" type="button" onClick={() => setConfirmando(true)}>
                <Mail size={14} aria-hidden /> Recordar a las {deudoras.length}
              </button>
              <button className="button button--ghost" type="button" onClick={exportar}>
                Exportar detalle
              </button>
            </>
          )}
        </div>
      </div>

      {deudoras.map((r, i) => (
        <Link key={r.seller_id} className="rank__r" to={`/panel/rendiciones/${r.seller_id}`}>
          <span className="rank__pos">{i + 1}</span>
          <span className="rank__mid">
            <b>{r.seller_name}</b>
            <span>
              {r.settled_cents === 0
                ? 'Nunca rindió'
                : `Rindió ${formatMoney(r.settled_cents)}`}{' '}
              · cobró {formatMoney(r.collected_cents)}
            </span>
          </span>
          <span className="rank__track">
            <i style={{ width: `${(r.balance_cents / mayor) * 100}%` }} />
          </span>
          <span className="rank__amt">{formatMoney(r.balance_cents)}</span>
        </Link>
      ))}
      <p className="rank__hint">
        Elegí una corista para ver de dónde sale su deuda y registrar una entrega.
      </p>
    </div>
  )
}

/**
 * Una sola URL para las dos formas. En escritorio `/panel/rendiciones/:id` es
 * lista + detalle lado a lado, y sin id la lista con una invitación a elegir;
 * en celular esa misma URL es la vista de detalle sola, como siempre. Un solo
 * juego de rutas: el link que alguien manda por WhatsApp abre lo mismo en los
 * dos lados.
 */
export function SettlementsScreen() {
  const { sellerId: raw } = useParams()
  const sellerId = raw ? Number(raw) : undefined
  const escritorio = useIsDesktop()

  if (!escritorio) {
    return sellerId !== undefined ? <SettlementDetailPage /> : <SettlementsPage />
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Rendiciones</h1>
        <Link className="hbtn" to="/panel/rendiciones/historial">
          <History size={13} aria-hidden /> Historial general
        </Link>
      </div>
      <div className="md">
        <div className="md__list">
          <SettlementsPage embedded selectedId={sellerId} />
        </div>
        <div className="md__detail md__detail--full">
          {sellerId !== undefined ? (
            <SettlementDetailPage sellerId={sellerId} embedded />
          ) : (
            <SinSeleccion />
          )}
        </div>
      </div>
    </>
  )
}
