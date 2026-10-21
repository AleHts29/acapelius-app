import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api, publicSaleURL } from '../api/client'
import type { Alert, Home, HomeFunction, HomeToDo, SettlementReportRow } from '../api/client'
import { useSession } from '../auth/session'
import { calendarDaysUntil, dayLabel, daysAgo, formatMoney, functionTime } from '../lib/format'
import { useIsDesktop } from '../lib/viewport'
import { useSeason } from '../season/SeasonProvider'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Figure, SubFigs } from '../ui/Figure'
import { Heel } from '../ui/Heel'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'
import { useNuevaVenta } from '../ui/useNuevaVenta'
import { RegisterSheet } from './SettlementsPage'

// Inicio (C19 §5.1 y §5.9, design/acapelius-B-referencia.html §01 y §06). Una
// cifra grande que contesta la pregunta de quien entra —"¿cuánto falta
// cobrar?" para dirección, "¿cuánto tengo que rendir?" para la corista— y a
// la derecha lo que está esperando una acción.

/** "Próxima función · en 5 días" / "· hoy" / "Última función". */
function cuando(startsAt: string): string {
  const dias = calendarDaysUntil(startsAt)
  if (dias < 0) return 'Última función'
  if (dias === 0) return 'Próxima función · hoy'
  if (dias === 1) return 'Próxima función · mañana'
  return `Próxima función · en ${dias} días`
}

const sinCentavos = (cents: number) => formatMoney(cents).replace('$', '').trim()

/**
 * El talón con la próxima función. Para dirección cuenta la venta de la
 * función; para la corista, su venta contra su cupo.
 */
function ProximaFuncion({ fn, esCorista }: { fn: HomeFunction; esCorista: boolean }) {
  const lugar = fn.name ? `${fn.name} · ${fn.venue}` : fn.venue
  const titulo = `${dayLabel(fn.starts_at)} · ${functionTime(fn.starts_at)}`
  if (esCorista && fn.no_allocation) {
    return <Heel label={cuando(fn.starts_at)} title={titulo} meta={`${lugar} · sin cupo asignado para vos`} />
  }
  const valor = esCorista ? fn.my_sold : fn.sold
  const total = esCorista ? fn.my_assigned : fn.capacity
  const pct = total > 0 ? Math.round((valor / total) * 100) : 0
  return (
    <Heel
      label={cuando(fn.starts_at)}
      title={titulo}
      meta={lugar}
      progress={{
        value: valor,
        max: total,
        left: esCorista ? `Vendiste ${valor} de tus ${total}` : `${valor} de ${total} vendidas`,
        right: `${pct}%`,
      }}
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

function CifraDireccion({ data, seasonId }: { data: Home; seasonId?: number }) {
  // La plata de la temporada sale del mismo reporte que Dirección.
  const direccion = useQuery({
    queryKey: ['direccion', seasonId],
    queryFn: () => api.direccion(seasonId!),
    enabled: seasonId !== undefined,
  })
  const vendidas = data.functions.reduce((acc, fn) => acc + fn.sold, 0)
  const capacidad = data.functions.reduce((acc, fn) => acc + fn.capacity, 0)
  const entraron = data.functions.reduce((acc, fn) => acc + fn.entered, 0)
  const m = direccion.data?.money
  return (
    <div>
      {m && (
        <Figure label="Falta cobrar" tone={m.uncollected_cents > 0 ? 'warn' : 'ok'}>
          {formatMoney(m.uncollected_cents)}
        </Figure>
      )}
      <div style={{ marginTop: 'var(--s4)' }}>
        <SubFigs
          items={[
            ...(m ? [{ label: 'Recaudado', value: formatMoney(m.sold_cents - m.uncollected_cents), tone: 'ok' as const }] : []),
            { label: 'Vendidas', value: vendidas, unit: `/ ${capacidad}` },
            { label: 'Ingresaron', value: entraron },
          ]}
        />
      </div>
    </div>
  )
}

function CifraCorista({ data }: { data: Home }) {
  const mio = data.my_settlement
  const fn = data.next_function
  const quedan = fn && !fn.no_allocation ? Math.max(fn.my_assigned - fn.my_sold, 0) : undefined
  if (!mio) return null
  return (
    <div>
      <Figure label={mio.balance_cents > 0 ? 'Tenés que rendir' : 'Estás al día'} tone={mio.balance_cents > 0 ? 'warn' : 'ok'}>
        {formatMoney(Math.max(mio.balance_cents, 0))}
      </Figure>
      <div style={{ marginTop: 'var(--s4)' }}>
        <SubFigs
          items={[
            { label: 'Cobraste', value: formatMoney(mio.collected_cents) },
            { label: 'Ya rendiste', value: formatMoney(mio.settled_cents), tone: 'ok' },
            ...(quedan !== undefined ? [{ label: 'Te quedan para vender', value: quedan }] : []),
          ]}
        />
      </div>
    </div>
  )
}

export function HomePage() {
  const { user } = useSession()
  const escritorio = useIsDesktop()
  const { seasonId } = useSeason()
  const home = useQuery({
    queryKey: ['home', seasonId],
    queryFn: () => api.home(seasonId),
  })
  const nuevaVenta = useNuevaVenta()
  // La rendición se resuelve acá mismo: al confirmar la alerta desaparece
  // sola, porque la mutación invalida ['home'].
  const [rindiendo, setRindiendo] = useState<SettlementReportRow | null>(null)

  if (!user) return null
  if (home.isPending) return <p className="rs">Cargando…</p>
  if (!home.data) return <p className="st st--bad">No se pudo cargar el inicio.</p>

  const data = home.data
  const esCorista = data.role === 'seller'
  const hechas = data.functions.filter((fn) => calendarDaysUntil(fn.starts_at) < 0).length
  const nuevaVentaBtn = (
    <Button go wide={!escritorio} onClick={nuevaVenta.abrir}>
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
        // Una sola acción primaria por pantalla: en escritorio en el
        // encabezado; en el celular, ancha, donde la alcanza el pulgar.
        actions={escritorio ? nuevaVentaBtn : undefined}
      />

      <div className="asym">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          {data.next_function ? (
            <ProximaFuncion fn={data.next_function} esCorista={esCorista} />
          ) : (
            <Card title="Todavía no hay funciones cargadas">
              {!esCorista && (
                <p className="rs" style={{ padding: '0 var(--s3) var(--s3)', margin: 0 }}>
                  <Link to="/temporadas">Creá la primera</Link> para empezar a vender.
                </p>
              )}
            </Card>
          )}
          {esCorista ? <CifraCorista data={data} /> : <CifraDireccion data={data} seasonId={data.season?.id} />}
          {!escritorio && nuevaVentaBtn}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
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
            <Card
              title="Te están esperando"
              action={data.alert_total > data.alerts.length ? { label: `Ver las ${data.alert_total}`, to: '/direccion' } : undefined}
            >
              {data.alerts.length === 0 ? (
                <Row title="Todo en orden" sub="Sin rendiciones pendientes ni tareas abiertas" />
              ) : (
                data.alerts.map((alert, i) => (
                  <AlertaRow
                    key={`${alert.kind}-${alert.seller_id ?? alert.function_id ?? alert.user_id ?? i}`}
                    alert={alert}
                    seasonId={data.season?.id}
                    onRendir={() => setRindiendo(filaDeAlerta(alert))}
                  />
                ))
              )}
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
                  sub={`${esCorista ? s.function_name : s.seller_name.split(' ')[0]} · ${daysAgo(s.created_at)}`}
                  amount={s.is_comp ? 'cortesía' : sinCentavos(s.amount_cents)}
                  to="/ventas"
                />
              ))
            )}
          </Card>
        </div>
      </div>

      {nuevaVenta.panel}

      {rindiendo && data.season && (
        <RegisterSheet row={rindiendo} seasonId={data.season.id} onClose={() => setRindiendo(null)} />
      )}
    </>
  )
}
