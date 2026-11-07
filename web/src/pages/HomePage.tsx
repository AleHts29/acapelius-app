import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api, publicSaleURL } from '../api/client'
import type { Alert, Direccion, Home, HomeFunction, HomeToDo, SettlementReportRow } from '../api/client'
import { useSession } from '../auth/session'
import { calendarDaysUntil, dayLabel, daysAgo, formatMoney, functionTime } from '../lib/format'
import { useIsDesktop } from '../lib/viewport'
import { useSeason } from '../season/SeasonProvider'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Entrada, TalonCifra, TiraEntradas } from '../ui/Entrada'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'
import { Rule, RuleCell } from '../ui/Rule'
import { Sala } from '../ui/Sala'
import { Status } from '../ui/Status'
import { Tile } from '../ui/Tile'
import { useNuevaVenta } from '../ui/useNuevaVenta'
import { RegisterSheet } from './SettlementsPage'

// Inicio (C21). Arriba, las funciones como entradas, paradas en la próxima, y
// debajo las cifras que contestan la pregunta de quien entra —"¿cuánto falta
// cobrar?" para dirección, "¿cuánto tengo que rendir?" para la corista—.
// Debajo, en columnas, lo que está esperando una acción.

/** "en 5 días" / "hoy" / "mañana". */
function falta(dias: number): string {
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'mañana'
  return `en ${dias} días`
}

const sinCentavos = (cents: number) => formatMoney(cents).replace('$', '').trim()

/**
 * Lo que viene primero, de la más cercana a la más lejana, y después lo que ya
 * pasó, de la última para atrás: así la próxima es siempre la primera que se ve,
 * sin que la pantalla abra corrida.
 */
function ordenParaInicio(funciones: HomeFunction[]): HomeFunction[] {
  const cuando = (fn: HomeFunction) => new Date(fn.starts_at).getTime()
  const vienen = funciones.filter((fn) => calendarDaysUntil(fn.starts_at) >= 0).sort((a, b) => cuando(a) - cuando(b))
  const pasaron = funciones.filter((fn) => calendarDaysUntil(fn.starts_at) < 0).sort((a, b) => cuando(b) - cuando(a))
  return [...vienen, ...pasaron]
}

/** Una función de la temporada, como entrada. La próxima es la naranja. */
function EntradaFuncion({
  fn,
  proxima,
  esCorista,
  seasonId,
}: {
  fn: HomeFunction
  proxima: boolean
  esCorista: boolean
  seasonId?: number
}) {
  const dias = calendarDaysUntil(fn.starts_at)
  const pasada = dias < 0
  const label = proxima ? `Próxima · ${falta(dias)}` : pasada ? 'Ya pasó' : falta(dias)
  const valor = esCorista ? fn.my_sold : fn.sold
  const total = esCorista ? fn.my_assigned : fn.capacity
  const libres = Math.max(fn.capacity - fn.assigned, 0)
  let talon
  if (esCorista && fn.no_allocation) {
    talon = <TalonCifra label="Tu cupo" valor="—">Sin cupo asignado para vos</TalonCifra>
  } else if (pasada && !esCorista) {
    talon = <TalonCifra label="Entraron" valor={`${fn.entered} de ${fn.sold}`} barra={{ value: fn.entered, max: fn.sold }} />
  } else {
    talon = (
      <TalonCifra
        label={esCorista ? 'Vendiste' : 'Vendidas'}
        valor={total > 0 && valor >= total ? 'AGOTADA' : `${valor} de ${total}`}
        barra={{ value: valor, max: total }}
      >
        {!esCorista && !pasada && libres > 0 ? `${libres} sin repartir` : undefined}
      </TalonCifra>
    )
  }
  return (
    <Entrada
      tono={proxima ? 'ticket' : 'papel'}
      apagada={pasada}
      label={label}
      nombre={fn.name ?? fn.venue}
      datos={
        <>
          {dayLabel(fn.starts_at)} · {functionTime(fn.starts_at)}
          {fn.name && (
            <>
              <br />
              {fn.venue}
            </>
          )}
        </>
      }
      talon={talon}
      to={esCorista || !seasonId ? `/ventas?fn=${fn.id}` : `/temporadas/${seasonId}?fn=${fn.id}`}
    />
  )
}

/** La alerta de dirección como fila: qué pasa, y adónde se resuelve. */
function AlertaRow({ alert, seasonId, onRendir }: { alert: Alert; seasonId?: number; onRendir: () => void }) {
  const navigate = useNavigate()
  if (alert.kind === 'settlement') {
    return (
      <Row
        title={`${alert.name} debe rendir ${formatMoney(alert.amount_cents ?? 0)}`}
        sub={alert.since ? `cobró ${daysAgo(alert.since)}` : undefined}
        onClick={onRendir}
      />
    )
  }
  if (alert.kind === 'allocation') {
    return (
      <Row
        title={`${alert.missing} ${alert.missing === 1 ? 'entrada' : 'entradas'} sin corista`}
        sub={alert.starts_at ? `${dayLabel(alert.starts_at)} · ${alert.name}` : alert.name}
        onClick={() => navigate(`/temporadas/${seasonId}?fn=${alert.function_id}`)}
      />
    )
  }
  return (
    <Row
      title={`${alert.name} nunca entró a la app`}
      sub={alert.since ? `invitada ${daysAgo(alert.since)}` : undefined}
      onClick={() => navigate(`/usuarios?u=${alert.user_id}`)}
    />
  )
}

/** Lo que la corista tiene pendiente: cobrar, o compartir el link si no hay email. */
function PendienteRow({ item }: { item: HomeToDo }) {
  const navigate = useNavigate()
  const [copiado, setCopiado] = useState(false)
  const sinEmail = !item.has_email && item.balance_cents === 0
  const cuantas = `${item.quantity} ${item.quantity === 1 ? 'entrada' : 'entradas'}`
  if (sinEmail) {
    return (
      <Row
        title={`${item.buyer_name} no tiene email`}
        sub={copiado ? 'Link copiado: mandáselo por WhatsApp' : `${cuantas} · tocá para copiar el link`}
        onClick={() => {
          navigator.clipboard
            .writeText(publicSaleURL(item.code))
            .then(() => setCopiado(true))
            .catch(() => navigate('/ventas'))
        }}
      />
    )
  }
  return (
    <Row
      title={`${item.buyer_name} te debe ${formatMoney(item.balance_cents)}`}
      sub={`${cuantas} · vendida ${daysAgo(item.created_at)}`}
      onClick={() => navigate('/ventas?filtro=deben')}
    />
  )
}

/** La alerta trae lo justo para la fila que espera el registro de rendición. */
function filaDeAlerta(alert: Alert): SettlementReportRow {
  return {
    seller_id: alert.seller_id ?? 0,
    seller_name: alert.name,
    collected_cents: alert.collected_cents ?? 0,
    pending_cents: 0,
    settled_cents: alert.settled_cents ?? 0,
    balance_cents: alert.amount_cents ?? 0,
  }
}

function CifrasDireccion({ money }: { money?: Direccion['money'] }) {
  if (!money) return null
  return (
    <>
      <RuleCell
        ojo
        label="Falta cobrar"
        value={formatMoney(money.uncollected_cents)}
        tone={money.uncollected_cents > 0 ? 'warn' : 'ok'}
        sub={`${money.sales_uncollected} ${money.sales_uncollected === 1 ? 'venta' : 'ventas'}`}
      />
      <RuleCell
        label="Recaudado"
        value={formatMoney(money.sold_cents - money.uncollected_cents)}
        tone="ok"
        sub={money.unsettled_cents > 0 ? `${formatMoney(money.unsettled_cents)} sin rendir` : 'todo rendido'}
      />
    </>
  )
}

function CifrasCorista({ data }: { data: Home }) {
  const mio = data.my_settlement
  const fn = data.next_function
  const quedan = fn && !fn.no_allocation ? Math.max(fn.my_assigned - fn.my_sold, 0) : undefined
  if (!mio) return null
  return (
    <>
      <RuleCell
        ojo
        label={mio.balance_cents > 0 ? 'Tenés que rendir' : 'Estás al día'}
        value={formatMoney(Math.max(mio.balance_cents, 0))}
        tone={mio.balance_cents > 0 ? 'warn' : 'ok'}
        sub={`cobraste ${formatMoney(mio.collected_cents)}`}
      />
      <RuleCell label="Ya rendiste" value={formatMoney(mio.settled_cents)} tone="ok" />
      {quedan !== undefined && <RuleCell label="Te quedan para vender" value={quedan} />}
    </>
  )
}

export function HomePage() {
  const navigate = useNavigate()
  const { user } = useSession()
  const escritorio = useIsDesktop()
  const { seasonId, season, current } = useSeason()
  const home = useQuery({
    queryKey: ['home', seasonId],
    queryFn: () => api.home(seasonId),
  })
  const nuevaVenta = useNuevaVenta()
  // La rendición se resuelve acá mismo: al confirmar la alerta desaparece
  // sola, porque la mutación invalida ['home'].
  const [rindiendo, setRindiendo] = useState<SettlementReportRow | null>(null)
  // La plata de la temporada sale del mismo reporte que Dirección.
  const temporadaId = home.data?.season?.id
  const direccion = useQuery({
    queryKey: ['direccion', temporadaId],
    queryFn: () => api.direccion(temporadaId!),
    enabled: user?.role === 'admin' && temporadaId !== undefined,
  })

  if (!user) return null
  if (home.isPending) return <p className="rs">Cargando…</p>
  if (!home.data) return <p className="st st--bad">No se pudo cargar el inicio.</p>

  const data = home.data
  const esCorista = data.role === 'seller'
  const deudas = data.alerts.filter((a) => a.kind === 'settlement')
  const otras = data.alerts.filter((a) => a.kind !== 'settlement')
  const hechas = data.functions.filter((fn) => calendarDaysUntil(fn.starts_at) < 0).length
  // La temporada activa ya terminó (todas sus funciones pasaron): la app no la
  // cambia sola, pero dirección tiene que enterarse para cargar la próxima.
  const terminoLaActiva =
    !esCorista &&
    season !== undefined &&
    season.id === current?.id &&
    data.functions.length > 0 &&
    hechas === data.functions.length
  const nuevaVentaBtn = (
    <Button go onClick={nuevaVenta.abrir}>
      Nueva venta
    </Button>
  )

  return (
    <>
      <PageHeader
        title={`Hola, ${data.name.split(' ')[0]}`}
        label={
          data.season
            ? `${data.season.name} · ${hechas} de ${data.functions.length} ${data.functions.length === 1 ? 'función hecha' : 'funciones hechas'}`
            : undefined
        }
        // En el celular se vende desde Ventas.
        actions={escritorio ? nuevaVentaBtn : undefined}
      />

      {terminoLaActiva && (
        <div className="banner" role="status">
          <span>{season.name} terminó: ya pasaron todas sus funciones.</span>
          <span style={{ display: 'flex', gap: 'var(--s3)' }}>
            <Link to="/temporadas?nueva=1">Crear la próxima</Link>
            <Link to="/temporadas">Usar otra</Link>
          </span>
        </div>
      )}

      {data.functions.length > 0 ? (
        <TiraEntradas label="Las funciones de la temporada">
          {ordenParaInicio(data.functions).map((fn) => (
            <EntradaFuncion
              key={fn.id}
              fn={fn}
              proxima={fn.id === data.next_function?.id && calendarDaysUntil(fn.starts_at) >= 0}
              esCorista={esCorista}
              seasonId={data.season?.id}
            />
          ))}
        </TiraEntradas>
      ) : (
        <Entrada
          tono="vacia"
          className="tira-e"
          label="Sin funciones"
          nombre="Todavía no hay funciones"
          datos={esCorista ? 'Dirección las carga en la temporada' : <Link to="/temporadas">Creá la primera</Link>}
        />
      )}
      <Rule kpis>
        {esCorista ? <CifrasCorista data={data} /> : <CifrasDireccion money={direccion.data?.money} />}
      </Rule>

      {!esCorista && (
        <Sala funciones={data.functions.map((fn) => ({ ...fn, label: dayLabel(fn.starts_at) }))} />
      )}

      <div className="cols cols--2">
        {esCorista ? (
          <Card
            title="Te falta cobrar"
            action={data.todo_total > data.todo.length ? { label: `Ver las ${data.todo_total}`, to: '/ventas?filtro=deben' } : undefined}
          >
            {data.todo.length === 0 ? (
              <Row title="Nada pendiente" sub="Todo cobrado y compartido" />
            ) : (
              data.todo.map((item) => <PendienteRow key={item.sale_id} item={item} />)
            )}
          </Card>
        ) : (
          // Opción D (C20): la corista que debe es una ENTIDAD, va en tarjeta
          // con su cuadrado de iniciales, como en Equipo; el resto de las
          // alertas (cupo sin repartir, gente que nunca entró) son filas.
          <Card
            title="Te deben rendir"
            action={
              data.badges.settlements_pending > deudas.length
                ? { label: `Ver las ${data.badges.settlements_pending}`, to: '/panel/rendiciones' }
                : undefined
            }
          >
            {deudas.length === 0 && otras.length === 0 && (
              <Row title="Todo en orden" sub="Sin rendiciones pendientes ni tareas abiertas" />
            )}
            {deudas.length > 0 && (
              <div className="tiles tiles--2">
                {deudas.map((alert) => (
                  <Tile
                    key={`settlement-${alert.seller_id}`}
                    name={alert.name}
                    sub={alert.since ? `cobró ${daysAgo(alert.since)}` : undefined}
                    receipt={{
                      lines: [
                        ['Cobró', formatMoney(alert.collected_cents ?? 0)],
                        ['Rindió', `− ${formatMoney(alert.settled_cents ?? 0)}`],
                      ],
                      total: ['Debe', formatMoney(alert.amount_cents ?? 0)],
                    }}
                    footer={<Button onClick={() => setRindiendo(filaDeAlerta(alert))}>Registrar</Button>}
                  />
                ))}
              </div>
            )}
            {otras.map((alert, i) => (
              <AlertaRow
                key={`${alert.kind}-${alert.function_id ?? alert.user_id ?? i}`}
                alert={alert}
                seasonId={data.season?.id}
                onRendir={() => setRindiendo(filaDeAlerta(alert))}
              />
            ))}
          </Card>
        )}

        <Card title={esCorista ? 'Tus últimas ventas' : 'Últimas ventas'} action={{ label: 'Ver todas', to: '/ventas' }}>
          {data.last_sales.length === 0 ? (
            <Row title="Todavía no hay ventas" />
          ) : (
            data.last_sales.map((s) => (
              <Row
                key={s.id}
                title={s.buyer_name}
                sub={`${esCorista ? s.function_name : s.seller_name.split(' ')[0]} · ${s.quantity} ${s.quantity === 1 ? 'entrada' : 'entradas'} · ${daysAgo(s.created_at)}`}
                amount={s.is_comp ? '—' : sinCentavos(s.amount_cents)}
                status={
                  s.is_comp ? (
                    <Status tone="cor">Cortesía</Status>
                  ) : s.paid_cents >= s.amount_cents ? (
                    <Status tone="ok">Pagó</Status>
                  ) : (
                    <Status tone="warn">Debe {formatMoney(s.amount_cents - s.paid_cents)}</Status>
                  )
                }
                // Ventas abre el popup de esta venta. Va por el estado de la
                // navegación: el nombre del comprador no tiene que quedar en la URL.
                onClick={() => navigate('/ventas', { state: { venta: { id: s.id, comprador: s.buyer_name } } })}
              />
            ))
          )}
        </Card>
      </div>

      {nuevaVenta.panel}

      {rindiendo && data.season && (
        <RegisterSheet row={rindiendo} seasonId={data.season.id} onClose={() => setRindiendo(null)} />
      )}
    </>
  )
}
