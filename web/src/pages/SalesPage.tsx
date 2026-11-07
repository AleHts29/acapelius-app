import { useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { SaleListItem, SaleStatusFilter, ShowFunction } from '../api/client'
import { useSession } from '../auth/session'
import { RepartirModal } from '../components/RepartirModal'
import { calendarDaysUntil, dayAndMonthShort, dayLabel, formatMoney, functionTime } from '../lib/format'
import { useIsDesktop } from '../lib/viewport'
import { useSeason } from '../season/SeasonProvider'
import { Button, Search, Seg } from '../ui/Button'
import { Card } from '../ui/Card'
import { Entrada } from '../ui/Entrada'
import { Menu } from '../ui/Menu'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'
import { SaleStatus } from '../ui/Status'
import { useNuevaVenta } from '../ui/useNuevaVenta'
import { SaleSheet, salesQueryKey } from './SaleSheet'

// Ventas (C21). Arriba, las funciones como entradas: la
// elegida grande y naranja con sus cifras y el cupo sin repartir. Abajo, sus
// ventas en filas a todo el ancho. Quién vendió dejó de ser un panel: es el
// filtro "Corista" de la barra, y el ranking por corista vive en Equipo.

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

function falta(iso: string): string {
  const dias = calendarDaysUntil(iso)
  return dias <= 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`
}

/** La función que se abre si no se eligió ninguna: la próxima, o la última. */
function porDefecto(funciones: ShowFunction[]): ShowFunction | undefined {
  return funciones.find((fn) => !yaPaso(fn.starts_at)) ?? funciones.at(-1)
}

// --- La regla de funciones ----------------------------------------------------

function FuncionCell({
  fn,
  recaudado,
  on,
  isAdmin,
  onClick,
  onRepartir,
}: {
  fn: ShowFunction
  recaudado?: number
  on: boolean
  isAdmin: boolean
  onClick: () => void
  onRepartir: () => void
}) {
  const pasada = yaPaso(fn.starts_at)
  const libres = Math.max(fn.capacity - fn.assigned, 0)
  const quedan = Math.max(fn.capacity - fn.sold, 0)
  // AGOTADA en lugar de "80 / 80": un número que no pide nada no merece el
  // mismo espacio que uno que sí (§4.9).
  const cifra = fn.sold >= fn.capacity ? 'AGOTADA' : `${fn.sold}/${fn.capacity}`

  if (!on) {
    return (
      <Entrada
        chica
        label={dayLabel(fn.starts_at)}
        nombre={cifra}
        talon={pasada ? `${fn.entered} entraron` : falta(fn.starts_at)}
        onClick={onClick}
      />
    )
  }
  const partes = [
    recaudado !== undefined ? `${formatMoney(recaudado)} recaudado` : null,
    pasada ? `${fn.entered} entraron` : fn.assigned === 0 ? 'sin repartir' : `quedan ${quedan}`,
  ].filter(Boolean)
  return (
    <Entrada
      chica
      tono="ticket"
      label={`${dayLabel(fn.starts_at)} · ${functionTime(fn.starts_at)}${pasada ? '' : ` · ${falta(fn.starts_at)}`}`}
      nombre={cifra}
      talon={
        <span className="entrada__nota" style={{ margin: 0, display: 'block' }}>
          {partes.join(' · ')}
          {isAdmin && !pasada && libres > 0 && (
            <>
              {' · '}
              <button type="button" onClick={onRepartir}>
                repartir {libres}
              </button>
            </>
          )}
        </span>
      }
    />
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

  // Una venta tocada en Inicio llega en el estado de la navegación. No hay un
  // endpoint de una sola venta y puede ser de otra función: se busca por toda
  // la temporada, se abre, y la lista de atrás pasa a la función de esa venta.
  const location = useLocation()
  const pedida = (location.state as { venta?: { id: number; comprador: string } } | null)?.venta
  const pedidaQ = useQuery({
    queryKey: ['venta-pedida', pedida?.id],
    queryFn: () => api.listSales({ seasonId, q: pedida!.comprador }),
    enabled: pedida !== undefined && seasonId !== undefined,
    gcTime: 0,
  })
  useEffect(() => {
    if (!pedida || (!pedidaQ.data && !pedidaQ.isError)) return
    const venta = pedidaQ.data?.sales.find((v) => v.id === pedida.id)
    const next = new URLSearchParams(searchParams)
    if (venta) {
      setAbierta(venta)
      next.set('fn', String(venta.function_id))
    }
    setSearchParams(next, { replace: true, state: null })
  }, [pedida, pedidaQ.data, pedidaQ.isError, searchParams, setSearchParams])

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

  // Quién tiene cupo en la función elegida: las opciones del filtro "Corista".
  const tablero = useQuery({
    queryKey: ['function-allocations', elegida?.id],
    queryFn: () => api.functionAllocations(elegida!.id),
    enabled: isAdmin && elegida !== undefined,
  })
  const coristas = (tablero.data?.allocations ?? [])
    .filter((a) => a.assigned > 0 || a.sold > 0)
    .sort((a, b) => b.sold - a.sold)

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
  const seller =
    sellerId !== undefined
      ? (coristas.find((c) => c.user_id === sellerId)?.seller_name ??
        sales.find((s) => s.seller_id === sellerId)?.seller_name)
      : undefined

  const titulo = buscando
    ? 'Resultados · toda la temporada'
    : `Ventas · ${elegida ? dayAndMonthShort(elegida.starts_at) : ''}${seller ? ` · ${primerNombre(seller)}` : ''}`

  const filtroCorista = isAdmin && (
    <Menu
      trigger="btn"
      ariaLabel="Filtrar por corista"
      label={seller ? primerNombre(seller) : 'Corista'}
      value={sellerId !== undefined ? String(sellerId) : 'todas'}
      align="right"
      groups={[
        {
          options: [{ id: 'todas', label: 'Todas las coristas', onSelect: () => setSellerId(undefined) }],
        },
        {
          label: elegida ? `Con cupo el ${dayAndMonthShort(elegida.starts_at)}` : undefined,
          options: coristas.map((c) => ({
            id: String(c.user_id),
            label: c.seller_name,
            hint: `vendió ${c.sold} de ${c.assigned}`,
            onSelect: () => setSellerId(c.user_id),
          })),
        },
      ]}
    />
  )

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
                  sale.over_capacity ? 'sobre cupo' : null,
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
        <div className="entradas">
          {funciones.map((fn) => (
            <FuncionCell
              key={fn.id}
              fn={fn}
              recaudado={recaudado.get(fn.id)}
              on={!buscando && fn.id === elegida?.id}
              isAdmin={isAdmin}
              onClick={() => elegir(fn.id)}
              onRepartir={() => setRepartir(true)}
            />
          ))}
        </div>
      )}

      {funcionesQ.isPending ? (
        <p className="rs">Cargando…</p>
      ) : funciones.length === 0 ? (
        <Card title="Esta temporada todavía no tiene funciones">
          <p className="rs" style={{ whiteSpace: 'normal', margin: 0 }}>
            Cuando haya funciones cargadas, las ventas aparecen acá, una función por vez.
          </p>
        </Card>
      ) : (
        <div>
          <div className="bar">
            <Search
              aria-label="Buscar venta"
              placeholder={isAdmin ? 'Buscar comprador, mail o corista' : 'Buscar comprador o mail'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Seg<Filtro> label="Filtrar ventas" value={filtro} onChange={filtrar} options={FILTROS} />
            {filtroCorista}
          </div>
          {lista}
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
