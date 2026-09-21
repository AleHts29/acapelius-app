import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Banknote,
  ChevronDown,
  Download,
  Landmark,
  Link2,
  Mail,
  PartyPopper,
  Send,
  Users,
  X,
} from 'lucide-react'

import { api, publicSaleURL, shareOrCopy } from '../api/client'
import type {
  PaymentMethod,
  SaleListItem,
  SalesFunctionTotals,
  SaleStatusFilter,
} from '../api/client'
import { useSession } from '../auth/session'
import { daysAgo, formatMoney, functionDay, functionTime } from '../lib/format'
import { initials } from '../lib/search'
import { useSeason } from '../season/SeasonProvider'
import { useIsDesktop } from '../lib/viewport'
import { ActionPanel } from '../ui/ActionPanel'
import { Menu } from '../ui/Menu'
import type { MenuGroup } from '../ui/Menu'
import { SaleSheet, salesQueryKey } from './SaleSheet'
import { useNuevaVenta } from '../ui/useNuevaVenta'
import { EmptyState, FilterChips, Hl, PageHead, SearchBar } from '../ui/controls'
import { SaleChip } from '../ui/StatusChip'

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

/** Columnas ordenables. `null` = el orden natural del server. */
type SortCol = 'buyer' | 'qty' | 'total' | 'date'
type Sort = { col: SortCol; desc: boolean } | null

/** Un bloque: una función con sus ventas y sus subtotales. */
interface Bloque {
  functionId: number
  nombre: string
  startsAt: string
  pasada: boolean
  totals?: SalesFunctionTotals
  sales: SaleListItem[]
}

const GRACIA_MS = 3 * 60 * 60 * 1000

/**
 * Agrupa las ventas por función respetando el orden en que vienen: el server
 * ya las manda en el orden de los bloques (las que se venden primero, después
 * las que pasaron), y los grupos llegan contiguos entre páginas.
 */
function agrupar(sales: SaleListItem[], totals: SalesFunctionTotals[]): Bloque[] {
  const porFuncion = new Map<number, SalesFunctionTotals>()
  for (const t of totals) porFuncion.set(t.function_id, t)

  const out: Bloque[] = []
  for (const sale of sales) {
    let bloque = out.at(-1)
    if (!bloque || bloque.functionId !== sale.function_id) {
      bloque = {
        functionId: sale.function_id,
        nombre: sale.function_name ?? sale.function_venue,
        startsAt: sale.function_starts_at,
        pasada: new Date(sale.function_starts_at).getTime() < Date.now() - GRACIA_MS,
        totals: porFuncion.get(sale.function_id),
        sales: [],
      }
      out.push(bloque)
    }
    bloque.sales.push(sale)
  }
  return out
}

function ordenar(sales: SaleListItem[], sort: Sort): SaleListItem[] {
  if (!sort) return sales
  const signo = sort.desc ? -1 : 1
  return [...sales].sort((a, b) => {
    switch (sort.col) {
      case 'buyer':
        return signo * a.buyer_name.localeCompare(b.buyer_name, 'es')
      case 'qty':
        return signo * (a.quantity - b.quantity)
      case 'total':
        return signo * (a.amount_cents - b.amount_cents)
      case 'date':
        return signo * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
  })
}

/** "14 ago" si es de este mes, "hace 26 d" si es vieja. */
function cuandoSeVendio(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (dias <= 7) return dias === 0 ? 'hoy' : `hace ${dias} d`
  const d = new Date(iso)
  const mismoMes = d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear()
  if (mismoMes) {
    return d
      .toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires' })
      .replace('.', '')
  }
  return `hace ${dias} d`
}

const ENTREGA: Record<SaleListItem['delivery'], { label: string; tone: string }> = {
  sent: { label: 'Enviada', tone: 'ok' },
  failed: { label: 'No llegó', tone: 'warn' },
  none: { label: 'Sin email', tone: 'warn' },
}

// --- Fila --------------------------------------------------------------------

function Fila({
  sale,
  q,
  isAdmin,
  seleccionada,
  onSeleccionar,
  onAbrir,
  onCambio,
}: {
  sale: SaleListItem
  q: string
  isAdmin: boolean
  seleccionada: boolean
  onSeleccionar: (on: boolean) => void
  onAbrir: () => void
  onCambio: () => void
}) {
  const anulada = sale.voided_at !== null
  const debe = !anulada && !sale.is_comp && sale.payment_status === 'pending'
  const entrega = ENTREGA[sale.delivery]

  const cobrar = useMutation({
    mutationFn: (method: PaymentMethod) => api.updateSalePayment(sale.id, 'paid', method),
    onSuccess: onCambio,
  })
  const reenviar = useMutation({
    mutationFn: () => api.resendSaleEmail(sale.id),
    onSuccess: onCambio,
  })
  const copiarLink = () => void shareOrCopy(publicSaleURL(sale.code), sale.buyer_name)

  /**
   * La acción rápida vive en su propia columna, siempre reservada: si
   * apareciera en el lugar del chip, el estado desaparecería justo cuando se
   * lo está por cambiar, y la fila saltaría al pasar el mouse.
   */
  const accion = anulada ? null : debe ? (
    <button
      className="srow__do srow__do--ok"
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        cobrar.mutate('cash')
      }}
      disabled={cobrar.isPending}
    >
      {cobrar.isPending ? 'Cobrando…' : 'Cobrar'}
    </button>
  ) : sale.delivery === 'none' ? (
    <button
      className="srow__do"
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        copiarLink()
      }}
    >
      Copiar link
    </button>
  ) : sale.delivery === 'failed' ? (
    <button
      className="srow__do"
      type="button"
      disabled={reenviar.isPending}
      onClick={(e) => {
        e.stopPropagation()
        reenviar.mutate()
      }}
    >
      {reenviar.isPending ? 'Enviando…' : 'Reenviar'}
    </button>
  ) : null

  return (
    <div
      className={`srow${anulada ? ' srow--void' : ''}${seleccionada ? ' srow--sel' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onAbrir()
        }
      }}
    >
      <span className="srow__pick" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={seleccionada}
          aria-label={`Seleccionar la venta de ${sale.buyer_name}`}
          onChange={(e) => onSeleccionar(e.target.checked)}
        />
      </span>

      <span className="srow__buyer">
        {/* El avatar es siempre índigo: es identidad, no estado. */}
        <span className="ini">{initials(sale.buyer_name)}</span>
        <span className="srow__who">
          <b>
            <Hl text={sale.buyer_name} q={q} />
          </b>
          <span className="srow__mail">{sale.buyer_email ?? 'Sin email'}</span>
          {/* El subtítulo de celular: en la tabla esos datos tienen columna. */}
          <span className="srow__sub">
            {sale.quantity} {sale.quantity === 1 ? 'entrada' : 'entradas'} ·{' '}
            {sale.is_comp ? 'emitió' : 'vendió'} <Hl text={sale.seller_name} q={q} />
          </span>
        </span>
      </span>

      <span className="srow__col srow__seller" title={sale.seller_name}>
        <Hl text={sale.seller_name} q={q} />
      </span>
      <span className="srow__col srow__qty">{sale.quantity}</span>
      <span className="srow__col srow__total">
        {sale.is_comp ? '—' : formatMoney(sale.amount_cents)}
      </span>
      <span className="srow__col srow__when">{cuandoSeVendio(sale.created_at)}</span>
      <span className="srow__col srow__deliv">
        <i className={`dot dot--${entrega.tone}`} aria-hidden />
        {entrega.label}
      </span>

      <SaleChip sale={sale} />

      <span className="srow__act" onClick={(e) => e.stopPropagation()}>
        {accion}
      </span>

      <span className="srow__dots" onClick={(e) => e.stopPropagation()}>
        <Menu
          trigger="kebab"
          label={`Acciones de la venta de ${sale.buyer_name}`}
          align="right"
          groups={([
            {
              options: debe
                ? [
                    {
                      id: 'cash',
                      label: 'Marcar pagó — efectivo',
                      icon: <Banknote size={15} />,
                      onSelect: () => cobrar.mutate('cash'),
                    },
                    {
                      id: 'transfer',
                      label: 'Marcar pagó — transferencia',
                      icon: <Landmark size={15} />,
                      onSelect: () => cobrar.mutate('transfer'),
                    },
                  ]
                : [],
            },
            {
              separated: true,
              options: [
                {
                  id: 'link',
                  label: 'Copiar link de la entrada',
                  icon: <Link2 size={15} />,
                  onSelect: copiarLink,
                },
                {
                  id: 'mail',
                  label: 'Reenviar email',
                  hint: sale.last_email_at
                    ? `enviado ${daysAgo(sale.last_email_at)}`
                    : 'nunca se envió',
                  icon: <Mail size={15} />,
                  disabled: !sale.buyer_email || anulada,
                  disabledReason: anulada ? 'La venta está anulada' : 'La venta no tiene email',
                  onSelect: () => reenviar.mutate(),
                },
                {
                  id: 'entered',
                  label: 'Ver ingresos',
                  hint: `${sale.entered} de ${sale.quantity} entraron`,
                  icon: <Users size={15} />,
                  onSelect: onAbrir,
                },
              ],
            },
            {
              separated: true,
              options: isAdmin
                ? [
                    {
                      id: 'void',
                      label: 'Anular venta',
                      hint: 'Libera el cupo. No se puede deshacer',
                      icon: <X size={15} />,
                      tone: 'danger',
                      disabled: anulada,
                      disabledReason: 'Ya está anulada',
                      // La confirmación vive en el drawer, que muestra la venta
                      // entera: anular desde un menú, a ciegas, es demasiado
                      // fácil de hacer sin querer.
                      onSelect: onAbrir,
                    },
                  ]
                : [],
            },
          ] as MenuGroup[]).filter((g) => g.options.length > 0)}
        />
      </span>
    </div>
  )
}

// --- Bloque de función -------------------------------------------------------

function Encabezados({
  sort,
  onSort,
  todas,
  onTodas,
}: {
  sort: Sort
  onSort: (col: SortCol) => void
  todas: boolean
  onTodas: (on: boolean) => void
}) {
  const flecha = (col: SortCol) =>
    sort?.col === col ? <ChevronDown size={11} className={sort.desc ? '' : 'up'} aria-hidden /> : null
  return (
    <div className="sthead" role="row">
      <span className="srow__pick">
        <input
          type="checkbox"
          checked={todas}
          aria-label="Seleccionar todas las de esta función"
          onChange={(e) => onTodas(e.target.checked)}
        />
      </span>
      <button type="button" className="sthead__s" onClick={() => onSort('buyer')}>
        Comprador {flecha('buyer')}
      </button>
      <span>Vendedora</span>
      <button type="button" className="sthead__s sthead__s--r" onClick={() => onSort('qty')}>
        Entr. {flecha('qty')}
      </button>
      <button type="button" className="sthead__s sthead__s--r" onClick={() => onSort('total')}>
        Total {flecha('total')}
      </button>
      <button type="button" className="sthead__s" onClick={() => onSort('date')}>
        Vendida {flecha('date')}
      </button>
      <span>Entrada</span>
      <span className="sthead__r">Estado</span>
      <span />
      <span />
    </div>
  )
}

function BloqueFuncion({
  bloque,
  q,
  isAdmin,
  sort,
  onSort,
  seleccion,
  onSeleccion,
  onAbrir,
  onCambio,
}: {
  bloque: Bloque
  q: string
  isAdmin: boolean
  sort: Sort
  onSort: (col: SortCol) => void
  seleccion: Set<number>
  onSeleccion: (ids: number[], on: boolean) => void
  onAbrir: (sale: SaleListItem) => void
  onCambio: () => void
}) {
  const [plegado, setPlegado] = useState(false)
  const filas = ordenar(bloque.sales, sort)
  const ids = bloque.sales.map((s) => s.id)
  const todas = ids.length > 0 && ids.every((id) => seleccion.has(id))
  const t = bloque.totals

  return (
    <section className={`sblock${bloque.pasada ? ' sblock--done' : ''}`}>
      <div className="sblock__h">
        <button
          className="sblock__fold"
          type="button"
          aria-expanded={!plegado}
          aria-label={plegado ? `Desplegar ${bloque.nombre}` : `Plegar ${bloque.nombre}`}
          onClick={() => setPlegado(!plegado)}
        >
          <ChevronDown size={14} className={plegado ? 'up' : ''} aria-hidden />
        </button>
        <span className="sblock__nm">
          <b>{bloque.nombre}</b>
          <span>
            {functionDay(bloque.startsAt)}, {functionTime(bloque.startsAt)} ·{' '}
            {bloque.pasada ? 'hecha' : 'en venta'}
          </span>
        </span>
        {t && (
          <span className="sblock__t">
            <span>
              <b>{t.sales}</b> {t.sales === 1 ? 'venta' : 'ventas'}
            </span>
            <span>
              <b>{t.tickets}</b> entradas
            </span>
            <span>
              Recaudó <b className="g">{formatMoney(t.paid_cents)}</b>
            </span>
            <span>
              Debe{' '}
              <b className={t.pending_cents > 0 ? 'y' : 'g'}>{formatMoney(t.pending_cents)}</b>
            </span>
          </span>
        )}
      </div>

      {!plegado && (
        <>
          <Encabezados
            sort={sort}
            onSort={onSort}
            todas={todas}
            onTodas={(on) => onSeleccion(ids, on)}
          />
          {filas.map((sale) => (
            <Fila
              key={sale.id}
              sale={sale}
              q={q}
              isAdmin={isAdmin}
              seleccionada={seleccion.has(sale.id)}
              onSeleccionar={(on) => onSeleccion([sale.id], on)}
              onAbrir={() => onAbrir(sale)}
              onCambio={onCambio}
            />
          ))}
        </>
      )}
    </section>
  )
}

// --- Barra de selección ------------------------------------------------------

function BarraSeleccion({
  ventas,
  onLimpiar,
  onCambio,
  onAviso,
  exportURL,
}: {
  ventas: SaleListItem[]
  onLimpiar: () => void
  onCambio: () => void
  /** El aviso vive en la página: al limpiar la selección esta barra se
   *  desmonta, y con ella se iría el mensaje que acaba de escribir. */
  onAviso: (texto: string) => void
  exportURL: string
}) {
  const [confirmando, setConfirmando] = useState(false)
  const ids = ventas.map((v) => v.id)
  const total = ventas.reduce((acc, v) => acc + (v.amount_cents - v.paid_cents), 0)

  const cobrar = useMutation({
    mutationFn: (method: PaymentMethod) => api.bulkPayment(ids, method),
    onSuccess: (res) => {
      setConfirmando(false)
      onCambio()
      onLimpiar()
      onAviso(
        res.skipped > 0
          ? `Cobraste ${res.charged} por ${formatMoney(res.amount_cents)}. ${res.skipped} no aplicaban.`
          : `Cobraste ${res.charged} por ${formatMoney(res.amount_cents)}.`,
      )
    },
  })
  const reenviar = useMutation({
    mutationFn: () => api.bulkResend(ids),
    onSuccess: (res) => {
      onCambio()
      onAviso(
        res.no_email > 0
          ? `Reenviaste ${res.sent}. ${res.no_email} no tienen email.`
          : `Reenviaste ${res.sent}.`,
      )
    },
  })

  return (
    <>
      <div className="selbar" role="status">
        <b>
          {ventas.length} {ventas.length === 1 ? 'venta' : 'ventas'} · {formatMoney(total)}
        </b>
        <button type="button" onClick={() => setConfirmando(true)}>
          <Banknote size={14} aria-hidden /> Marcar como pagadas
        </button>
        <button type="button" disabled={reenviar.isPending} onClick={() => reenviar.mutate()}>
          <Send size={14} aria-hidden /> {reenviar.isPending ? 'Enviando…' : 'Reenviar entradas'}
        </button>
        <a href={exportURL} download>
          <Download size={14} aria-hidden /> Exportar
        </a>
        <button className="selbar__x" type="button" aria-label="Limpiar selección" onClick={onLimpiar}>
          <X size={15} aria-hidden />
        </button>
      </div>

      {/* Cobrar en lote mueve plata de verdad: se pregunta antes, y el método
          se elige acá porque en la barra no entra sin apretarlo todo. */}
      {confirmando && (
        <ActionPanel label="Marcar como pagadas" onClose={() => setConfirmando(false)}>
          <div className="sheet-head">
            <span>
              <b>
                Cobrar {ventas.length} {ventas.length === 1 ? 'venta' : 'ventas'}
              </b>
              <span>Se registra {formatMoney(total)} en total</span>
            </span>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '12px 2px 0', lineHeight: 1.55 }}>
            Se cobra lo que falte de cada una. Las anuladas, las cortesías y las que ya estaban
            cobradas se saltean.
          </p>
          <div className="form-row" style={{ marginTop: 14 }}>
            <button
              className="button"
              type="button"
              disabled={cobrar.isPending}
              onClick={() => cobrar.mutate('cash')}
            >
              <Banknote size={15} aria-hidden /> Efectivo
            </button>
            <button
              className="button form-row__action"
              type="button"
              disabled={cobrar.isPending}
              onClick={() => cobrar.mutate('transfer')}
            >
              <Landmark size={15} aria-hidden /> Transferencia
            </button>
          </div>
          <button
            className="button button--ghost"
            style={{ marginTop: 8, width: '100%' }}
            type="button"
            onClick={() => setConfirmando(false)}
          >
            Cancelar
          </button>
        </ActionPanel>
      )}
    </>
  )
}

// --- Pantalla ----------------------------------------------------------------

export function SalesPage() {
  const { user } = useSession()
  const isAdmin = user?.role === 'admin'
  const escritorio = useIsDesktop()
  const queryClient = useQueryClient()
  const nuevaVenta = useNuevaVenta()
  const { seasonId } = useSeason()

  const [searchParams, setSearchParams] = useSearchParams()
  const filter = parseFilter(searchParams.get('filtro'))
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [functionId, setFunctionId] = useState<number | undefined>(
    Number(searchParams.get('fn')) || undefined,
  )
  const [sellerId, setSellerId] = useState<number | undefined>(undefined)
  const [sort, setSort] = useState<Sort>(null)
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const [abierta, setAbierta] = useState<SaleListItem | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 250)
    return () => clearTimeout(id)
  }, [q])

  const filtros = {
    // El listado vive dentro de la temporada del selector global (C16): sin
    // esto, cambiar de temporada dejaba Ventas mostrando todos los años.
    seasonId,
    q: debouncedQ || undefined,
    status: FILTER_TO_STATUS[filter],
    functionId,
    sellerId: isAdmin ? sellerId : undefined,
  }

  const list = useInfiniteQuery({
    queryKey: [...salesQueryKey, filtros],
    queryFn: ({ pageParam }) => api.listSales({ ...filtros, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor,
  })

  const funciones = useQuery({
    queryKey: ['functions', seasonId],
    queryFn: () => api.listFunctions(seasonId),
    enabled: seasonId !== undefined,
  })
  const vendedoras = useQuery({
    queryKey: ['sellers-with-sales', seasonId, functionId],
    queryFn: () => api.sellersWithSales({ seasonId, functionId }),
    enabled: isAdmin,
  })

  const paginas = useMemo(() => list.data?.pages ?? [], [list.data])
  const sales = useMemo(() => paginas.flatMap((p) => p.sales), [paginas])
  const totals = paginas.at(-1)?.function_totals ?? []
  const summary = paginas[0]?.summary
  const filtrado = paginas[0]?.filtered
  const bloques = useMemo(() => agrupar(sales, totals), [sales, totals])

  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: salesQueryKey })
    void queryClient.invalidateQueries({ queryKey: ['home'] })
    void queryClient.invalidateQueries({ queryKey: ['settlements-report'] })
  }

  // Ordenar es una acción explícita: antes de reordenar se termina de traer lo
  // que falte, porque ordenar media lista y llamarlo "ordenado por total"
  // sería mentir sobre lo que no está cargado.
  async function pedirOrden(col: SortCol) {
    let guardia = 0
    while (list.hasNextPage && !list.isFetchingNextPage && guardia++ < 20) {
      await list.fetchNextPage()
    }
    setSort((prev) => (prev?.col === col ? { col, desc: !prev.desc } : { col, desc: false }))
  }

  function cambiarSeleccion(ids: number[], on: boolean) {
    setSeleccion((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  // Cargar la página siguiente cuando el usuario llega al final.
  useEffect(() => {
    const onScroll = () => {
      if (!list.hasNextPage || list.isFetchingNextPage) return
      const cerca = window.innerHeight + window.scrollY > document.body.offsetHeight - 600
      if (cerca) void list.fetchNextPage()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [list])

  const buscando = debouncedQ.trim() !== ''
  const conFiltro = filter !== 'todas' || functionId !== undefined || sellerId !== undefined || buscando
  const elegidaFn = funciones.data?.functions.find((fn) => fn.id === functionId)
  const elegidaSeller = vendedoras.data?.sellers.find((s) => s.id === sellerId)
  const seleccionadas = sales.filter((s) => seleccion.has(s.id))

  const sub = filtrado
    ? filter === 'deben'
      ? `${filtrado.total_count} ${filtrado.total_count === 1 ? 'venta' : 'ventas'} con pago pendiente`
      : `${filtrado.total_count} ${filtrado.total_count === 1 ? 'venta' : 'ventas'}`
    : undefined

  function limpiarFiltros() {
    setSearchParams({})
    setQ('')
    setFunctionId(undefined)
    setSellerId(undefined)
  }

  return (
    <>
      <PageHead
        title={isAdmin ? 'Ventas' : 'Mis ventas'}
        sub={sub}
        action={{ label: 'Nueva venta', onClick: nuevaVenta.abrir }}
      />
      {nuevaVenta.panel}

      <div className="salesbar">
        {/* La misma franja de Temporadas: un contenedor con divisores, no
            cuatro tarjetas sueltas. Los valores respetan el filtro activo. */}
        {filtrado && (
          <div className="tstrip">
            <div>
              <b>{filtrado.tickets_sold}</b>
              <span>Entradas vendidas</span>
            </div>
            <div>
              <b className="g">{formatMoney(filtrado.paid_cents)}</b>
              <span>Cobrado</span>
            </div>
            <div>
              <b className={filtrado.pending_cents > 0 ? 'y' : undefined}>
                {formatMoney(filtrado.pending_cents)}
              </b>
              <span>Por cobrar</span>
            </div>
            <div>
              <b>{filtrado.comp_tickets}</b>
              <span>Cortesías</span>
            </div>
          </div>
        )}

        <div className="sticky-bar">
          <SearchBar value={q} onChange={setQ} placeholder="Buscar comprador o vendedora…" />
          <div className="stoolbar">
            <FilterChips<UIFilter>
              value={filter}
              onChange={(next) => setSearchParams(next === 'todas' ? {} : { filtro: next })}
              options={[
                { value: 'todas', label: 'Todas', count: summary?.total_count },
                { value: 'deben', label: 'Deben', count: summary?.pending_count, tone: 'warn' },
                { value: 'pagas', label: 'Pagas', count: summary?.paid_count },
                { value: 'cortesias', label: 'Cortesías', count: summary?.comp_count },
              ]}
            />
            <Menu
              trigger="pill"
              label={elegidaFn ? (elegidaFn.name ?? elegidaFn.venue) : 'Todas las funciones'}
              value={functionId === undefined ? 'todas' : String(functionId)}
              groups={[
                {
                  options: [
                    {
                      id: 'todas',
                      label: 'Todas las funciones',
                      hint: summary ? `${summary.total_count} ventas` : undefined,
                      onSelect: () => setFunctionId(undefined),
                    },
                  ],
                },
                {
                  separated: true,
                  options: (funciones.data?.functions ?? []).map((fn) => ({
                    id: String(fn.id),
                    label: fn.name ?? fn.venue,
                    hint: `${functionDay(fn.starts_at)} · ${fn.sold} entradas`,
                    onSelect: () => setFunctionId(fn.id),
                  })),
                },
              ]}
            />
            {isAdmin && (
              <Menu
                trigger="pill"
                label={elegidaSeller ? elegidaSeller.name : 'Todas las vendedoras'}
                value={sellerId === undefined ? 'todas' : String(sellerId)}
                groups={[
                  {
                    options: [
                      {
                        id: 'todas',
                        label: 'Todas las vendedoras',
                        hint: summary ? `${summary.total_count} ventas` : undefined,
                        onSelect: () => setSellerId(undefined),
                      },
                    ],
                  },
                  {
                    separated: true,
                    options: (vendedoras.data?.sellers ?? []).map((v) => ({
                      id: String(v.id),
                      label: v.name,
                      hint: `${v.sales} ${v.sales === 1 ? 'venta' : 'ventas'}`,
                      onSelect: () => setSellerId(v.id),
                    })),
                  },
                ]}
              />
            )}
          </div>
        </div>
      </div>

      {list.isPending ? (
        <p className="muted">Cargando…</p>
      ) : bloques.length === 0 ? (
        conFiltro ? (
          filter === 'deben' && !buscando ? (
            <EmptyState icon={<PartyPopper size={18} />} title="Nadie debe nada">
              Todo lo vendido está cobrado. ¡Gran trabajo!
            </EmptyState>
          ) : (
            <EmptyState icon={<PartyPopper size={18} />} title="No hay ventas que coincidan">
              <button className="button button--ghost" type="button" onClick={limpiarFiltros}>
                Limpiar filtros
              </button>
            </EmptyState>
          )
        ) : (
          <EmptyState icon={<PartyPopper size={18} />} title="Todavía no registraste ventas">
            <button className="button" type="button" onClick={nuevaVenta.abrir}>
              Nueva venta
            </button>
          </EmptyState>
        )
      ) : (
        <div className="sblocks">
          {bloques.map((bloque) => (
            <BloqueFuncion
              key={bloque.functionId}
              bloque={bloque}
              q={debouncedQ}
              isAdmin={isAdmin}
              sort={sort}
              onSort={(col) => void pedirOrden(col)}
              seleccion={seleccion}
              onSeleccion={cambiarSeleccion}
              onAbrir={setAbierta}
              onCambio={refrescar}
            />
          ))}
        </div>
      )}

      {list.isFetchingNextPage && (
        <p className="muted" style={{ textAlign: 'center' }}>
          Cargando más…
        </p>
      )}

      {/* La selección múltiple es de escritorio: en un celular la barra
          flotante tapa la lista y compite con la barra de pestañas. */}
      {escritorio && seleccionadas.length > 0 && (
        <BarraSeleccion
          ventas={seleccionadas}
          onLimpiar={() => setSeleccion(new Set())}
          onCambio={refrescar}
          onAviso={setAviso}
          exportURL={api.salesExportURL({ ...filtros, ids: seleccionadas.map((s) => s.id) })}
        />
      )}

      {aviso && (
        <p className="selbar__msg" role="status" onAnimationEnd={() => setAviso(null)}>
          {aviso}
        </p>
      )}

      {abierta && (
        <SaleSheet sale={abierta} isAdmin={isAdmin} onClose={() => setAbierta(null)} />
      )}
    </>
  )
}
