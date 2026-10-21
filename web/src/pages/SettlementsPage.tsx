import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '../api/client'
import type { PaymentMethod, Settlement, SettlementReportRow, TimelineItem } from '../api/client'
import { useSeason } from '../season/SeasonProvider'
import { useIsDesktop } from '../lib/viewport'
import { dayAndMonthShort, dayLabel, daysAgo, formatMoney, pesosToCents, timeShort } from '../lib/format'
import { Button, Seg } from '../ui/Button'
import { DataList } from '../ui/DataList'
import { Figure, SubFigs } from '../ui/Figure'
import { Label } from '../ui/Label'
import { Menu } from '../ui/Menu'
import { Modal } from '../ui/Modal'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'
import { Drawer, Sheet } from '../ui/Sheet'
import { Status } from '../ui/Status'

// Rendiciones (C19 §5.7, design/acapelius-B-referencia.html §03). Son plata y
// movimientos, no entidades: van en FILA. El detalle de una corista se abre
// al costado (drawer) o desde abajo (hoja), sin perder la lista de atrás.

const sinCentavos = (cents: number) => formatMoney(cents).replace('$', '').trim()
const metodo = (m?: PaymentMethod) => (m === 'cash' ? 'efectivo' : 'transferencia')

function useReport(seasonId: number | undefined) {
  return useQuery({
    queryKey: ['settlements-report', seasonId],
    queryFn: () => api.settlementsReport(seasonId!),
    enabled: seasonId !== undefined,
  })
}

/* ========================================================================== *
 * Registrar una rendición: el monto arranca con la deuda, que es el caso
 * normal, así el paso más frecuente es un solo toque en Confirmar.
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
  const [amount, setAmount] = useState(debt > 0 ? String(debt / 100) : '')
  const [method, setMethod] = useState<PaymentMethod>('transfer')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const cents = pesosToCents(amount) ?? 0
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
      void queryClient.invalidateQueries({ queryKey: ['seller-detail'] })
      // La alerta "debe rendir" de Dirección e Inicio sale de la misma plata.
      void queryClient.invalidateQueries({ queryKey: ['attention'] })
      void queryClient.invalidateQueries({ queryKey: ['home'] })
      void queryClient.invalidateQueries({ queryKey: ['direccion'] })
      onClose()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar la rendición.'),
  })

  return (
    <Modal
      open
      onClose={onClose}
      label="Registrar rendición"
      title={row.seller_name}
      sub={`${debt > 0 ? `Debe ${formatMoney(debt)}` : 'Está al día'} · cobró ${formatMoney(row.collected_cents)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button go disabled={cents <= 0 || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Registrando…' : 'Confirmar'}
          </Button>
        </>
      }
    >
      {error && (
        <p className="st st--bad" role="alert" style={{ margin: 0, whiteSpace: 'normal' }}>
          {error}
        </p>
      )}
      <label className="field" style={{ margin: 0 }}>
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
        <Seg<'todo' | 'otra'>
          label="Monto"
          value={cents === debt ? 'todo' : 'otra'}
          onChange={(v) => setAmount(v === 'todo' ? String(debt / 100) : '')}
          options={[
            { value: 'todo', label: `Todo (${formatMoney(debt)})` },
            { value: 'otra', label: 'Otra cifra' },
          ]}
        />
      )}
      <Seg<PaymentMethod>
        label="Método"
        value={method}
        onChange={setMethod}
        options={[
          { value: 'transfer', label: 'Transferencia' },
          { value: 'cash', label: 'Efectivo' },
        ]}
      />
      <label className="field" style={{ margin: 0 }}>
        <span className="field__label">Nota (opcional)</span>
        <input
          className="field__input"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="En el ensayo del jueves"
        />
      </label>
      <p className="rs" style={{ margin: 0, whiteSpace: 'normal' }} aria-live="polite">
        {cents <= 0
          ? 'Poné cuánto rinde para confirmar.'
          : settlesAll
            ? 'Después de esto queda al día.'
            : `Le van a quedar ${formatMoney(restante)} por rendir.`}
      </p>
    </Modal>
  )
}

/* ========================================================================== *
 * El detalle de una corista
 * ========================================================================== */

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
        : `Recordatorio por ${formatMoney(item.amount_cents ?? 0)}`
    case 'last_paid':
      return 'Última venta cobrada'
    case 'first_paid':
      return 'Primera venta cobrada'
  }
}

function DetalleCorista({
  sellerId,
  seasonId,
  onClose,
  onRegistrar,
}: {
  sellerId: number
  seasonId: number
  onClose: () => void
  onRegistrar: (row: SettlementReportRow) => void
}) {
  const escritorio = useIsDesktop()
  const queryClient = useQueryClient()
  const [aviso, setAviso] = useState<string | null>(null)

  const detail = useQuery({
    queryKey: ['seller-detail', seasonId, sellerId],
    queryFn: () => api.sellerDetail(sellerId, seasonId),
  })
  const recordar = useMutation({
    mutationFn: () => api.remindSeller(sellerId, seasonId),
    onSuccess: ({ email_status }) => {
      setAviso(
        email_status === 'sent'
          ? 'Le mandamos el recordatorio con el detalle.'
          : email_status === 'preview'
            ? 'En la demo no se mandan mails: el recordatorio quedó registrado.'
            : 'El recordatorio no salió. Probá de nuevo.',
      )
      void queryClient.invalidateQueries({ queryKey: ['seller-detail'] })
    },
    onError: () => setAviso('El recordatorio no salió. Probá de nuevo.'),
  })

  const d = detail.data
  const debe = d ? Math.max(d.balance_cents, 0) : 0
  const ultima = d?.timeline.filter((t) => t.kind === 'settlement').at(-1)

  const cuerpo: ReactNode = !d ? (
    <p className="rs">{detail.isPending ? 'Cargando…' : 'No encontramos a esa corista.'}</p>
  ) : (
    <>
      {aviso && (
        <p className="st st--ok" role="status" style={{ margin: 0, whiteSpace: 'normal' }}>
          {aviso}
        </p>
      )}
      <Figure label={debe > 0 ? 'Debe' : 'Al día'} tone={debe > 0 ? 'warn' : 'ok'}>
        {formatMoney(debe)}
      </Figure>
      <DataList
        rows={[
          ['Vendió', `${d.tickets_sold} ${d.tickets_sold === 1 ? 'entrada' : 'entradas'}`],
          ['Cobró', `${formatMoney(d.collected_cents)} · ${d.paid_sales} ${d.paid_sales === 1 ? 'venta' : 'ventas'}`],
          ['Ya rindió', formatMoney(d.settled_cents)],
          ['Última rendición', ultima ? `${dayAndMonthShort(ultima.at)} · ${metodo(ultima.method)}` : 'Todavía no rindió'],
          ['Sin cobrar a compradores', `${formatMoney(d.uncollected_cents)} · no exigible aún`],
        ]}
      />
      <div>
        <Label>De dónde sale la deuda</Label>
        <div className="mini" style={{ marginTop: 7 }}>
          {d.debt_sources.length === 0 ? (
            <Row title="Todavía no cobró ninguna venta" />
          ) : (
            d.debt_sources.map((f) => (
              <Row
                key={f.sale_id}
                title={f.buyer_name}
                sub={`${f.quantity} ${f.quantity === 1 ? 'entrada' : 'entradas'} · ${f.paid_at ? dayAndMonthShort(f.paid_at) : f.function_name}`}
                amount={sinCentavos(f.paid_cents)}
              />
            ))
          )}
        </div>
      </div>
      {d.timeline.length > 0 && (
        <div>
          <Label>Su historial</Label>
          <div className="mini" style={{ marginTop: 7 }}>
            {d.timeline.map((item, i) => (
              <Row
                key={`${item.kind}-${item.at}-${i}`}
                title={tituloTimeline(item)}
                sub={[`${dayLabel(item.at)}, ${timeShort(item.at)}`, item.method && metodo(item.method), item.notes && `“${item.notes}”`]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )

  const fila: SettlementReportRow | null = d
    ? {
        seller_id: d.seller_id,
        seller_name: d.seller_name,
        collected_cents: d.collected_cents,
        pending_cents: d.uncollected_cents,
        settled_cents: d.settled_cents,
        balance_cents: d.balance_cents,
      }
    : null

  const acciones = fila ? (
    <>
      {debe > 0 && (
        <Button disabled={recordar.isPending} onClick={() => recordar.mutate()}>
          {recordar.isPending ? 'Enviando…' : 'Recordarle'}
        </Button>
      )}
      {/* Quien está al día no necesita que la pantalla le pida una rendición;
          la acción sigue disponible en voz baja, para corregir un monto mal
          cargado o registrar una entrega adelantada. */}
      <Button go={debe > 0} onClick={() => onRegistrar(fila)}>
        {debe > 0 ? 'Registrar rendición' : 'Registrar una igual'}
      </Button>
    </>
  ) : undefined

  const titulo = d?.seller_name ?? 'Rendición'
  const sub = d ? `${d.email} · corista` : undefined

  return escritorio ? (
    <Drawer open onClose={onClose} label="Rendición" title={titulo} sub={sub} actions={acciones}>
      {cuerpo}
    </Drawer>
  ) : (
    <Sheet open onClose={onClose} title={titulo} sub={sub} actions={acciones}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>{cuerpo}</div>
    </Sheet>
  )
}

/* ========================================================================== *
 * La pantalla. Una sola URL para las dos formas: /panel/rendiciones/:id es la
 * lista con el detalle de esa corista abierto. El link que alguien manda por
 * WhatsApp abre lo mismo en el celular y en la compu.
 * ========================================================================== */

export function SettlementsScreen() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { sellerId: raw } = useParams()
  const sellerId = raw ? Number(raw) : undefined
  const { season } = useSeason()
  const report = useReport(season?.id)
  const [registrando, setRegistrando] = useState<SettlementReportRow | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const rows = report.data?.rows ?? []
  const deudoras = rows.filter((r) => r.balance_cents > 0).sort((a, b) => b.balance_cents - a.balance_cents)
  const alDia = rows.filter((r) => r.balance_cents <= 0)
  const totalDebt = deudoras.reduce((acc, r) => acc + r.balance_cents, 0)
  const totalSettled = rows.reduce((acc, r) => acc + r.settled_cents, 0)
  const totalPending = rows.reduce((acc, r) => acc + r.pending_cents, 0)

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
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `rendiciones-${season?.name.replace(/\s+/g, '-').toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const abrir = (id: number) => navigate(`/panel/rendiciones/${id}`)

  return (
    <>
      <PageHeader
        title="Rendiciones"
        label={season?.name}
        actions={<Button to="/panel/rendiciones/historial">Historial</Button>}
      />

      {report.isPending ? (
        <p className="rs">Cargando…</p>
      ) : (
        <>
          <div style={{ marginBottom: 'var(--s5)' }}>
            <Figure label="Sin rendir" tone={totalDebt > 0 ? 'warn' : 'ok'}>
              {formatMoney(totalDebt)}
            </Figure>
            <div style={{ marginTop: 'var(--s4)' }}>
              <SubFigs
                items={[
                  { label: 'Ya rendido', value: formatMoney(totalSettled), tone: 'ok' },
                  { label: 'Coristas con deuda', value: deudoras.length, unit: `de ${rows.length}` },
                  ...(totalPending > 0
                    ? [{ label: 'Compradores deben · no exigible', value: formatMoney(totalPending) }]
                    : []),
                ]}
              />
            </div>
          </div>

          {aviso && (
            <p className="st st--ok" role="status" style={{ whiteSpace: 'normal' }}>
              {aviso}
            </p>
          )}

          <section className="grp">
            <div className="grp__h">
              <h2 className="lbl">Con deuda</h2>
              <span className="grp__n">{formatMoney(totalDebt)}</span>
            </div>
            <div className="card">
              {deudoras.length === 0 ? (
                <Row title="Nadie debe rendir" sub="Toda la plata cobrada ya está en manos de dirección" />
              ) : (
                deudoras.map((r) => (
                  <Row
                    key={r.seller_id}
                    title={r.seller_name}
                    sub={`cobró ${sinCentavos(r.collected_cents)} · rindió ${sinCentavos(r.settled_cents)}`}
                    amount={sinCentavos(r.balance_cents)}
                    unit="debe"
                    status={<Status tone="warn">Debe</Status>}
                    onClick={() => abrir(r.seller_id)}
                  />
                ))
              )}
              {deudoras.length > 0 && (
                <div className="card__f">
                  {confirmando ? (
                    <>
                      <span>¿Mandarle el recordatorio a las {deudoras.length}?</span>
                      <span style={{ display: 'flex', gap: 'var(--s3)' }}>
                        <button className="card__a" type="button" onClick={() => setConfirmando(false)}>
                          Cancelar
                        </button>
                        <button
                          className="card__a"
                          type="button"
                          disabled={recordarTodas.isPending}
                          onClick={() => recordarTodas.mutate()}
                        >
                          {recordarTodas.isPending ? 'Enviando…' : 'Sí, mandar'}
                        </button>
                      </span>
                    </>
                  ) : (
                    <>
                      <button className="card__a" type="button" onClick={exportar}>
                        Exportar
                      </button>
                      {/* Manda emails de verdad a varias personas: se confirma antes. */}
                      <button className="card__a" type="button" onClick={() => setConfirmando(true)}>
                        Recordar a las {deudoras.length}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>

          {alDia.length > 0 && (
            <section className="grp">
              <div className="grp__h">
                <h2 className="lbl">Al día</h2>
                <span className="grp__n">
                  {alDia.length} {alDia.length === 1 ? 'corista' : 'coristas'}
                </span>
              </div>
              <div className="card">
                {alDia.map((r) => (
                  <Row
                    key={r.seller_id}
                    title={r.seller_name}
                    sub={r.collected_cents > 0 ? `cobró ${sinCentavos(r.collected_cents)} · rindió todo` : 'sin ventas cobradas todavía'}
                    amount={r.settled_cents > 0 ? sinCentavos(r.settled_cents) : '—'}
                    unit={r.settled_cents > 0 ? 'rindió' : undefined}
                    status={
                      r.collected_cents > 0 ? <Status tone="ok">Al día</Status> : <Status tone="mute">Sin ventas</Status>
                    }
                    onClick={() => abrir(r.seller_id)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {sellerId !== undefined && season && (
        <DetalleCorista
          sellerId={sellerId}
          seasonId={season.id}
          onClose={() => navigate('/panel/rendiciones')}
          onRegistrar={setRegistrando}
        />
      )}
      {registrando && season && (
        <RegisterSheet row={registrando} seasonId={season.id} onClose={() => setRegistrando(null)} />
      )}
    </>
  )
}

/* ========================================================================== *
 * Historial general
 * ========================================================================== */

/** Agrupa por día; ya viene ordenado descendente del server. */
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

export function SettlementsHistoryPage() {
  const { season } = useSeason()
  const report = useReport(season?.id)
  const [sellerId, setSellerId] = useState<number | undefined>(undefined)

  const history = useQuery({
    queryKey: ['settlements-history', season?.id, sellerId ?? 'all'],
    queryFn: () => api.listSettlements(season!.id, sellerId),
    enabled: season !== undefined,
  })

  const conMovimientos = (report.data?.rows ?? []).filter((r) => r.settled_cents > 0)
  const elegida = conMovimientos.find((r) => r.seller_id === sellerId)
  const settlements = history.data?.settlements ?? []

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/panel/rendiciones" style={{ color: 'inherit' }}>‹ Rendiciones</Link>}
        title="Historial"
        label={season?.name}
        actions={
          conMovimientos.length > 0 ? (
            <Menu
              trigger="btn"
              label={elegida ? elegida.seller_name : 'Todas las coristas'}
              ariaLabel="Filtrar por corista"
              align="right"
              value={sellerId === undefined ? 'all' : String(sellerId)}
              groups={[
                { options: [{ id: 'all', label: 'Todas las coristas', onSelect: () => setSellerId(undefined) }] },
                {
                  separated: true,
                  options: conMovimientos.map((r) => ({
                    id: String(r.seller_id),
                    label: r.seller_name,
                    onSelect: () => setSellerId(r.seller_id),
                  })),
                },
              ]}
            />
          ) : undefined
        }
      />

      {history.isPending ? (
        <p className="rs">Cargando…</p>
      ) : settlements.length === 0 ? (
        <div className="card">
          <Row title="Todavía no hay rendiciones registradas" />
        </div>
      ) : (
        groupByDay(settlements).map((group) => (
          <section key={group.label} className="grp">
            <div className="grp__h">
              <h2 className="lbl">{group.label}</h2>
              <span className="grp__n">
                {formatMoney(group.items.reduce((acc, s) => acc + s.amount_cents, 0))}
              </span>
            </div>
            <div className="card">
              {group.items.map((s) => (
                <Row
                  key={s.id}
                  title={s.seller_name}
                  sub={[`${timeShort(s.created_at)} · ${metodo(s.method)}`, s.notes && `“${s.notes}”`]
                    .filter(Boolean)
                    .join(' · ')}
                  amount={sinCentavos(s.amount_cents)}
                  unit="rindió"
                />
              ))}
            </div>
          </section>
        ))
      )}
      {settlements.length > 0 && (
        <p className="rs" style={{ whiteSpace: 'normal' }}>
          La última rendición registrada fue {daysAgo(settlements[0].created_at)}.
        </p>
      )}
    </>
  )
}
