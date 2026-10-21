import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, roleLabel } from '../api/client'
import type {
  FormerMember,
  FunctionSummary,
  Role,
  Settlement,
  TeamMember,
  User,
  UserAccessResponse,
} from '../api/client'
import { RepartirModal } from '../components/RepartirModal'
import { useSession } from '../auth/session'
import { dayAndMonthShort, dayLabel, daysAgo, formatMoney } from '../lib/format'
import { useSeason } from '../season/SeasonProvider'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { DataList } from '../ui/DataList'
import { Figure, SubFigs } from '../ui/Figure'
import { Label } from '../ui/Label'
import { Modal } from '../ui/Modal'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'
import { BalanceStatus, Status } from '../ui/Status'
import { Tile } from '../ui/Tile'
import { NewUserSheet, UserSheet } from './UserForms'

// Equipo (C19 §5.4, design/acapelius-B-entidades.html §03). Una persona es
// una ENTIDAD: va en tarjeta, y el detalle se abre en el popup. Los
// formularios (sumar, editar) están en UserForms, también en popup.

const PAPEL_STAFF: Record<Exclude<Role, 'seller'>, string> = {
  admin: 'Dirección',
  door: 'Puerta',
}

/**
 * El acceso recién generado (alta, reenvío o reseteo). El email ya salió,
 * pero la contraseña provisoria queda a mano para pasarla por WhatsApp — y
 * es el plan B cuando el envío falla.
 */
function AccessCard({ access, onClose }: { access: UserAccessResponse; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const { user, temp_password: tempPassword, email_status: emailStatus } = access

  const message = [
    `¡Hola ${user.name}! Te creamos tu acceso a Acapelius:`,
    window.location.origin,
    `Email: ${user.email}`,
    `Contraseña: ${tempPassword ?? ''}`,
    'Al entrar te va a pedir elegir tu propia contraseña.',
  ].join('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Queda la seleccion manual del texto visible.
    }
  }

  return (
    <div style={{ marginBottom: 'var(--s4)' }} role="status">
      <Card
        title={
          emailStatus === 'sent'
            ? `Invitación enviada a ${user.email}`
            : emailStatus === 'preview'
              ? 'En la demo no se mandan mails'
              : 'No salió el email'
        }
        footer={
          <>
            <Button onClick={onClose}>Listo</Button>
            <Button go onClick={() => void copy()}>
              {copied ? 'Copiado' : 'Copiar mensaje'}
            </Button>
          </>
        }
      >
        <div style={{ padding: '0 var(--s3) var(--s3)' }}>
          <DataList rows={[['Contraseña provisoria', <span className="rn">{tempPassword}</span>]]} />
          <p className="rs" style={{ whiteSpace: 'normal', margin: 'var(--s1) 0 0' }}>
            {emailStatus === 'failed'
              ? 'Pasale estos datos por WhatsApp: el email no se pudo entregar.'
              : 'Cambia al primer ingreso.'}
          </p>
        </div>
      </Card>
    </div>
  )
}

// --- Las tarjetas -------------------------------------------------------------

/** El renglón bajo el nombre: el mail, salvo que haya algo más urgente. */
function subDe(m: TeamMember): string {
  if (m.left_at !== null) return `Dejó el coro ${daysAgo(m.left_at)}`
  if (m.last_login_at === null) return 'Nunca entró · invitación pendiente'
  return m.email
}

function CoristaTile({
  m,
  ultimaRendicion,
  onClick,
}: {
  m: TeamMember
  ultimaRendicion?: string
  onClick: () => void
}) {
  const salio = m.left_at !== null
  const sinCupo = m.assigned === 0
  const pct = sinCupo ? 0 : Math.round((m.tickets_sold / m.assigned) * 100)
  return (
    <Tile
      name={m.name}
      sub={subDe(m)}
      bar={{ value: m.tickets_sold, max: m.assigned, tone: m.balance_cents > 0 ? undefined : 'ok' }}
      quantity={
        sinCupo ? (
          <em>Sin cupo asignado</em>
        ) : (
          <>
            {m.tickets_sold} <em>de {m.assigned} vendidas</em>
          </>
        )
      }
      aside={<span className="rs">{sinCupo ? '—' : pct >= 100 ? 'completo' : `${pct}%`}</span>}
      footer={
        <>
          {sinCupo && m.tickets_sold === 0 ? (
            <Status tone="mute">Sin ventas</Status>
          ) : (
            <BalanceStatus balanceCents={m.balance_cents} />
          )}
          {ultimaRendicion && <span className="rs">rindió el {dayAndMonthShort(ultimaRendicion)}</span>}
        </>
      }
      flag={!salio && (m.balance_cents > 0 || sinCupo)}
      off={salio}
      onClick={onClick}
    />
  )
}

function StaffTile({ m, onClick }: { m: TeamMember; onClick: () => void }) {
  const papel = PAPEL_STAFF[m.role as Exclude<Role, 'seller'>]
  const dato =
    m.left_at !== null
      ? `Dejó el coro ${daysAgo(m.left_at)}`
      : m.last_login_at === null
        ? 'invitación pendiente'
        : m.role === 'door'
          ? `${m.checkins} ${m.checkins === 1 ? 'escaneo' : 'escaneos'}`
          : m.email
  return <Tile name={m.name} sub={`${papel} · ${dato}`} off={m.left_at !== null} onClick={onClick} />
}

// --- El popup de una persona --------------------------------------------------

/** Lo que va en el popup para cualquier rol: editar y sacar de la temporada. */
function Cuenta({
  m,
  esYo,
  onEditar,
  onSacar,
}: {
  m: TeamMember
  esYo: boolean
  onEditar: () => void
  onSacar: () => void
}) {
  const [confirmar, setConfirmar] = useState(false)
  return (
    <div>
      <Label>Cuenta</Label>
      <div className="mini" style={{ marginTop: 7 }}>
        <Row
          title="Datos y acceso"
          sub={m.last_login_at === null ? 'Nombre, rol, reenviar la invitación' : 'Nombre, rol, resetear la contraseña'}
          onClick={onEditar}
        />
        {!esYo && m.left_at === null && (
          <Row
            title={confirmar ? '¿Seguro? Tocá de nuevo para sacarla' : 'Sacar de la temporada'}
            sub="Sus ventas quedan; se puede reincorporar"
            onClick={() => (confirmar ? onSacar() : setConfirmar(true))}
          />
        )}
      </div>
    </div>
  )
}

/** Cupo función por función: sale del tablero de cada función, que ya existe. */
function CupoPorFuncion({ m, funciones }: { m: TeamMember; funciones: FunctionSummary[] }) {
  const tableros = useQueries({
    queries: funciones.map((fn) => ({
      queryKey: ['function-allocations', fn.id],
      queryFn: () => api.functionAllocations(fn.id),
    })),
  })
  if (funciones.length === 0) return null
  return (
    <div>
      <Label>Cupo por función</Label>
      <div className="mini" style={{ marginTop: 7 }}>
        {funciones.map((fn, i) => {
          const fila = tableros[i].data?.allocations.find((a) => a.user_id === m.id)
          const asignado = fila?.assigned ?? 0
          return (
            <Row
              key={fn.id}
              title={dayLabel(fn.starts_at)}
              sub={tableros[i].isPending ? 'Cargando…' : asignado > 0 ? `vendió ${fila?.sold ?? 0}` : 'sin asignar'}
              amount={asignado > 0 ? `${fila?.sold ?? 0} / ${asignado}` : '— / —'}
            />
          )
        })}
      </div>
    </div>
  )
}

function CoristaModal({
  m,
  seasonId,
  seasonName,
  funciones,
  esYo,
  onClose,
  onEditar,
  onSacar,
  onRepartir,
  onAviso,
}: {
  m: TeamMember
  seasonId: number
  seasonName: string
  funciones: FunctionSummary[]
  esYo: boolean
  onClose: () => void
  onEditar: () => void
  onSacar: () => void
  onRepartir: () => void
  onAviso: (texto: string) => void
}) {
  const navigate = useNavigate()
  const detalle = useQuery({
    queryKey: ['seller-detail', seasonId, m.id],
    queryFn: () => api.sellerDetail(m.id, seasonId),
  })
  const ventas = useQuery({
    queryKey: ['sales', 'comps', seasonId, m.id],
    queryFn: () => api.listSales({ seasonId, sellerId: m.id }),
  })
  const recordar = useMutation({
    mutationFn: () => api.remindSeller(m.id, seasonId),
    onSuccess: (r) =>
      onAviso(r.email_status === 'failed' ? 'No salió el recordatorio.' : `Le mandamos el recordatorio a ${m.name}.`),
    onError: (err) => onAviso(err instanceof ApiError ? err.message : 'No se pudo mandar el recordatorio.'),
  })

  const d = detalle.data
  const ultima = d?.timeline.filter((t) => t.kind === 'settlement').at(-1)
  const metodo = (x?: string) => (x === 'transfer' ? 'transferencia' : x === 'cash' ? 'efectivo' : x)

  return (
    <Modal
      open
      onClose={onClose}
      label={`Corista · ${seasonName}`}
      title={m.name}
      sub={`${m.email} · ${m.seasons === 1 ? 'primera temporada' : `${m.seasons}ª temporada`}`}
      footer={
        <>
          <Button onClick={onRepartir}>Cambiar cupo</Button>
          <Button disabled={recordar.isPending || m.balance_cents <= 0} onClick={() => recordar.mutate()}>
            Recordarle
          </Button>
          <Button go onClick={() => navigate(`/panel/rendiciones/${m.id}`)}>
            Registrar rendición
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 'var(--s6)', flexWrap: 'wrap' }}>
        <Figure label={m.balance_cents > 0 ? 'Debe' : 'Al día'} tone={m.balance_cents > 0 ? 'warn' : 'ok'}>
          {formatMoney(Math.max(m.balance_cents, 0))}
        </Figure>
        <Figure label="Vendió" unit={m.assigned > 0 ? `/ ${m.assigned}` : undefined}>
          {m.tickets_sold}
        </Figure>
      </div>

      <CupoPorFuncion m={m} funciones={funciones} />

      {d && (
        <DataList
          rows={[
            ['Cobró', formatMoney(d.collected_cents)],
            ['Ya rindió', formatMoney(d.settled_cents)],
            [
              'Última rendición',
              ultima ? `${dayAndMonthShort(ultima.at)} · ${metodo(ultima.method)}` : 'Todavía no rindió',
            ],
            ...(ventas.data
              ? ([['Cortesías usadas', String(ventas.data.summary.comp_tickets)]] as Array<[string, string]>)
              : []),
          ]}
        />
      )}

      <Cuenta m={m} esYo={esYo} onEditar={onEditar} onSacar={onSacar} />
    </Modal>
  )
}

function StaffModal({
  m,
  esYo,
  onClose,
  onEditar,
  onSacar,
}: {
  m: TeamMember
  esYo: boolean
  onClose: () => void
  onEditar: () => void
  onSacar: () => void
}) {
  return (
    <Modal open onClose={onClose} label={roleLabel(m.role)} title={m.name} sub={m.email}>
      <DataList
        rows={[
          ['Último ingreso', m.last_login_at === null ? 'Nunca entró' : daysAgo(m.last_login_at)],
          ...(m.role === 'door' ? ([['Escaneos', String(m.checkins)]] as Array<[string, string]>) : []),
          ['En el coro', m.seasons === 1 ? 'Primera temporada' : `${m.seasons} temporadas`],
        ]}
      />
      <Cuenta m={m} esYo={esYo} onEditar={onEditar} onSacar={onSacar} />
    </Modal>
  )
}

function AnteriorModal({
  m,
  seasonId,
  onClose,
  onCambio,
}: {
  m: FormerMember
  seasonId: number | undefined
  onClose: () => void
  onCambio: () => void
}) {
  const reincorporar = useMutation({
    mutationFn: () => api.addMember(seasonId!, m.id, m.last_role),
    onSuccess: () => {
      onCambio()
      onClose()
    },
  })
  return (
    <Modal
      open
      onClose={onClose}
      label="Temporadas anteriores"
      title={m.name}
      sub={m.email}
      footer={
        <Button go disabled={seasonId === undefined || reincorporar.isPending} onClick={() => reincorporar.mutate()}>
          Reincorporar como {roleLabel(m.last_role).toLowerCase()}
        </Button>
      }
    >
      <DataList
        rows={[
          ['Última temporada', m.last_season_name],
          ['Vendió', `${m.last_tickets_sold} entradas`],
          ['Último ingreso', m.last_login_at === null ? 'Nunca entró' : daysAgo(m.last_login_at)],
        ]}
      />
    </Modal>
  )
}

/** La fecha de la última rendición de cada corista, de un solo pedido. */
function ultimasRendiciones(settlements: Settlement[]): Map<number, string> {
  const out = new Map<number, string>()
  for (const s of settlements) {
    const prev = out.get(s.seller_id)
    if (prev === undefined || s.created_at > prev) out.set(s.seller_id, s.created_at)
  }
  return out
}

export function UsersPage() {
  const { user: me } = useSession()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editando, setEditando] = useState<User | null>(null)
  const [abierta, setAbierta] = useState<TeamMember | null>(null)
  const [anterior, setAnterior] = useState<FormerMember | null>(null)
  const [repartir, setRepartir] = useState(false)
  const [access, setAccess] = useState<UserAccessResponse | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // El aviso se va solo a los 5 segundos.
  useEffect(() => {
    if (aviso === null) return
    const t = setTimeout(() => setAviso(null), 5000)
    return () => clearTimeout(t)
  }, [aviso])

  // La temporada la manda el selector global (C16).
  const { season, current: enCurso } = useSeason()
  const mirando = season?.id
  const esLaEnCurso = mirando === enCurso?.id

  const { data, isPending } = useQuery({
    queryKey: ['team', mirando],
    queryFn: () => api.team(mirando),
  })
  const funcionesQ = useQuery({
    queryKey: ['functions-summary', mirando],
    queryFn: () => api.functionsSummary(mirando!),
    enabled: mirando !== undefined,
  })
  const rendicionesQ = useQuery({
    queryKey: ['settlements-history', mirando, 'all'],
    queryFn: () => api.listSettlements(mirando!),
    enabled: mirando !== undefined,
  })

  const members = data?.members ?? []
  const former = data?.former ?? []
  const resumen = data?.summary
  const funciones = funcionesQ.data?.functions ?? []
  const ultimas = ultimasRendiciones(rendicionesQ.data?.settlements ?? [])

  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: ['team'] })
    void queryClient.invalidateQueries({ queryKey: ['users'] })
    void queryClient.invalidateQueries({ queryKey: ['home'] })
  }

  const sacar = useMutation({
    mutationFn: (id: number) => api.removeMember(mirando!, id),
    onSuccess: () => {
      setAbierta(null)
      refrescar()
      setAviso('Listo: ya no participa de esta temporada.')
    },
    onError: (err) => setAviso(err instanceof ApiError ? err.message : 'No se pudo sacar.'),
  })

  // ?u=N llega de una alerta de Dirección: abre el detalle de esa persona.
  const [searchParams, setSearchParams] = useSearchParams()
  const focusId = Number(searchParams.get('u')) || undefined
  useEffect(() => {
    if (focusId === undefined) return
    const m = members.find((x) => x.id === focusId)
    if (m) {
      setAbierta(m)
      setSearchParams({}, { replace: true })
    }
  }, [focusId, members, setSearchParams])

  const coristas = members.filter((m) => m.role === 'seller')
  const staff = members.filter((m) => m.role !== 'seller')
  const capacidad = funciones.reduce((acc, fn) => acc + fn.capacity, 0)
  const repartidos = funciones.reduce((acc, fn) => acc + fn.assigned, 0)
  const sinAsignar = Math.max(capacidad - repartidos, 0)
  const cupoCoristas = coristas.reduce((acc, m) => acc + m.assigned, 0)
  const vendidasCoristas = coristas.reduce((acc, m) => acc + m.tickets_sold, 0)

  const editar = (m: TeamMember) => {
    setAbierta(null)
    setEditando(comoUser(m))
  }

  return (
    <>
      <PageHeader
        title="Equipo"
        label={
          season && resumen
            ? `${season.name} · ${resumen.total} ${resumen.total === 1 ? 'persona' : 'personas'}`
            : season?.name
        }
        actions={
          <>
            <Button onClick={() => setRepartir(true)}>Repartir cupos</Button>
            <Button go onClick={() => setCreating(true)}>
              Sumar persona
            </Button>
          </>
        }
      />

      {access && <AccessCard access={access} onClose={() => setAccess(null)} />}

      {!esLaEnCurso && (
        <div className="banner">
          <span>
            Estás mirando el equipo de otra temporada. La que usa el resto de la app es{' '}
            <b>{enCurso?.name}</b>.
          </span>
        </div>
      )}

      {resumen && (
        <div style={{ marginBottom: 'var(--s5)' }}>
          <SubFigs
            items={[
              ...(funcionesQ.data
                ? [
                    { label: 'Cupos repartidos', value: repartidos, unit: `/ ${capacidad}` },
                    { label: 'Sin asignar', value: sinAsignar, tone: sinAsignar > 0 ? ('warn' as const) : undefined },
                  ]
                : []),
              {
                label: 'Sin rendir',
                value: formatMoney(resumen.balance_cents),
                tone: resumen.balance_cents > 0 ? ('warn' as const) : undefined,
              },
            ]}
          />
        </div>
      )}

      {isPending ? (
        <p className="rs">Cargando…</p>
      ) : members.length === 0 ? (
        <Card title="Todavía no hay nadie más">
          <p className="rs" style={{ padding: '0 var(--s3) var(--s3)', whiteSpace: 'normal', margin: 0 }}>
            Sumá a las coristas: a cada una le llega su acceso por email.
          </p>
        </Card>
      ) : (
        <>
          {coristas.length > 0 && (
            <section className="grp">
              <div className="grp__h">
                <h2 className="lbl">Coristas</h2>
                <span className="grp__n">
                  {coristas.length} · {vendidasCoristas} de {cupoCoristas} cupos
                </span>
              </div>
              <div className="tiles tiles--3">
                {coristas.map((m) => (
                  <CoristaTile key={m.id} m={m} ultimaRendicion={ultimas.get(m.id)} onClick={() => setAbierta(m)} />
                ))}
              </div>
            </section>
          )}

          {staff.length > 0 && (
            <section className="grp">
              <div className="grp__h">
                <h2 className="lbl">Dirección y puerta</h2>
                <span className="grp__n">{staff.length}</span>
              </div>
              <div className="tiles tiles--3">
                {staff.map((m) => (
                  <StaffTile key={m.id} m={m} onClick={() => setAbierta(m)} />
                ))}
              </div>
            </section>
          )}

          {former.length > 0 && (
            <section className="grp">
              <div className="grp__h">
                <h2 className="lbl">Temporadas anteriores</h2>
                <span className="grp__n">{former.length}</span>
              </div>
              <div className="tiles tiles--3">
                {former.map((m) => (
                  <Tile
                    key={m.id}
                    name={m.name}
                    sub={`${m.last_season_name} · vendió ${m.last_tickets_sold}`}
                    off
                    onClick={() => setAnterior(m)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {aviso && (
        <p className="toast" role="status">
          {aviso}
        </p>
      )}

      {abierta && mirando !== undefined && abierta.role === 'seller' && (
        <CoristaModal
          m={abierta}
          seasonId={mirando}
          seasonName={season?.name ?? ''}
          funciones={funciones}
          esYo={abierta.id === me?.id}
          onClose={() => setAbierta(null)}
          onEditar={() => editar(abierta)}
          onSacar={() => sacar.mutate(abierta.id)}
          onRepartir={() => {
            setAbierta(null)
            setRepartir(true)
          }}
          onAviso={setAviso}
        />
      )}
      {abierta && abierta.role !== 'seller' && (
        <StaffModal
          m={abierta}
          esYo={abierta.id === me?.id}
          onClose={() => setAbierta(null)}
          onEditar={() => editar(abierta)}
          onSacar={() => sacar.mutate(abierta.id)}
        />
      )}
      {anterior && (
        <AnteriorModal m={anterior} seasonId={mirando} onClose={() => setAnterior(null)} onCambio={refrescar} />
      )}
      {repartir && (
        <RepartirModal
          funciones={funciones}
          onClose={() => {
            setRepartir(false)
            void queryClient.invalidateQueries({ queryKey: ['team'] })
          }}
        />
      )}

      {creating && (
        <NewUserSheet onClose={() => setCreating(false)} onCreated={(result) => setAccess(result)} />
      )}

      {editando && (
        <UserSheet
          user={editando}
          isSelf={editando.id === me?.id}
          onClose={() => setEditando(null)}
          onAccess={(result) => setAccess(result)}
        />
      )}
    </>
  )
}

/** El formulario sigue trabajando con `User`: la persona del equipo tiene todo
 *  lo que necesita, más los números de la temporada. */
function comoUser(m: TeamMember): User {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    must_change_password: false,
    is_active: m.left_at === null,
    created_at: m.joined_at,
    last_login_at: m.last_login_at,
  }
}
