import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, avatarURL, roleLabel } from '../api/client'
import type {
  FormerMember,
  FunctionSummary,
  Role,
  TeamMember,
  User,
  UserAccessResponse,
} from '../api/client'
import { RepartirModal } from '../components/RepartirModal'
import { useSession } from '../auth/session'
import { dayLabel, daysAgo, formatMoney } from '../lib/format'
import { useSeason } from '../season/SeasonProvider'
import { Button, Seg } from '../ui/Button'
import { Card } from '../ui/Card'
import { DataList } from '../ui/DataList'
import { Figure, SubFigs } from '../ui/Figure'
import { Label } from '../ui/Label'
import { Modal } from '../ui/Modal'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'
import { useIsDesktop } from '../lib/viewport'
import { normalizeText } from '../lib/search'
import { Status } from '../ui/Status'
import { Tile } from '../ui/Tile'
import { CaraPersona } from '../ui/CaraPersona'
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
        <div style={{ padding: '0 0 var(--s3)' }}>
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

function cuantasTemporadas(m: TeamMember): string {
  return m.seasons === 1 ? 'Primera temporada' : `${m.seasons}ª temporada`
}

/** Si entró a la app: es lo que dice si la invitación le llegó. */
function EstadoAcceso({ m }: { m: TeamMember }) {
  if (m.left_at !== null) return <Status tone="mute">Dejó el coro {daysAgo(m.left_at)}</Status>
  if (m.last_login_at === null) return <Status tone="warn">Nunca entró</Status>
  return <Status tone="ok">Entró {daysAgo(m.last_login_at)}</Status>
}

/** La ficha de una persona: quién es y qué hace en esta temporada. La plata está en Rendiciones. */
function Ficha({ m, onClick, lista }: { m: TeamMember; onClick: () => void; lista?: boolean }) {
  const corista = m.role === 'seller'
  const escritorio = useIsDesktop()
  // En el celular una ficha por pantalla no deja ver al equipo: va en fila.
  // En escritorio, la vista de lista también.
  if (!escritorio || lista) {
    return (
      <Row
        title={m.name}
        sub={
          corista
            ? `${m.role_name ? `${m.role_name} · ` : ''}${m.assigned > 0 ? `${m.tickets_sold} de ${m.assigned} vendidas` : 'Sin cupo'}${m.last_login_at ? '' : ' · nunca entró'}`
            : m.role === 'door'
              ? `${m.checkins} ${m.checkins === 1 ? 'escaneo' : 'escaneos'} · ${m.role_name ?? 'Puerta'}`
              : (m.role_name ?? PAPEL_STAFF.admin)
        }
        onClick={onClick}
      />
    )
  }
  return (
    <Tile
      name={m.name}
      foto={m.avatar_at ? avatarURL(m.id, m.avatar_at) : undefined}
      sub={m.role_name && corista ? `${m.role_name} · ${m.email}` : m.email}
      bar={corista && m.assigned > 0 ? { value: m.tickets_sold, max: m.assigned } : undefined}
      quantity={
        corista ? (
          m.assigned > 0 ? (
            <>
              {m.tickets_sold} <em>de {m.assigned} vendidas</em>
            </>
          ) : (
            <em>Sin cupo</em>
          )
        ) : m.role === 'door' ? (
          <>
            {m.checkins} <em>{m.checkins === 1 ? 'escaneo' : 'escaneos'} · {m.role_name ?? 'Puerta'}</em>
          </>
        ) : (
          <em>{m.role_name ?? PAPEL_STAFF.admin}</em>
        )
      }
      footer={
        <>
          <EstadoAcceso m={m} />
          <span className="rs">{cuantasTemporadas(m)}</span>
        </>
      }
      off={m.left_at !== null}
      onClick={onClick}
    />
  )
}

// --- El popup de una persona --------------------------------------------------

/** Lo que va en el popup para cualquier rol: editar y sacar de la temporada. */
function Cuenta({
  m,
  esYo,
  onEditar,
  onSacar,
  onEliminar,
}: {
  m: TeamMember
  esYo: boolean
  onEditar: () => void
  onSacar: () => void
  onEliminar: () => void
}) {
  const [confirmar, setConfirmar] = useState(false)
  const [confirmarBorrar, setConfirmarBorrar] = useState(false)
  // Sólo quien nunca vendió, cobró ni registró ingresos se puede borrar: lo
  // confirma el server. Con historial, se saca de la temporada.
  const sinHistorial = m.tickets_sold === 0 && m.checkins === 0 && m.balance_cents === 0
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
        {!esYo && (
          <Row
            title={confirmarBorrar ? '¿Seguro? Tocá de nuevo para eliminarla' : 'Eliminar perfil'}
            sub={
              sinHistorial
                ? 'Se borra para siempre. No se puede deshacer'
                : 'Tiene ventas o cobros: sacala de la temporada en vez de eliminarla'
            }
            dim={!sinHistorial}
            onClick={sinHistorial ? () => (confirmarBorrar ? onEliminar() : setConfirmarBorrar(true)) : undefined}
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
  onEliminar,
  onRepartir,
}: {
  m: TeamMember
  seasonId: number
  seasonName: string
  funciones: FunctionSummary[]
  esYo: boolean
  onClose: () => void
  onEditar: () => void
  onSacar: () => void
  onEliminar: () => void
  onRepartir: () => void
}) {
  const navigate = useNavigate()
  const ventas = useQuery({
    queryKey: ['sales', 'comps', seasonId, m.id],
    queryFn: () => api.listSales({ seasonId, sellerId: m.id }),
  })
  return (
    <Modal
      open
      onClose={onClose}
      label={`Corista · ${seasonName}`}
      title={m.name}
      sub={m.email}
      footer={
        <>
          <Button go onClick={onRepartir}>
            Cambiar cupo
          </Button>
        </>
      }
    >
      <CaraPersona userId={m.id} name={m.name} avatarAt={m.avatar_at} />
      <div style={{ display: 'flex', gap: 'var(--s6)', flexWrap: 'wrap' }}>
        <Figure label="Vendió" unit={m.assigned > 0 ? `/ ${m.assigned}` : undefined}>
          {m.tickets_sold}
        </Figure>
      </div>

      <DataList
        rows={[
          ['Mail', m.email],
          ['Rol', m.role_name ?? roleLabel(m.role)],
          ['Último ingreso', m.last_login_at === null ? 'Nunca entró' : daysAgo(m.last_login_at)],
          ['En el coro', m.seasons === 1 ? 'Primera temporada' : `${m.seasons} temporadas`],
          ...(ventas.data
            ? ([['Cortesías usadas', String(ventas.data.summary.comp_tickets)]] as Array<[string, string]>)
            : []),
        ]}
      />

      <CupoPorFuncion m={m} funciones={funciones} />

      <div>
        <Label>Rendiciones</Label>
        <div className="mini" style={{ marginTop: 7 }}>
          <Row
            title={m.balance_cents > 0 ? `Debe ${formatMoney(m.balance_cents)}` : 'Al día'}
            sub="Ver sus cuentas y registrar una rendición"
            onClick={() => navigate(`/panel/rendiciones/${m.id}`)}
          />
        </div>
      </div>

      <Cuenta m={m} esYo={esYo} onEditar={onEditar} onSacar={onSacar} onEliminar={onEliminar} />
    </Modal>
  )
}

function StaffModal({
  m,
  esYo,
  onClose,
  onEditar,
  onSacar,
  onEliminar,
}: {
  m: TeamMember
  esYo: boolean
  onClose: () => void
  onEditar: () => void
  onSacar: () => void
  onEliminar: () => void
}) {
  return (
    <Modal open onClose={onClose} label={m.role_name ?? roleLabel(m.role)} title={m.name} sub={m.email}>
      <CaraPersona userId={m.id} name={m.name} avatarAt={m.avatar_at} />
      <DataList
        rows={[
          ['Mail', m.email],
          ['Rol', m.role_name ?? roleLabel(m.role)],
          ['Último ingreso', m.last_login_at === null ? 'Nunca entró' : daysAgo(m.last_login_at)],
          ...(m.role === 'door' ? ([['Escaneos', String(m.checkins)]] as Array<[string, string]>) : []),
          ['En el coro', m.seasons === 1 ? 'Primera temporada' : `${m.seasons} temporadas`],
        ]}
      />
      <Cuenta m={m} esYo={esYo} onEditar={onEditar} onSacar={onSacar} onEliminar={onEliminar} />
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
    meta: { exito: 'Sumada a la temporada' },
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
  const [busqueda, setBusqueda] = useState('')
  // Fichas o lista: se recuerda en este dispositivo.
  const [vista, setVista] = useState<'fichas' | 'lista'>(() => {
    try {
      return localStorage.getItem('acapelius.equipo-vista') === 'lista' ? 'lista' : 'fichas'
    } catch {
      return 'fichas'
    }
  })
  const cambiarVista = (v: 'fichas' | 'lista') => {
    setVista(v)
    try {
      localStorage.setItem('acapelius.equipo-vista', v)
    } catch {
      // sin storage: vale hasta recargar
    }
  }
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
  const members = data?.members ?? []
  const former = data?.former ?? []
  const resumen = data?.summary
  const funciones = funcionesQ.data?.functions ?? []

  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: ['team'] })
    void queryClient.invalidateQueries({ queryKey: ['users'] })
    void queryClient.invalidateQueries({ queryKey: ['home'] })
  }

  const sacar = useMutation({
    meta: { exito: 'Quitada de la temporada' },
    mutationFn: (id: number) => api.removeMember(mirando!, id),
    onSuccess: () => {
      setAbierta(null)
      refrescar()
      setAviso('Listo: ya no participa de esta temporada.')
    },
    onError: (err) => setAviso(err instanceof ApiError ? err.message : 'No se pudo sacar.'),
  })

  const eliminar = useMutation({
    meta: { exito: 'Perfil eliminado' },
    mutationFn: (id: number) => api.deleteUser(id),
    onSuccess: () => {
      setAbierta(null)
      refrescar()
    },
    onError: (err) => {
      setAbierta(null)
      setAviso(err instanceof ApiError ? err.message : 'No se pudo eliminar.')
    },
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

  const porNombre = (a: TeamMember, b: TeamMember) => a.name.localeCompare(b.name, 'es')
  const siguenTodos = members.filter((m) => m.left_at === null)
  const nuncaEntraron = siguenTodos.filter((m) => m.last_login_at === null).length
  // El buscador filtra por nombre, mail o rol, sin importar tildes ni mayúsculas.
  const q = normalizeText(busqueda.trim())
  const coincide = (texto: string) => q === '' || normalizeText(texto).includes(q)
  const encontrada = (m: TeamMember) =>
    coincide(`${m.name} ${m.email} ${m.role_name ?? ''} ${roleLabel(m.role)}`)
  const siguen = siguenTodos.filter(encontrada).sort(porNombre)
  // Los roles propios (C21) tienen su propia sección: "Banda", "Acomodadores"…
  const coristas = siguen.filter((m) => m.role === 'seller' && !m.role_name)
  const staff = siguen.filter((m) => m.role !== 'seller' && !m.role_name)
  const propios = [...new Set(siguen.map((m) => m.role_name).filter((n): n is string => !!n))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  )
  const dejaron = members.filter((m) => m.left_at !== null).filter(encontrada).sort(porNombre)
  const anteriores = former.filter((m) => coincide(`${m.name} ${m.email}`))

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
              { label: 'Coristas', value: siguenTodos.filter((m) => m.role === 'seller' && !m.role_name).length },
              ...[...new Set(siguenTodos.map((m) => m.role_name).filter((n): n is string => !!n))].map((n) => ({
                label: n,
                value: siguenTodos.filter((m) => m.role_name === n).length,
              })),
              { label: 'Dirección y puerta', value: siguenTodos.filter((m) => m.role !== 'seller' && !m.role_name).length },
              { label: 'Nunca entraron', value: nuncaEntraron, tone: nuncaEntraron > 0 ? ('warn' as const) : undefined },
              ...(dejaron.length > 0 ? [{ label: 'Dejaron el coro', value: dejaron.length }] : []),
            ]}
          />
        </div>
      )}

      {isPending ? (
        <p className="rs">Cargando…</p>
      ) : members.length === 0 ? (
        <Card title="Todavía no hay nadie más">
          <p className="rs" style={{ padding: '0 0 var(--s3)', whiteSpace: 'normal', margin: 0 }}>
            Sumá a las coristas: a cada una le llega su acceso por email.
          </p>
        </Card>
      ) : (
        <>
          <div className="equipo__barra">
            <input
              className="search"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, mail o rol"
              aria-label="Buscar personas"
            />
            <Seg<'fichas' | 'lista'>
              label="Vista"
              value={vista}
              onChange={cambiarVista}
              options={[
                { value: 'fichas', label: 'Fichas' },
                { value: 'lista', label: 'Lista' },
              ]}
            />
          </div>

          {q !== '' && siguen.length + dejaron.length + anteriores.length === 0 && (
            <p className="rs">Nadie coincide con “{busqueda.trim()}”.</p>
          )}

          {[
            { label: 'Coristas', gente: coristas },
            ...propios.map((n) => ({ label: n, gente: siguen.filter((m) => m.role_name === n) })),
            { label: 'Dirección y puerta', gente: staff },
            { label: 'Dejaron el coro', gente: dejaron },
          ].map(
            ({ label, gente }) =>
              gente.length > 0 && (
                <section className="grp" key={label}>
                  <div className="grp__h">
                    <h2 className="lbl">{label}</h2>
                    <span className="grp__n">{gente.length}</span>
                  </div>
                  {vista === 'lista' ? (
                    <div className="card equipo__lista">
                      {gente.map((m) => (
                        <Ficha key={m.id} m={m} lista onClick={() => setAbierta(m)} />
                      ))}
                    </div>
                  ) : (
                    <div className="tiles tiles--3">
                      {gente.map((m) => (
                        <Ficha key={m.id} m={m} onClick={() => setAbierta(m)} />
                      ))}
                    </div>
                  )}
                </section>
              ),
          )}

          {anteriores.length > 0 && (
            <section className="grp">
              <div className="grp__h">
                <h2 className="lbl">Temporadas anteriores</h2>
                <span className="grp__n">{anteriores.length}</span>
              </div>
              <div className="tiles tiles--3">
                {anteriores.map((m) => (
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
          onEliminar={() => eliminar.mutate(abierta.id)}
          onRepartir={() => {
            setAbierta(null)
            setRepartir(true)
          }}
        />
      )}
      {abierta && abierta.role !== 'seller' && (
        <StaffModal
          m={abierta}
          esYo={abierta.id === me?.id}
          onClose={() => setAbierta(null)}
          onEditar={() => editar(abierta)}
          onSacar={() => sacar.mutate(abierta.id)}
          onEliminar={() => eliminar.mutate(abierta.id)}
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
    custom_role_id: m.custom_role_id ?? null,
    role_name: m.role_name ?? null,
    avatar_at: m.avatar_at ?? null,
    must_change_password: false,
    is_active: m.left_at === null,
    created_at: m.joined_at,
    last_login_at: m.last_login_at,
  }
}
