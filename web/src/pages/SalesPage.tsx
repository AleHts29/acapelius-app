import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { Banknote, HandCoins, Landmark, Link2, Mail, PartyPopper, RotateCcw, X } from 'lucide-react'

import { ApiError, api, publicSaleURL } from '../api/client'
import type { PaymentMethod, SaleListItem, SalePayments, SaleStatusFilter } from '../api/client'
import { useSession } from '../auth/session'
import { dayLabel, daysAgo, formatDateTime, formatMoney, pesosToCents } from '../lib/format'
import { initials, normalizeText } from '../lib/search'
import { ActionPanel, SheetAction } from '../ui/ActionPanel'
import { useNuevaVenta } from '../ui/useNuevaVenta'
import { EmptyState, FilterChips, Hl, PageHead, SearchBar, SegmentedToggle } from '../ui/controls'
import { SaleChip } from '../ui/StatusChip'

const salesQueryKey = ['sales'] as const

/** Filtro de URL (C2) ↔ status de la API (C3). */
type UIFilter = 'todas' | 'deben' | 'pagas' | 'cortesias'
const FILTER_TO_STATUS: Record<UIFilter, SaleStatusFilter | undefined> = {
  todas: undefined,
  deben: 'pending',
  pagas: 'paid',
  cortesias: 'comp',
}

function parseFilter(raw: string | null): UIFilter {
  return raw === 'deben' || raw === 'pagas' || raw === 'cortesias' ? raw : 'todas'
}

/** Item plano para virtualizar: cabecera de grupo o venta. */
type FlatItem =
  | { kind: 'header'; key: string; title: string; count?: number }
  | { kind: 'sale'; key: string; sale: SaleListItem }

function groupByFunction(sales: SaleListItem[], complete: boolean): FlatItem[] {
  const out: FlatItem[] = []
  let current = -1
  let headerIdx = -1
  for (const sale of sales) {
    if (sale.function_id !== current) {
      current = sale.function_id
      headerIdx = out.length
      out.push({
        kind: 'header',
        key: `f${sale.function_id}`,
        title: `${sale.function_name ?? sale.function_venue} · ${formatDateTime(sale.function_starts_at)}`,
        count: 0,
      })
    }
    out.push({ kind: 'sale', key: `s${sale.id}`, sale })
    const header = out[headerIdx]
    if (header.kind === 'header' && complete) header.count = (header.count ?? 0) + 1
  }
  if (!complete) for (const item of out) if (item.kind === 'header') item.count = undefined
  return out
}

/** Con busqueda activa: grupos por tipo de match (corista / compradora). */
function groupByMatch(sales: SaleListItem[], q: string): FlatItem[] {
  const nq = normalizeText(q)
  const bySeller = new Map<string, SaleListItem[]>()
  const byBuyer: SaleListItem[] = []
  for (const sale of sales) {
    if (normalizeText(sale.seller_name).includes(nq)) {
      const list = bySeller.get(sale.seller_name) ?? []
      list.push(sale)
      bySeller.set(sale.seller_name, list)
    } else {
      byBuyer.push(sale)
    }
  }
  const out: FlatItem[] = []
  for (const [seller, list] of bySeller) {
    out.push({ kind: 'header', key: `ms-${seller}`, title: `Vendidas por ${seller}`, count: list.length })
    for (const sale of list) out.push({ kind: 'sale', key: `s${sale.id}`, sale })
  }
  if (byBuyer.length > 0) {
    out.push({ kind: 'header', key: 'mb', title: 'Compradoras', count: byBuyer.length })
    for (const sale of byBuyer) out.push({ kind: 'sale', key: `s${sale.id}`, sale })
  }
  return out
}

/** Sheet de acciones de una venta (C3.4): nada de botones en la fila. */
function SaleSheet({
  sale: saleInicial,
  isAdmin,
  onClose,
}: {
  sale: SaleListItem
  isAdmin: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  // La hoja se queda con su propia copia de la venta: registrar o quitar un
  // cobro devuelve la venta ya recalculada, así que los números de acá se
  // actualizan sin esperar a que la lista de atrás se refresque.
  const [sale, setSale] = useState(saleInicial)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmVoid, setConfirmVoid] = useState(false)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: salesQueryKey })
    // "Te falta cobrar", "últimas ventas" y los badges salen de la home.
    void queryClient.invalidateQueries({ queryKey: ['home'] })
  }
  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError ? err.message : fallback)

  const setPayment = useMutation({
    mutationFn: ({ paid, method }: { paid: boolean; method?: PaymentMethod }) =>
      api.updateSalePayment(sale.id, paid ? 'paid' : 'pending', method),
    onSuccess: () => {
      refresh()
      onClose()
    },
    onError: (err) => fail(err, 'No se pudo actualizar el pago.'),
  })

  // Historial de cobros: se pide al abrir la hoja. La venta que devuelven el
  // alta y la baja de un cobro es la recalculada, así que la hoja se queda con
  // los números al día sin esperar a que se refresque la lista de atrás.
  const [parcialAbierto, setParcialAbierto] = useState(false)
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('cash')

  const payments = useQuery({
    queryKey: ['sale-payments', sale.id],
    queryFn: () => api.salePayments(sale.id),
    enabled: sale.voided_at === null && !sale.is_comp,
  })
  const cobros = payments.data?.payments ?? []

  const tomarRespuesta = (data: SalePayments) => {
    setSale((prev) => ({
      ...prev,
      paid_cents: data.sale.paid_cents,
      payment_status: data.sale.payment_status,
      payment_method: data.sale.payment_method,
    }))
    setError(null)
    void queryClient.invalidateQueries({ queryKey: ['sale-payments', sale.id] })
    refresh()
  }

  const addPayment = useMutation({
    mutationFn: (cents: number) => api.addSalePayment(sale.id, cents, metodo),
    onSuccess: (data) => {
      tomarRespuesta(data)
      setParcialAbierto(false)
      setMonto('')
    },
    onError: (err) => fail(err, 'No se pudo registrar el cobro.'),
  })

  const delPayment = useMutation({
    mutationFn: (paymentId: number) => api.deleteSalePayment(sale.id, paymentId),
    onSuccess: tomarRespuesta,
    onError: (err) => fail(err, 'No se pudo quitar el cobro.'),
  })

  const ocupado = setPayment.isPending || addPayment.isPending || delPayment.isPending

  function registrarParcial() {
    const cents = pesosToCents(monto)
    if (cents === null || cents <= 0) {
      setError('El monto no es válido. Ejemplo: 8000 o 8000,50.')
      return
    }
    addPayment.mutate(cents)
  }

  const resend = useMutation({
    mutationFn: () => api.resendSaleEmail(sale.id),
    onSuccess: ({ email_status }) => {
      refresh()
      if (email_status === 'sent') setNotice('Email enviado ✓')
      else setError('El email no salió. Probá de nuevo.')
    },
    onError: (err) => fail(err, 'No se pudo reenviar el email.'),
  })

  const voidSale = useMutation({
    mutationFn: () => api.voidSale(sale.id),
    onSuccess: () => {
      refresh()
      onClose()
    },
    onError: (err) => fail(err, 'No se pudo anular la venta.'),
  })

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicSaleURL(sale.code))
      setNotice('Link copiado ✓')
    } catch {
      setError('No se pudo copiar el link.')
    }
  }

  const cobrable = sale.voided_at === null && !sale.is_comp
  const falta = sale.amount_cents - sale.paid_cents
  const pendingPayment = cobrable && falta > 0
  const paid = cobrable && falta <= 0

  return (
    <ActionPanel open onClose={onClose} label={`Acciones de la venta de ${sale.buyer_name}`}>
      <div className="sheet-head">
        <span className="ini">{initials(sale.buyer_name)}</span>
        <span>
          <b>{sale.buyer_name}</b>
          <span>
            {sale.quantity} {sale.quantity === 1 ? 'entrada' : 'entradas'} ·{' '}
            {sale.function_name ?? sale.function_venue} · vendió {sale.seller_name}
            {!sale.is_comp && <> · {formatMoney(sale.amount_cents)}</>}
          </span>
        </span>
      </div>

      {error && <p className="alert" role="alert" style={{ margin: '10px 0 0' }}>{error}</p>}
      {notice && <p className="muted" style={{ margin: '10px 0 0', fontWeight: 700, color: 'var(--ok)' }}>{notice}</p>}

      {pendingPayment && (
        <>
          <SheetAction icon={<Banknote size={15} />} tone="ok" disabled={ocupado}
            onClick={() => setPayment.mutate({ paid: true, method: 'cash' })}>
            {sale.paid_cents > 0 ? 'Cobré el resto — efectivo' : 'Marcar pagó — efectivo'}
          </SheetAction>
          <SheetAction icon={<Landmark size={15} />} tone="ok" disabled={ocupado}
            onClick={() => setPayment.mutate({ paid: true, method: 'transfer' })}>
            {sale.paid_cents > 0 ? 'Cobré el resto — transferencia' : 'Marcar pagó — transferencia'}
          </SheetAction>
          {parcialAbierto ? (
            <div className="pay-part">
              <label className="field" style={{ marginTop: 0 }}>
                <span className="field__label">Cuánto cobró ($)</span>
                <input
                  className="field__input"
                  type="text"
                  inputMode="decimal"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder={String(Math.floor(falta / 100))}
                  autoFocus
                />
              </label>
              <div className="field">
                <span className="field__label">Método</span>
                <SegmentedToggle<PaymentMethod>
                  value={metodo}
                  onChange={setMetodo}
                  options={[
                    { value: 'cash', label: 'Efectivo' },
                    { value: 'transfer', label: 'Transferencia' },
                  ]}
                />
              </div>
              <div className="form-row">
                <button className="button" type="button" disabled={ocupado} onClick={registrarParcial}>
                  {addPayment.isPending ? 'Registrando…' : 'Registrar cobro'}
                </button>
                <button
                  className="button button--ghost form-row__action"
                  type="button"
                  onClick={() => setParcialAbierto(false)}
                >
                  Cancelar
                </button>
              </div>
              <p className="muted" style={{ fontSize: 10.5, margin: '6px 0 0' }}>
                Falta {formatMoney(falta)} de {formatMoney(sale.amount_cents)}.
              </p>
            </div>
          ) : (
            <SheetAction icon={<HandCoins size={15} />} disabled={ocupado}
              onClick={() => setParcialAbierto(true)}>
              Cobré una parte…
            </SheetAction>
          )}
        </>
      )}

      {cobrable && cobros.length > 0 && (
        <div className="pay-hist">
          <p className="panel__label">
            Cobrado {formatMoney(sale.paid_cents)}
            {falta > 0 && <> · debe {formatMoney(falta)}</>}
          </p>
          {cobros.map((cobro) => (
            <div key={cobro.id} className="pay-hist__row">
              <span>
                <b>{formatMoney(cobro.amount_cents)}</b>{' '}
                <span className="muted">{cobro.method === 'transfer' ? 'transferencia' : 'efectivo'}</span>
                <br />
                <span className="muted" style={{ fontSize: 11 }}>
                  {dayLabel(cobro.created_at)} · {cobro.by_name}
                </span>
              </span>
              <button
                className="pay-hist__del"
                type="button"
                disabled={ocupado}
                aria-label={`Quitar el cobro de ${formatMoney(cobro.amount_cents)}`}
                onClick={() => delPayment.mutate(cobro.id)}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}

      {paid && (
        <SheetAction icon={<RotateCcw size={15} />} disabled={ocupado}
          onClick={() => setPayment.mutate({ paid: false })}>
          Volver a pendiente
        </SheetAction>
      )}
      {sale.voided_at === null && (
        <SheetAction icon={<Link2 size={15} />} onClick={() => void copyLink()}>
          Copiar link de la entrada
        </SheetAction>
      )}
      {sale.voided_at === null && sale.buyer_email && (
        <SheetAction
          icon={<Mail size={15} />}
          hint={sale.last_email_at ? `enviado ${daysAgo(sale.last_email_at)}` : 'nunca se envió'}
          disabled={resend.isPending}
          onClick={() => resend.mutate()}
        >
          {resend.isPending ? 'Enviando…' : 'Reenviar email'}
        </SheetAction>
      )}
      {isAdmin && sale.voided_at === null && (
        <SheetAction icon={<X size={15} />} tone="danger" disabled={voidSale.isPending}
          onClick={() => {
            if (confirmVoid) voidSale.mutate()
            else setConfirmVoid(true)
          }}>
          {confirmVoid ? '¿Seguro? Anular definitivamente (libera el cupo)' : 'Anular venta'}
        </SheetAction>
      )}
    </ActionPanel>
  )
}

export function SalesPage() {
  const { user } = useSession()
  const nuevaVenta = useNuevaVenta()
  const isAdmin = user?.role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()

  const filter = parseFilter(searchParams.get('filtro'))
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [functionId, setFunctionId] = useState<number | undefined>(undefined)
  const [selected, setSelected] = useState<SaleListItem | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(timer)
  }, [q])

  const functions = useQuery({ queryKey: ['functions'], queryFn: () => api.listFunctions() })

  const list = useInfiniteQuery({
    queryKey: [...salesQueryKey, { filter, q: debouncedQ, functionId }],
    queryFn: ({ pageParam }) =>
      api.listSales({
        status: FILTER_TO_STATUS[filter],
        q: debouncedQ || undefined,
        functionId,
        cursor: pageParam || undefined,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  const sales = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.sales), [list.data])
  const summary = list.data?.pages[0]?.summary
  const searching = debouncedQ.trim() !== ''
  const flat = useMemo(
    () => (searching ? groupByMatch(sales, debouncedQ) : groupByFunction(sales, !list.hasNextPage)),
    [sales, searching, debouncedQ, list.hasNextPage],
  )

  // Virtualizacion sobre el scroll de la ventana (C3.3).
  const listRef = useRef<HTMLDivElement>(null)
  const virtualizer = useWindowVirtualizer({
    count: flat.length,
    estimateSize: (i) => (flat[i].kind === 'header' ? 36 : 68),
    overscan: 10,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  })

  // Pedir la proxima pagina cuando el final entra en pantalla.
  const virtualItems = virtualizer.getVirtualItems()
  const lastIndex = virtualItems.at(-1)?.index ?? 0
  useEffect(() => {
    if (flat.length > 0 && lastIndex >= flat.length - 5 && list.hasNextPage && !list.isFetchingNextPage) {
      void list.fetchNextPage()
    }
  }, [lastIndex, flat.length, list])

  return (
    <>
      <PageHead
        title={isAdmin ? 'Ventas' : 'Mis ventas'}
        /* En escritorio la venta se resuelve encima de la lista y al cerrar
           seguís donde estabas; en celular es su propia pantalla, que ahí es
           lo cómodo. */
        action={{ label: 'Nueva venta', onClick: nuevaVenta.abrir }}
      />

      {nuevaVenta.panel}

      <div className="salesbar">
      {summary && (
        <div className="sumstrip">
          <div>
            <b>{summary.tickets_sold}</b>
            <span>Entradas</span>
          </div>
          <div className="g">
            <b>{formatMoney(summary.paid_cents)}</b>
            <span>Cobrado</span>
          </div>
          <div className="y">
            <b>{formatMoney(summary.pending_cents)}</b>
            <span>Por cobrar</span>
          </div>
        </div>
      )}

      <div className="sticky-bar">
        <SearchBar value={q} onChange={setQ} placeholder="Buscar comprador o vendedora…" />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <FilterChips<UIFilter>
            value={filter}
            onChange={(next) => setSearchParams(next === 'todas' ? {} : { filtro: next })}
            options={[
              { value: 'todas', label: 'Todas', count: summary?.total_count },
              { value: 'deben', label: 'Deben', count: summary?.pending_count, tone: 'warn' },
              { value: 'pagas', label: 'Pagas' },
              { value: 'cortesias', label: 'Cortesías' },
            ]}
          />
          <select
            className="fchip"
            style={{ marginTop: 8, maxWidth: 130 }}
            aria-label="Filtrar por función"
            value={functionId ?? ''}
            onChange={(e) => setFunctionId(e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">Todas las funciones</option>
            {functions.data?.functions.map((fn) => (
              <option key={fn.id} value={fn.id}>
                {fn.name ?? fn.venue}
              </option>
            ))}
          </select>
        </div>
      </div>
      </div>

      {/* En escritorio esto es una tabla: encabezado fijo arriba y filas de
          46px adentro de una sola tarjeta. En celular no se renderiza. */}
      {flat.length > 0 && (
        <div className="thead" aria-hidden>
          <span />
          <span>Comprador</span>
          <span>Función</span>
          <span>Vendedora</span>
          <span>Entr.</span>
          <span>Total</span>
          <span>Estado</span>
          <span />
        </div>
      )}

      {list.isPending ? (
        <p className="muted">Cargando…</p>
      ) : flat.length === 0 ? (
        searching ? (
          <p className="muted">Nada para “{debouncedQ}”. Probá con menos letras.</p>
        ) : filter === 'deben' ? (
          <EmptyState icon={<PartyPopper size={18} />} title="Nadie debe nada">
            Todo lo vendido está cobrado. ¡Gran trabajo!
          </EmptyState>
        ) : (
          <p className="muted">Todavía no hay ventas acá.</p>
        )
      ) : (
        <div
          className="stable"
          ref={listRef}
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualItems.map((vi) => {
            const item = flat[vi.index]
            return (
              <div
                key={item.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${vi.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                {item.kind === 'header' ? (
                  <div className="ghead">
                    <b>{item.title}</b>
                    {item.count !== undefined && (
                      <span>{item.count} {item.count === 1 ? 'venta' : 'ventas'}</span>
                    )}
                  </div>
                ) : (
                  <button
                    className={`mrow srow${item.sale.voided_at ? ' panel--voided' : ''}${
                      selected?.id === item.sale.id ? ' srow--sel' : ''
                    }`}
                    type="button"
                    onClick={() => setSelected(item.sale)}
                  >
                    <span className="ini">{initials(item.sale.buyer_name)}</span>
                    <span className="mrow__mid">
                      <b><Hl text={item.sale.buyer_name} q={debouncedQ} /></b>
                      {/* El subtítulo es de celular: en la tabla esos datos
                          tienen su propia columna. */}
                      <span className="srow__sub">
                        {item.sale.quantity} {item.sale.quantity === 1 ? 'entrada' : 'entradas'} ·{' '}
                        {item.sale.is_comp ? 'emitió' : 'vendió'}{' '}
                        <Hl text={item.sale.seller_name} q={debouncedQ} />
                      </span>
                    </span>
                    <span className="srow__col srow__fn" title={item.sale.function_name ?? item.sale.function_venue}>
                      {item.sale.function_name ?? item.sale.function_venue}
                    </span>
                    <span className="srow__col srow__seller" title={item.sale.seller_name}>
                      <Hl text={item.sale.seller_name} q={debouncedQ} />
                    </span>
                    <span className="srow__col srow__qty">{item.sale.quantity}</span>
                    <span className="srow__col srow__total">
                      {item.sale.is_comp ? '—' : formatMoney(item.sale.amount_cents)}
                    </span>
                    <SaleChip sale={item.sale} />
                    <span className="mrow__dots" aria-hidden>⋮</span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {list.isFetchingNextPage && <p className="muted" style={{ textAlign: 'center' }}>Cargando más…</p>}

      {selected && <SaleSheet sale={selected} isAdmin={isAdmin} onClose={() => setSelected(null)} />}

    </>
  )
}
