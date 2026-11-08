import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { DireccionFinding, DireccionFunction } from '../api/client'
import { RepartirModal } from '../components/RepartirModal'
import { useSeason } from '../season/SeasonProvider'
import { calendarDaysUntil, dayLabel, formatMoney } from '../lib/format'
import { Card } from '../ui/Card'
import { Carrusel } from '../ui/Carrusel'
import { Entrada } from '../ui/Entrada'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'
import { Rule, RuleCell } from '../ui/Rule'

// Dirección (C20) contesta "¿cómo viene la temporada?". Arriba la regla de
// cifras —dónde está la plata—, después las funciones en un carrusel de afiches
// con sello si se destacan, y en dos columnas quién todavía
// debe y lo que hay que mirar. No repite Inicio: la próxima función vive allá.
// La tarjeta "Administración" que nombra §7.2 no existe en este repo: la
// navegación sólo vive en la lateral y en las pestañas.

const sinCentavos = (cents: number) => formatMoney(cents).replace('$', '').trim()
const nombre = (fn: DireccionFunction) => fn.name ?? fn.venue

/** Lo que hace distinta a una función, en dos palabras. Una sola por afiche. */
function selloDe(fn: DireccionFunction, funciones: DireccionFunction[]): { texto: string; tono: string } | null {
  if (!fn.done) return { texto: 'En venta', tono: 'venta' }
  if (funciones.length < 2) return null
  const hechas = funciones.filter((f) => f.done)
  if (fn.collected_cents > 0 && fn.collected_cents === Math.max(...funciones.map((f) => f.collected_cents))) {
    return { texto: 'Más recaudó', tono: 'venta' }
  }
  if (fn.attendance_pct === Math.max(...hechas.map((f) => f.attendance_pct))) {
    return { texto: 'Más asistencia', tono: 'ok' }
  }
  return fn.attendance_pct < 60 ? { texto: 'Asistencia baja', tono: 'warn' } : null
}

/** Lo que muestran por igual el afiche de una función y el de la temporada. */
function CifrasAfiche({ fn }: { fn: DireccionFunction }) {
  const hubo = fn.attendance_pct >= 0
  return (
    <>
      <div className="afiche__m">
        <div>
          <span className="lbl">Vendió</span>
          <b>{fn.occupancy_pct}%</b>
        </div>
        <span className="afiche__bar" aria-hidden>
          <i style={{ width: `${Math.min(fn.occupancy_pct, 100)}%` }} />
        </span>
        <span className="afiche__s">
          {fn.sold} de {fn.capacity} entradas
        </span>
      </div>
      <div className="afiche__m">
        <div>
          <span className="lbl">Asistió</span>
          <b>{hubo ? `${fn.attendance_pct}%` : '—'}</b>
        </div>
        <span className="afiche__bar" aria-hidden>
          <i className={hubo && fn.attendance_pct < 60 ? 'warn' : undefined} style={{ width: `${hubo ? fn.attendance_pct : 0}%` }} />
        </span>
        <span className="afiche__s">{hubo ? `${fn.entered} de ${fn.sold} que compraron` : 'Todavía no fue la función'}</span>
      </div>
      <div className="afiche__p">
        <div>
          <span className="lbl">Recaudó</span>
          <b>{formatMoney(fn.collected_cents)}</b>
        </div>
        <span className="afiche__s">
          {formatMoney(fn.ticket_avg_cents)} por entrada · {fn.comp_tickets} {fn.comp_tickets === 1 ? 'cortesía' : 'cortesías'}
        </span>
      </div>
    </>
  )
}

/** Las funciones en un carrusel de afiches, y la temporada al final en negro. */
function Afiches({ totales, funciones, temporada }: { totales: DireccionFunction; funciones: DireccionFunction[]; temporada: { id: number; name: string } }) {
  const proxima = funciones.find((fn) => calendarDaysUntil(fn.starts_at) >= 0)
  return (
    <Carrusel titulo={<h2 className="lbl">Las funciones</h2>} label="Las funciones de la temporada">
      {funciones.map((fn) => {
        const sello = selloDe(fn, funciones)
        return (
          <Entrada
            key={fn.id}
            className="afiche-e"
            tono={fn.id === proxima?.id ? 'ticket' : 'papel'}
            label={dayLabel(fn.starts_at)}
            nombre={nombre(fn)}
            datos={
              // El lugar del sello se reserva: las cifras quedan a la misma altura.
              <span className={sello ? `afiche__sello afiche__sello--${sello.tono}` : 'afiche__sello afiche__sello--no'}>
                {sello?.texto ?? '—'}
              </span>
            }
            talon={<div className="afiche__c"><CifrasAfiche fn={fn} /></div>}
            to={`/temporadas/${temporada.id}?fn=${fn.id}`}
          />
        )
      })}
      <article className="afiche afiche--total">
        <div>
          <span className="lbl">
            {funciones.length === 1 ? 'La función' : `Las ${funciones.length} funciones`}
          </span>
          <h3 className="afiche__t">{temporada.name}</h3>
        </div>
        <span className="afiche__sello afiche__sello--no">—</span>
        <CifrasAfiche fn={totales} />
      </article>
    </Carrusel>
  )
}

function HallazgoRow({ find, onRepartir }: { find: DireccionFinding; onRepartir: () => void }) {
  const navigate = useNavigate()
  const ir = () => {
    if (find.kind === 'attendance')
      navigate(find.function_id ? `/panel/asistencia?fn=${find.function_id}` : '/panel/asistencia')
    else if (find.kind === 'unassigned') onRepartir()
    else navigate('/ventas?filtro=cortesias')
  }
  return (
    <Row
      title={`${find.value}${find.suffix ? ` ${find.suffix}` : ''}`}
      // La conclusión se lee entera: es lo que hay que mirar.
      sub={<span style={{ whiteSpace: 'normal' }}>{find.body}</span>}
      onClick={ir}
    />
  )
}

export function DireccionPage() {
  const { season } = useSeason()
  const seasonId = season?.id
  const [repartiendo, setRepartiendo] = useState(false)

  const data = useQuery({
    queryKey: ['direccion', seasonId],
    queryFn: () => api.direccion(seasonId!),
    enabled: seasonId !== undefined,
  })
  const rendiciones = useQuery({
    queryKey: ['settlements-report', seasonId],
    queryFn: () => api.settlementsReport(seasonId!),
    enabled: seasonId !== undefined,
  })

  if (!season) {
    return (
      <>
        <PageHeader title="Dirección" />
        <Card title="Todavía no hay temporadas">
          <Link className="btn btn--go" to="/temporadas?nueva=1">
            Crear la primera temporada
          </Link>
        </Card>
      </>
    )
  }
  if (data.isPending) return <p className="rs">Cargando…</p>
  if (!data.data) return <p className="st st--bad">No se pudo cargar la temporada.</p>

  const d = data.data
  const hechas = d.functions.filter((fn) => fn.done).length
  const cronologicas = [...d.functions].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  const deben = (rendiciones.data?.rows ?? [])
    .filter((r) => r.balance_cents > 0)
    .sort((a, b) => b.balance_cents - a.balance_cents)

  return (
    <>
      <PageHeader
        title={season.name}
        label={`${hechas} de ${d.functions.length} ${d.functions.length === 1 ? 'función hecha' : 'funciones hechas'} · ${d.totals.occupancy_pct}% vendido · ${d.totals.attendance_pct}% asistió`}
      />

      <Rule kpis>
        <RuleCell
          ojo
          label="Vendido en la temporada"
          value={formatMoney(d.money.sold_cents)}
          sub={`${formatMoney(d.totals.collected_cents)} recaudado`}
        />
        <RuleCell label="En tu poder" value={formatMoney(d.money.in_hand_cents)} tone="ok" sub="ya rendido" />
        <RuleCell
          label="Sin rendir"
          value={formatMoney(d.money.unsettled_cents)}
          tone={d.money.unsettled_cents > 0 ? 'warn' : undefined}
          sub={`${d.money.sellers_owing} ${d.money.sellers_owing === 1 ? 'corista' : 'coristas'}`}
        />
        <RuleCell
          label="Sin cobrar"
          value={formatMoney(d.money.uncollected_cents)}
          tone={d.money.uncollected_cents > 0 ? 'warn' : undefined}
          sub={`${d.money.sales_uncollected} ${d.money.sales_uncollected === 1 ? 'venta' : 'ventas'}`}
        />
      </Rule>

      <section className="grp">
        <Afiches totales={d.totals} funciones={cronologicas} temporada={season} />
      </section>

      <div className="cols cols--2">
        <div>
          <Card
            title="Quién todavía debe"
            footer={
              deben.length > 3 ? (
                <>
                  <span>3 de {deben.length}</span>
                  <Link to="/panel/rendiciones">Ver las {deben.length}</Link>
                </>
              ) : undefined
            }
          >
            {deben.length === 0 ? (
              <Row title="Nadie" sub="Toda la plata cobrada está en tu poder" />
            ) : (
              deben.slice(0, 3).map((r) => (
                <Row
                  key={r.seller_id}
                  title={r.seller_name}
                  sub={`cobró ${sinCentavos(r.collected_cents)} · rindió ${sinCentavos(r.settled_cents)}`}
                  amount={sinCentavos(r.balance_cents)}
                  unit="debe"
                  to={`/panel/rendiciones/${r.seller_id}`}
                />
              ))
            )}
          </Card>
        </div>

        <div>
          <Card title="Lo que hay que mirar">
            {d.findings.length === 0 ? (
              <Row title="Nada por ahora" sub="Cuando haya algo que mirar aparece acá" />
            ) : (
              d.findings.map((find) => (
                <HallazgoRow key={find.kind} find={find} onRepartir={() => setRepartiendo(true)} />
              ))
            )}
          </Card>
        </div>
      </div>
      {repartiendo && (
        <RepartirModal
          funciones={d.functions.filter((fn) => !fn.done)}
          inicial={d.in_sale ?? undefined}
          onClose={() => setRepartiendo(false)}
        />
      )}
    </>
  )
}
