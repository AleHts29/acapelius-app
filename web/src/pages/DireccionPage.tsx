import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { Direccion, DireccionFinding, DireccionFunction } from '../api/client'
import { AllocationsEditor } from '../components/AllocationsEditor'
import { useSeason } from '../season/SeasonProvider'
import { dayLabel, formatMoney } from '../lib/format'
import { initials } from '../lib/search'
import { ActionPanel } from '../ui/ActionPanel'

/** Nombre de la función, con el lugar como respaldo. */
function nombre(fn: DireccionFunction): string {
  return fn.name ?? fn.venue
}

/**
 * Bloque 1 · La plata. Un solo número grande —lo vendido en la temporada— y en
 * qué tres estados está: entregado, cobrado sin rendir, y sin cobrar. Cada
 * pedazo accionable es un link a la vista que se ocupa de eso.
 */
function Plata({ money }: { money: Direccion['money'] }) {
  const total = Math.max(money.sold_cents, 1)
  const parte = (n: number) => `${(n / total) * 100}%`
  return (
    <div className="money">
      <p className="money__lbl">Vendido en la temporada</p>
      <p className="money__big">{formatMoney(money.sold_cents)}</p>
      <div className="money__stack" role="img" aria-label="Cómo se reparte lo vendido">
        <i className="is-ok" style={{ width: parte(money.in_hand_cents) }} />
        <i className="is-warn" style={{ width: parte(money.unsettled_cents) }} />
        <i className="is-line" style={{ width: parte(money.uncollected_cents) }} />
      </div>
      <div className="money__legend">
        <div className="money__lg">
          <span className="money__d">
            <i className="is-ok" />
            En tu poder
          </span>
          <b>{formatMoney(money.in_hand_cents)}</b>
        </div>
        <div className="money__lg">
          <span className="money__d">
            <i className="is-warn" />
            Sin rendir
          </span>
          <b>{formatMoney(money.unsettled_cents)}</b>
          {money.sellers_owing > 0 && (
            <Link to="/panel/rendiciones">
              {money.sellers_owing} {money.sellers_owing === 1 ? 'corista' : 'coristas'} ›
            </Link>
          )}
        </div>
        <div className="money__lg">
          <span className="money__d">
            <i className="is-line" />
            Sin cobrar
          </span>
          <b>{formatMoney(money.uncollected_cents)}</b>
          {money.sales_uncollected > 0 && (
            <Link to="/ventas?filtro=deben">
              {money.sales_uncollected} {money.sales_uncollected === 1 ? 'venta' : 'ventas'} ›
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

/** Bloque 2 · una conclusión con su cifra y su puerta. */
function Hallazgo({ find, onAsignar }: { find: DireccionFinding; onAsignar: () => void }) {
  const navigate = useNavigate()
  const ir = () => {
    if (find.kind === 'attendance') navigate('/panel/asistencia')
    else if (find.kind === 'unassigned') onAsignar()
    else navigate('/ventas?filtro=cortesias')
  }
  return (
    <div className="find">
      <p className={`find__n find__n--${find.tone}`}>
        {find.value}
        {find.suffix && <span>{find.suffix}</span>}
      </p>
      <p className="find__body">{find.body}</p>
      <button className="find__go" type="button" onClick={ir}>
        {find.link_label} ›
      </button>
    </div>
  )
}

/** Bloque 3a · el cupo de la función en venta, y quién lo tiene. */
function Asignaciones({ fn, onAbrir }: { fn: DireccionFunction; onAbrir: () => void }) {
  const board = useQuery({
    queryKey: ['function-allocations', fn.id],
    queryFn: () => api.functionAllocations(fn.id),
  })

  const filas = board.data?.allocations ?? []
  const conCupo = filas.filter((r) => r.assigned > 0 || r.sold > 0)
  const sinAsignar = Math.max(fn.capacity - fn.assigned, 0)
  const asignadasSinVender = Math.max(fn.assigned - fn.sold, 0)
  const parte = (n: number) => `${(n / Math.max(fn.capacity, 1)) * 100}%`

  return (
    <div className="acard">
      <div className="acard__h">
        <b>{nombre(fn)}</b>
        <span>
          {dayLabel(fn.starts_at)} · cupo {fn.capacity}
        </span>
      </div>
      <div className="acard__body">
        <div className="acard__headline">
          <p className="acard__n">
            {sinAsignar}
            <span> sin asignar</span>
          </p>
          <span className="acard__t">de {fn.capacity}</span>
        </div>
        <div className="money__stack acard__bar" role="img" aria-label="Reparto del cupo">
          <i className="is-indigo" style={{ width: parte(fn.sold) }} />
          <i className="is-indigo-soft" style={{ width: parte(asignadasSinVender) }} />
          <i className="is-line" style={{ width: parte(sinAsignar) }} />
        </div>
        <div className="acard__leg">
          <span className="acard__l">
            <i className="is-indigo" />
            Vendidas <b>{fn.sold}</b>
          </span>
          <span className="acard__l">
            <i className="is-indigo-soft" />
            Asignadas sin vender <b>{asignadasSinVender}</b>
          </span>
          <span className="acard__l">
            <i className="is-line" />
            Sin asignar <b>{sinAsignar}</b>
          </span>
        </div>

        {conCupo.length > 0 && (
          <div className="acard__who">
            {conCupo.map((row) => (
              <div key={row.user_id} className="wl">
                <span className="ini">{initials(row.seller_name)}</span>
                <span className="wl__nm">{row.seller_name}</span>
                <span className="wl__track">
                  <i
                    className={row.sold >= row.assigned ? 'is-ok' : 'is-indigo'}
                    style={{
                      width: `${Math.min((row.sold / Math.max(row.assigned, 1)) * 100, 100)}%`,
                    }}
                  />
                </span>
                <span
                  className={`wl__q${row.assigned > 0 && row.sold * 3 < row.assigned ? ' wl__q--low' : ''}`}
                >
                  {row.sold}/{row.assigned}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="acard__foot">
        <button className="button" type="button" onClick={onAbrir}>
          ＋ Asignar entradas
        </button>
      </div>
    </div>
  )
}

/** Bloque 3b · las funciones en cuatro columnas, con la puerta al detalle. */
function Funciones({
  data,
  seasonId,
  onComparar,
}: {
  data: Direccion
  seasonId: number
  onComparar: () => void
}) {
  const navigate = useNavigate()
  const ordenadas = [...data.functions].sort(
    (a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
  )
  return (
    <div className="mtbl">
      <div className="mtbl__h" aria-hidden>
        <span>Función</span>
        <span>Ocupación</span>
        <span>Asistencia</span>
        <span />
      </div>
      {ordenadas.map((fn) => (
        <button
          key={fn.id}
          className={`mtbl__r${fn.done ? '' : ' mtbl__r--live'}`}
          type="button"
          onClick={() => navigate(`/temporadas/${seasonId}?fn=${fn.id}`)}
        >
          <span className="mtbl__nm">
            <b>{nombre(fn)}</b>
            <span>
              {dayLabel(fn.starts_at)} · {fn.done ? formatMoney(fn.collected_cents) : 'en venta'}
            </span>
          </span>
          <span className={`mtbl__num${fn.done ? '' : ' is-i'}`}>{fn.occupancy_pct}%</span>
          {fn.attendance_pct < 0 ? (
            <span className="mtbl__none">—</span>
          ) : (
            <span className={`mtbl__num ${fn.attendance_pct < 60 ? 'is-b' : 'is-g'}`}>
              {fn.attendance_pct}%
            </span>
          )}
          <span className="mtbl__chev" aria-hidden>
            ›
          </span>
        </button>
      ))}
      <button className="mtbl__foot" type="button" onClick={onComparar}>
        Ver comparación completa ›
      </button>
    </div>
  )
}

/** El pop-up del pie: todo lo que no entra en la tabla de la pantalla. */
function Comparacion({ data, onClose }: { data: Direccion; onClose: () => void }) {
  const t = data.totals
  const peor = data.functions
    .filter((fn) => fn.attendance_pct >= 0)
    .sort((a, b) => a.attendance_pct - b.attendance_pct)[0]
  const masRecaudo = [...data.functions].sort((a, b) => b.collected_cents - a.collected_cents)[0]

  return (
    <ActionPanel label="Comparación entre funciones" size="wide" onClose={onClose}>
      <div className="cmp__h">
        <b>Comparación entre funciones</b>
        <span>Ordenado por fecha</span>
      </div>
      <div className="cmp">
        <div className="cmp__hr" aria-hidden>
          <span>Función</span>
          <span>Ocup.</span>
          <span>Recaudado</span>
          <span>Ticket prom.</span>
          <span>Cort.</span>
          <span>Asist.</span>
        </div>
        {data.functions.map((fn) => (
          <div key={fn.id} className="cmp__r">
            <span className="cmp__nm">
              <b>{nombre(fn)}</b>
              <span>
                {dayLabel(fn.starts_at)} · cupo {fn.capacity}
              </span>
            </span>
            <span className="cmp__num">{fn.occupancy_pct}%</span>
            <span className="cmp__num">{formatMoney(fn.collected_cents)}</span>
            <span className="cmp__num">{formatMoney(fn.ticket_avg_cents)}</span>
            <span className="cmp__num">{fn.comp_tickets}</span>
            {fn.attendance_pct < 0 ? (
              <span className="mtbl__none">—</span>
            ) : (
              <span className={`cmp__num ${fn.attendance_pct < 60 ? 'is-b' : 'is-g'}`}>
                {fn.attendance_pct}%
              </span>
            )}
          </div>
        ))}
        <div className="cmp__r cmp__r--tot">
          <span className="cmp__nm">
            <b>Total temporada</b>
          </span>
          <span className="cmp__num">{t.occupancy_pct}%</span>
          <span className="cmp__num">{formatMoney(t.collected_cents)}</span>
          <span className="cmp__num">{formatMoney(t.ticket_avg_cents)}</span>
          <span className="cmp__num">{t.comp_tickets}</span>
          <span className="cmp__num">{t.attendance_pct}%</span>
        </div>
      </div>
      {peor && masRecaudo && peor.attendance_pct < 60 && (
        <p className="cmp__foot">
          {masRecaudo.id === peor.id
            ? `${nombre(peor)} recaudó más que ninguna pero sólo entró el ${peor.attendance_pct}% de quienes compraron.`
            : `${nombre(peor)} fue la de peor asistencia: entró el ${peor.attendance_pct}% de quienes compraron.`}
        </p>
      )}
    </ActionPanel>
  )
}

/**
 * Dirección responde "¿cómo viene la temporada?". Tres bloques y nada más: la
 * plata, lo que hay que mirar, y las funciones. Todo dato que necesite
 * contexto para entenderse vive detrás de un click — acá van conclusiones.
 */
export function DireccionPage() {
  // La temporada la manda el selector global (C16): esta pantalla ya no
  // guarda su propia elección ni pide la lista por su cuenta.
  const { season } = useSeason()
  const seasonId = season?.id

  const [comparando, setComparando] = useState(false)
  const [asignando, setAsignando] = useState(false)

  const data = useQuery({
    queryKey: ['direccion', seasonId],
    queryFn: () => api.direccion(seasonId!),
    enabled: seasonId !== undefined,
  })

  if (!season) {
    return (
      <>
        <h1 className="page-title">Dirección</h1>
        <p className="muted">
          Todavía no hay temporadas. <Link to="/temporadas">Creá la primera</Link> para empezar.
        </p>
      </>
    )
  }
  if (data.isPending) return <p className="muted">Cargando…</p>
  if (!data.data) return <p className="alert">No se pudo cargar la temporada.</p>

  const d = data.data
  const hechas = d.functions.filter((fn) => fn.done).length
  const enVenta = d.functions.length - hechas

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Cómo viene la temporada</h1>
          <p className="page-head__sub">
            {season.name} · {hechas} {hechas === 1 ? 'función hecha' : 'funciones hechas'}
            {enVenta > 0 && `, ${enVenta} en venta`}
          </p>
        </div>
      </div>

      <Plata money={d.money} />

      {d.findings.length > 0 && (
        <>
          <hr className="divider" />
          <p className="sect">Lo que hay que mirar</p>
          <div className="finds">
            {d.findings.map((find) => (
              <Hallazgo key={find.kind} find={find} onAsignar={() => setAsignando(true)} />
            ))}
          </div>
        </>
      )}

      <hr className="divider" />
      <div className="cols2">
        {d.in_sale && (
          <div>
            <p className="sect">Asignaciones</p>
            <Asignaciones fn={d.in_sale} onAbrir={() => setAsignando(true)} />
          </div>
        )}
        <div>
          <p className="sect">Las funciones</p>
          <Funciones data={d} seasonId={season.id} onComparar={() => setComparando(true)} />
        </div>
      </div>

      {comparando && <Comparacion data={d} onClose={() => setComparando(false)} />}

      {asignando && d.in_sale && (
        <ActionPanel
          label={`Asignar entradas de ${nombre(d.in_sale)}`}
          size="form"
          onClose={() => setAsignando(false)}
        >
          <div className="cmp__h">
            <b>Asignar entradas</b>
            <span>
              {nombre(d.in_sale)} · {dayLabel(d.in_sale.starts_at)} · cupo {d.in_sale.capacity}
            </span>
          </div>
          <AllocationsEditor fn={{ id: d.in_sale.id, capacity: d.in_sale.capacity }} />
        </ActionPanel>
      )}
    </>
  )
}
