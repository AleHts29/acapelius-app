import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { Direccion, DireccionFinding, DireccionFunction } from '../api/client'
import { RepartirModal } from '../components/RepartirModal'
import { useSeason } from '../season/SeasonProvider'
import { dayLabel, formatMoney } from '../lib/format'
import { Card } from '../ui/Card'
import { Figure, SubFigs } from '../ui/Figure'
import { Modal } from '../ui/Modal'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'
import { Status } from '../ui/Status'

// Dirección (C19 §5.6) contesta "¿cómo viene la temporada?". No repite Inicio
// —la próxima función y "falta cobrar" viven allá—: acá va dónde está la
// plata, quién todavía debe, cómo rindió cada función y lo que hay que mirar.
// La tarjeta "Administración" que nombra §7.2 no existe en este repo: la
// navegación sólo vive en la lateral y en las pestañas.

const sinCentavos = (cents: number) => formatMoney(cents).replace('$', '').trim()
const nombre = (fn: DireccionFunction) => fn.name ?? fn.venue

/** Cuánto vendió y cuánta gente fue, con el estado de asistencia en palabras. */
function FuncionRow({ fn, seasonId }: { fn: DireccionFunction; seasonId: number }) {
  const navigate = useNavigate()
  return (
    <Row
      title={`${dayLabel(fn.starts_at)} · ${nombre(fn)}`}
      sub={fn.done ? `recaudó ${sinCentavos(fn.collected_cents)}` : 'en venta'}
      amount={`${fn.occupancy_pct}%`}
      unit="vendido"
      status={
        fn.attendance_pct < 0 ? (
          <Status tone="mute">Todavía no</Status>
        ) : (
          <Status tone={fn.attendance_pct < 60 ? 'warn' : 'ok'}>Asistió {fn.attendance_pct}%</Status>
        )
      }
      onClick={() => navigate(`/temporadas/${seasonId}?fn=${fn.id}`)}
    />
  )
}

/** Todo lo que no entra en la lista: una fila por función con sus números. */
function Comparacion({ data, onClose }: { data: Direccion; onClose: () => void }) {
  const t = data.totals
  const peor = data.functions
    .filter((fn) => fn.attendance_pct >= 0)
    .sort((a, b) => a.attendance_pct - b.attendance_pct)[0]
  const masRecaudo = [...data.functions].sort((a, b) => b.collected_cents - a.collected_cents)[0]
  const fila = (fn: DireccionFunction, titulo: string) => (
    <Row
      key={titulo}
      title={titulo}
      sub={`vendido ${fn.occupancy_pct}% · ${fn.attendance_pct < 0 ? 'todavía no' : `asistió ${fn.attendance_pct}%`} · ${fn.comp_tickets} cortesías`}
      amount={sinCentavos(fn.collected_cents)}
      unit={`prom. ${sinCentavos(fn.ticket_avg_cents)}`}
    />
  )
  return (
    <Modal open onClose={onClose} label="Comparación" title="Las funciones, una al lado de la otra" sub="Ordenadas por fecha">
      <div className="mini">
        {data.functions.map((fn) => fila(fn, `${dayLabel(fn.starts_at)} · ${nombre(fn)}`))}
      </div>
      <div className="mini">{fila(t, 'Total de la temporada')}</div>
      {peor && masRecaudo && peor.attendance_pct < 60 && (
        <p className="rs" style={{ whiteSpace: 'normal', margin: 0 }}>
          {masRecaudo.id === peor.id
            ? `${nombre(peor)} recaudó más que ninguna pero sólo entró el ${peor.attendance_pct}% de quienes compraron.`
            : `${nombre(peor)} fue la de peor asistencia: entró el ${peor.attendance_pct}% de quienes compraron.`}
        </p>
      )}
    </Modal>
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
  const [comparando, setComparando] = useState(false)
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
          <p className="rs" style={{ padding: '0 var(--s3) var(--s3)', margin: 0 }}>
            <Link to="/temporadas">Creá la primera</Link> para empezar.
          </p>
        </Card>
      </>
    )
  }
  if (data.isPending) return <p className="rs">Cargando…</p>
  if (!data.data) return <p className="st st--bad">No se pudo cargar la temporada.</p>

  const d = data.data
  const hechas = d.functions.filter((fn) => fn.done).length
  const ordenadas = [...d.functions].sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())
  const deben = (rendiciones.data?.rows ?? [])
    .filter((r) => r.balance_cents > 0)
    .sort((a, b) => b.balance_cents - a.balance_cents)

  return (
    <>
      <PageHeader
        title="Cómo viene la temporada"
        label={`${season.name} · ${hechas} de ${d.functions.length} ${d.functions.length === 1 ? 'función hecha' : 'funciones hechas'}`}
      />

      <div style={{ marginBottom: 'var(--s5)' }}>
        <Figure label="Vendido en la temporada">{formatMoney(d.money.sold_cents)}</Figure>
        <div style={{ marginTop: 'var(--s4)' }}>
          <SubFigs
            items={[
              { label: 'En tu poder', value: formatMoney(d.money.in_hand_cents), tone: 'ok' },
              {
                label: `Sin rendir · ${d.money.sellers_owing} ${d.money.sellers_owing === 1 ? 'corista' : 'coristas'}`,
                value: formatMoney(d.money.unsettled_cents),
                tone: d.money.unsettled_cents > 0 ? 'warn' : undefined,
              },
              {
                label: `Sin cobrar · ${d.money.sales_uncollected} ${d.money.sales_uncollected === 1 ? 'venta' : 'ventas'}`,
                value: formatMoney(d.money.uncollected_cents),
              },
            ]}
          />
        </div>
      </div>

      <div className="asym">
        <section className="grp" style={{ margin: 0 }}>
          <div className="grp__h">
            <h2 className="lbl">Las funciones</h2>
            <span className="grp__n">
              {d.totals.occupancy_pct}% vendido · {d.totals.attendance_pct}% asistió
            </span>
          </div>
          <div className="card">
            {ordenadas.map((fn) => (
              <FuncionRow key={fn.id} fn={fn} seasonId={season.id} />
            ))}
            <div className="card__f">
              <span>{formatMoney(d.totals.collected_cents)} recaudado</span>
              <button className="card__a" type="button" onClick={() => setComparando(true)}>
                Ver la comparación
              </button>
            </div>
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
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

          {d.findings.length > 0 && (
            <Card title="Lo que hay que mirar">
              {d.findings.map((find) => (
                <HallazgoRow key={find.kind} find={find} onRepartir={() => setRepartiendo(true)} />
              ))}
            </Card>
          )}
        </div>
      </div>

      {comparando && <Comparacion data={d} onClose={() => setComparando(false)} />}
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
