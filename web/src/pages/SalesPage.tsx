import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { SaleListItem, SaleStatusFilter, ShowFunction } from '../api/client'
import { useSession } from '../auth/session'
import { RepartirModal } from '../components/RepartirModal'
import { calendarDaysUntil, dayAndMonthShort, dayLabel, formatMoney } from '../lib/format'
import { useIsDesktop } from '../lib/viewport'
import { useSeason } from '../season/SeasonProvider'
import { Button, Search, Seg } from '../ui/Button'
import { Card } from '../ui/Card'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'
import { SaleStatus } from '../ui/Status'
import { FnTile } from '../ui/Tile'
import { useNuevaVenta } from '../ui/useNuevaVenta'
import { SaleSheet, salesQueryKey } from './SaleSheet'

// Ventas (C19 §5.2, design/acapelius-B-entidades.html §01). Arriba se elige la
// función —una ENTIDAD, en tarjeta—; abajo, sus ventas —TRANSACCIONES, en
// fila— y quién vendió. Una sola función visible por vez.

type Filtro = 'todas' | 'deben' | 'pagas' | 'cortesias' | 'anuladas'
const A_STATUS: Record<Filtro, SaleStatusFilter | undefined> = {
  todas: undefined,
  deben: 'pending',
  pagas: 'paid',
  cortesias: 'comp',
  anuladas: 'void',
}
const FILTROS: Array<{ value: Filtro; label: string }> = [
  { value: 'todas', label: 'Todas' },
  { value: 'deben', label: 'Debe' },
  { value: 'pagas', label: 'Pagó' },
  { value: 'cortesias', label: 'Cortesías' },
  { value: 'anuladas', label: 'Anuladas' },
]

function parseFiltro(raw: string | null): Filtro {
  return FILTROS.some((f) => f.value === raw) ? (raw as Filtro) : 'todas'
}

/** La misma gracia que Inicio y Temporadas: a las 21:00 la de las 20:00 no "pasó". */
const GRACIA_MS = 3 * 60 * 60 * 1000
const yaPaso = (iso: string) => new Date(iso).getTime() < Date.now() - GRACIA_MS

/** Las que se muestran antes de "Ver todas". */
const PRIMERAS = 5

function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre
}

// --- La tira de funciones -----------------------------------------------------

function FuncionTile({
  fn,
  recaudado,
  on,
  onClick,
}: {
  fn: ShowFunction
  recaudado?: number
  on: boolean
  onClick: () => void
}) {
  const pasada = yaPaso(fn.starts_at)
  const dias = calendarDaysUntil(fn.starts_at)
  const falta = dias <= 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`
  const pct = fn.capacity > 0 ? Math.round((fn.sold / fn.capacity) * 100) : 0
  return (
    <FnTile
      label={pasada ? dayLabel(fn.starts_at) : `${dayLabel(fn.starts_at)} · ${falta}`}
      // AGOTADA en lugar de "80 / 80": un número que no pide nada no merece
      // el mismo espacio que uno que sí (§4.9).
      date={fn.sold >= fn.capacity ? 'AGOTADA' : `${fn.sold} / ${fn.capacity}`}
      venue={
        pasada
          ? `${fn.entered} entraron`
          : fn.assigned === 0
            ? 'sin repartir'
            : `quedan ${Math.max(fn.capacity - fn.sold, 0)}`
      }
      bar={{ value: fn.sold, max: fn.capacity, tone: pasada ? 'ok' : undefined }}
      quantity={`${pct}%`}
      aside={recaudado !== undefined ? <span className="rs">{formatMoney(recaudado)}</span> : undefined}
      on={on}
      onClick={onClick}
    />
  )
}

/** La función que se abre si no se eligió ninguna: la próxima, o la última. */
function porDefecto(funciones: ShowFunction[]): ShowFunction | undefined {
  return funciones.find((fn) => !yaPaso(fn.starts_at)) ?? funciones.at(-1)
}

// --- Quién vendió -------------------------------------------------------------

function QuienVendio({
  fn,
  sellerId,
  onSeller,
  onRepartir,
}: {
  fn: ShowFunction
  sellerId?: number
  onSeller: (id: number | undefined) => void
  onRepartir: () => void
}) {
  const tablero = useQuery({
    queryKey: ['function-allocations', fn.id],
    queryFn: () => api.functionAllocations(fn.id),
  })
  const filas = (tablero.data?.allocations ?? [])
    .filter((a) => a.assigned > 0 || a.sold > 0)
    .sort((a, b) => b.sold - a.sold)
  const libres = Math.max(fn.capacity - fn.assigned, 0)

  return (
    <section className="grp" style={{ margin: 0 }}>
      <div className="grp__h">
        <h2 className="lbl">Quién vendió</h2>
        <span className="grp__n">{dayAndMonthShort(fn.starts_at)}</span>
      </div>
      <div className="card">
        {tablero.isPending && <Row title="Cargando…" />}
        {!tablero.isPending && filas.length === 0 && <Row title="Todavía no hay cupo repartido" />}
        {filas.map((a) => (
          <Row
            key={a.user_id}
            title={a.seller_name}
            sub={
              <div className="tile__bar" aria-hidden>
                <i style={{ width: `${a.assigned > 0 ? Math.min(100, (a.sold / a.assigned) * 100) : 0}%` }} />
              </div>
            }
            amount={a.sold}
            // Tocar una corista filtra la lista por ella; tocarla de nuevo, saca el filtro.
            onClick={() => onSeller(sellerId === a.user_id ? undefined : a.user_id)}
            dim={sellerId !== undefined && sellerId !== a.user_id}
          />
        ))}
        {!yaPaso(fn.starts_at) && libres > 0 && (
          <div className="card__f">
            <span>Sin repartir</span>
            <button className="card__a" type="button" onClick={onRepartir}>
              {libres} {libres === 1 ? 'entrada' : 'entradas'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

// --- Pantalla ----------------------------------------------------------------

export function SalesPage() {
  const { user } = useSession()
  const isAdmin = user?.role === 'admin'
  const escritorio = useIsDesktop()
  const nuevaVenta = useNuevaVenta()
  const { seasonId, season } = useSeason()

  const [searchParams, setSearchParams] = useSearchParams()
  const filtro = parseFiltro(searchParams.get('filtro'))
  const fnDeURL = Number(searchParams.get('fn')) || undefined
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [sellerId, setSellerId] = useState<number | undefined>(undefined)
  const [verTodas, setVerTodas] = useState(false)
  const [abierta, setAbierta] = useState<SaleListItem | null>(null)
  const [repartir, setRepartir] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 250)
    return () => clearTimeout(id)
  }, [q])

  const funcionesQ = useQuery({
    queryKey: ['functions', seasonId],
    queryFn: () => api.listFunctions(seasonId),
    enabled: seasonId !== undefined,
  })
  // Lo recaudado por función sale del resumen de dirección.
  const resumenQ = useQuery({
    queryKey: ['functions-summary', seasonId],
    queryFn: () => api.functionsSummary(seasonId!),
    enabled: isAdmin && seasonId !== undefined,
  })
  const funciones = useMemo(() => funcionesQ.data?.functions ?? [], [funcionesQ.data])
  const elegida = funciones.find((fn) => fn.id === fnDeURL) ?? porDefecto(funciones)
  const recaudado = new Map((resumenQ.data?.functions ?? []).map((f) => [f.id, f.collected_cents]))

  const elegir = (id: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('fn', String(id))
    setSearchParams(next, { replace: true })
    setSellerId(undefined)
    setVerTodas(false)
  }
  const filtrar = (f: Filtro) => {
    const next = new URLSearchParams(searchParams)
    if (f === 'todas') next.delete('filtro')
    else next.set('filtro', f)
    setSearchParams(next, { replace: true })
  }

  // Buscar es por toda la temporada: quien busca a "Roberto" no siempre sabe
  // a qué función fue. Sin búsqueda, la lista es la de la función elegida.
  const buscando = debouncedQ.trim() !== ''
  const filtros = {
    seasonId,
    q: debouncedQ || undefined,
    status: A_STATUS[filtro],
    functionId: buscando ? undefined : elegida?.id,
    sellerId: isAdmin ? sellerId : undefined,
  }

  const list = useInfiniteQuery({
    queryKey: [...salesQueryKey, filtros],
    queryFn: ({ pageParam }) => api.listSales({ ...filtros, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor,
    enabled: seasonId !== undefined && (buscando || elegida !== undefined),
  })

  const paginas = list.data?.pages ?? []
  const sales = paginas.flatMap((p) => p.sales)
  const filtrado = paginas[0]?.filtered
  const visibles = verTodas || buscando ? sales : sales.slice(0, PRIMERAS)
  const total = filtrado?.total_count ?? 0

  const vendidas = funciones.reduce((acc, fn) => acc + fn.sold, 0)
  const capacidad = funciones.reduce((acc, fn) => acc + fn.capacity, 0)
  const seller = sellerId !== undefined ? sales.find((s) => s.seller_id === sellerId)?.seller_name : undefined

  const titulo = buscando
    ? 'Resultados · toda la temporada'
    : `Ventas · ${elegida ? dayAndMonthShort(elegida.starts_at) : ''}${seller ? ` · ${primerNombre(seller)}` : ''}`

  const lista = (
    <section className="grp" style={{ margin: 0 }}>
      <div className="grp__h">
        <h2 className="lbl">{titulo}</h2>
        {filtrado && (
          <span className="grp__n">
            {filtrado.tickets_sold} {filtrado.tickets_sold === 1 ? 'entrada' : 'entradas'}
            {filtrado.paid_cents > 0 && ` · ${formatMoney(filtrado.paid_cents)}`}
          </span>
        )}
      </div>
      <div className="card">
        {list.isPending ? (
          <Row title="Cargando…" />
        ) : sales.length === 0 ? (
          <Row
            title={
              filtro === 'deben' && !buscando
                ? 'Nadie debe nada en esta función'
                : buscando || filtro !== 'todas' || sellerId !== undefined
                  ? 'No hay ventas que coincidan'
                  : 'Todavía no hay ventas en esta función'
            }
          />
        ) : (
          visibles.map((sale) => {
            const anulada = sale.voided_at !== null
            const monto = sale.is_comp ? '—' : formatMoney(sale.amount_cents).replace('$', '').trim()
            const cuantas = `${sale.quantity} ${sale.quantity === 1 ? 'entrada' : 'entradas'}`
            const sub = anulada
              ? `anulada el ${dayAndMonthShort(sale.voided_at!)}`
              : [
                  buscando ? dayAndMonthShort(sale.function_starts_at) : null,
                  isAdmin ? primerNombre(sale.seller_name) : null,
                  cuantas,
                  escritorio ? null : monto,
                ]
                  .filter(Boolean)
                  .join(' · ')
            return (
              <Row
                key={sale.id}
                title={sale.buyer_name}
                sub={sub}
                amount={escritorio ? monto : undefined}
                status={<SaleStatus sale={sale} />}
                dim={anulada}
                off={anulada}
                onClick={() => setAbierta(sale)}
              />
            )
          })
        )}
        {!list.isPending && sales.length > 0 && (
          <div className="card__f">
            <span>
              {visibles.length} de {total}
            </span>
            {!verTodas && !buscando && total > PRIMERAS ? (
              <button className="card__a" type="button" onClick={() => setVerTodas(true)}>
                Ver todas
              </button>
            ) : list.hasNextPage ? (
              <button
                className="card__a"
                type="button"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
              </button>
            ) : sellerId !== undefined ? (
              <button className="card__a" type="button" onClick={() => setSellerId(undefined)}>
                Ver de todas
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )

  return (
    <>
      <PageHeader
        title={isAdmin ? 'Ventas' : 'Mis ventas'}
        label={season ? `${season.name} · ${vendidas} de ${capacidad} entradas` : undefined}
        actions={
          <>
            {isAdmin && escritorio && (
              <a className="btn" href={api.salesExportURL(filtros)} download>
                Exportar
              </a>
            )}
            <Button go onClick={nuevaVenta.abrir}>
              Nueva venta
            </Button>
          </>
        }
      />
      {nuevaVenta.panel}

      {funciones.length > 0 && (
        <div className="tiles tiles--5" style={{ marginBottom: 'var(--s5)' }}>
          {funciones.map((fn) => (
            <FuncionTile
              key={fn.id}
              fn={fn}
              recaudado={recaudado.get(fn.id)}
              on={!buscando && fn.id === elegida?.id}
              onClick={() => elegir(fn.id)}
            />
          ))}
        </div>
      )}

      {funcionesQ.isPending ? (
        <p className="rs">Cargando…</p>
      ) : funciones.length === 0 ? (
        <Card title="Esta temporada todavía no tiene funciones">
          <p className="rs" style={{ padding: '0 var(--s3) var(--s3)', whiteSpace: 'normal', margin: 0 }}>
            Cuando haya funciones cargadas, las ventas aparecen acá, una función por vez.
          </p>
        </Card>
      ) : (
        <div className={isAdmin ? 'asym' : undefined}>
          <div>
            <div className="bar">
              <Search
                aria-label="Buscar venta"
                placeholder={isAdmin ? 'Buscar comprador, mail o corista' : 'Buscar comprador o mail'}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <Seg<Filtro> label="Filtrar ventas" value={filtro} onChange={filtrar} options={FILTROS} />
            </div>
            {lista}
          </div>
          {isAdmin && elegida && (
            <QuienVendio
              fn={elegida}
              sellerId={sellerId}
              onSeller={setSellerId}
              onRepartir={() => setRepartir(true)}
            />
          )}
        </div>
      )}

      {abierta && <SaleSheet sale={abierta} isAdmin={isAdmin} onClose={() => setAbierta(null)} />}
      {repartir && elegida && resumenQ.data && (
        <RepartirModal
          funciones={resumenQ.data.functions}
          inicial={resumenQ.data.functions.find((f) => f.id === elegida.id)}
          onClose={() => setRepartir(false)}
        />
      )}
    </>
  )
}
