import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { SaleListItem } from '../api/client'
import { dayAndMonthShort, formatMoney } from '../lib/format'
import { useSeason } from '../season/SeasonProvider'
import { Figure, SubFigs } from '../ui/Figure'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'

// Mi plata (C19 §5.9 y §7.1): lo que la corista cobró y todavía no rindió,
// de dónde sale y lo que ya entregó. Es sólo lo suyo: el backend acota
// /sales, /settlements y la home a la corista que pregunta.

const sinCentavos = (cents: number) => formatMoney(cents).replace('$', '').trim()

/** Todas sus ventas de la temporada: el listado viene paginado. */
async function todasMisVentas(seasonId: number): Promise<SaleListItem[]> {
  const out: SaleListItem[] = []
  let cursor: string | undefined
  for (let pagina = 0; pagina < 20; pagina++) {
    const res = await api.listSales({ seasonId, mine: true, cursor })
    out.push(...res.sales)
    if (!res.next_cursor) break
    cursor = res.next_cursor
  }
  return out
}

export function MiPlataPage() {
  const { seasonId, season } = useSeason()
  const home = useQuery({ queryKey: ['home', seasonId], queryFn: () => api.home(seasonId) })
  const ventas = useQuery({
    queryKey: ['sales', 'mi-plata', seasonId],
    queryFn: () => todasMisVentas(seasonId!),
    enabled: seasonId !== undefined,
  })
  const rendiciones = useQuery({
    queryKey: ['settlements-history', seasonId, 'mias'],
    queryFn: () => api.listSettlements(seasonId!),
    enabled: seasonId !== undefined,
  })

  const mio = home.data?.my_settlement
  if (home.isPending) return <p className="rs">Cargando…</p>
  if (!mio) return <p className="st st--bad">No se pudo cargar tu plata.</p>

  const debe = Math.max(mio.balance_cents, 0)
  // De dónde sale: lo que ya cobró de cada venta, la misma cuenta que usa
  // dirección para su rendición (ventas vivas, no cortesías, con algo cobrado).
  const cobradas = (ventas.data ?? [])
    .filter((s) => s.voided_at === null && !s.is_comp && s.paid_cents > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const entregas = rendiciones.data?.settlements ?? []

  return (
    <>
      <PageHeader title="Mi plata" label={season?.name} />

      <div style={{ marginBottom: 'var(--s5)' }}>
        <Figure label={debe > 0 ? 'Tenés que rendir' : 'Estás al día'} tone={debe > 0 ? 'warn' : 'ok'}>
          {formatMoney(debe)}
        </Figure>
        <div style={{ marginTop: 'var(--s4)' }}>
          <SubFigs
            items={[
              { label: `Cobraste · ${mio.sales} ${mio.sales === 1 ? 'venta' : 'ventas'}`, value: formatMoney(mio.collected_cents) },
              { label: 'Ya rendiste', value: formatMoney(mio.settled_cents), tone: 'ok' },
            ]}
          />
        </div>
      </div>

      <div className="asym">
        <section className="grp" style={{ margin: 0 }}>
          <div className="grp__h">
            <h2 className="lbl">De dónde sale</h2>
            <span className="grp__n">{formatMoney(mio.collected_cents)} cobrado</span>
          </div>
          <div className="card">
            {ventas.isPending ? (
              <Row title="Cargando…" />
            ) : cobradas.length === 0 ? (
              <Row title="Todavía no cobraste ninguna venta" />
            ) : (
              cobradas.map((s) => (
                <Row
                  key={s.id}
                  title={s.buyer_name}
                  sub={`${s.quantity} ${s.quantity === 1 ? 'entrada' : 'entradas'} · ${dayAndMonthShort(s.function_starts_at)}`}
                  amount={sinCentavos(s.paid_cents)}
                />
              ))
            )}
          </div>
        </section>

        <section className="grp" style={{ margin: 0 }}>
          <div className="grp__h">
            <h2 className="lbl">Ya rendiste</h2>
            <span className="grp__n">{formatMoney(mio.settled_cents)}</span>
          </div>
          <div className="card">
            {rendiciones.isPending ? (
              <Row title="Cargando…" />
            ) : entregas.length === 0 ? (
              <Row title="Todavía no rendiste nada" />
            ) : (
              entregas.map((e) => (
                <Row
                  key={e.id}
                  title={`${dayAndMonthShort(e.created_at)} · ${e.method === 'cash' ? 'efectivo' : 'transferencia'}`}
                  sub={e.notes ? `“${e.notes}”` : 'se lo diste a dirección'}
                  amount={sinCentavos(e.amount_cents)}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </>
  )
}
