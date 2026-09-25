import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  Copy,
  KeyRound,
  Mail,
  Send,
  UserMinus,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react'

import { ApiError, api, roleLabel } from '../api/client'
import type { FormerMember, Role, TeamMember, User, UserAccessResponse } from '../api/client'
import { useSession } from '../auth/session'
import { daysAgo, formatMoney } from '../lib/format'
import { initials, normalizeText } from '../lib/search'
import { useSeason } from '../season/SeasonProvider'
import { useIsDesktop } from '../lib/viewport'
import { ActionPanel, SheetAction } from '../ui/ActionPanel'
import { Menu } from '../ui/Menu'
import { EmptyState, FilterChips, Hl, PageHead, ProgressBar, SearchBar } from '../ui/controls'

/** Tono del avatar y del chip según el rol (mockup usuarios-cupos, pantalla 1). */
const ROLE_TONE: Record<Role, 'ink' | 'blue' | 'ok'> = {
  admin: 'ink',
  seller: 'blue',
  door: 'ok',
}

/** Los tres bloques, en el orden en que Eli los lee, con lo que hace cada rol. */
const GROUPS: Array<{ role: Role; title: string; sub: string }> = [
  { role: 'admin', title: 'Dirección', sub: 'Acceso total' },
  { role: 'seller', title: 'Coristas', sub: 'Venden y consultan sus ventas' },
  { role: 'door', title: 'Puerta', sub: 'Solo escanean y marcan ingresos' },
]

/**
 * Tarjeta con el acceso recién generado (alta, reenvío o reseteo). El email ya
 * salió, pero la contraseña provisoria queda a mano para pasarla por WhatsApp
 * — y es el plan B cuando el envío falla.
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
    <div className={`accesscard ${emailStatus === 'failed' ? 'accesscard--warn' : ''}`}>
      <p className="eyebrow">
        {emailStatus === 'sent'
          ? `Invitación enviada a ${user.email}`
          : emailStatus === 'preview'
            ? 'En la demo no se mandan mails'
            : 'No salió el email'}
      </p>
      <b className="accesscard__pw">{tempPassword}</b>
      <p className="muted" style={{ fontSize: 11, margin: '4px 0 10px' }}>
        {emailStatus === 'sent'
          ? 'Contraseña provisoria, por si te la pide. Cambia al primer ingreso.'
          : emailStatus === 'preview'
            ? 'Esto es lo que le llegaría por mail. Cambia al primer ingreso.'
            : 'Pasale estos datos por WhatsApp: el email no se pudo entregar.'}
      </p>
      <div className="form-row">
        <button className="button" type="button" onClick={() => void copy()}>
          <Copy size={14} aria-hidden /> {copied ? 'Copiado ✓' : 'Copiar mensaje'}
        </button>
        <button className="button button--ghost" type="button" onClick={onClose}>
          Listo
        </button>
      </div>
    </div>
  )
}

/** Fila del equipo: avatar, nombre, email y chip de rol (o de invitación). */

// --- Estado de una persona en la temporada ----------------------------------

type EstadoPersona = 'activa' | 'pendiente' | 'salio'

/**
 * Se separan dos cosas que antes se confundían: si participa de esta
 * temporada y si ya activó su cuenta. El rol lo dice el bloque; la columna
 * Estado dice lo que sí varía.
 */
function estadoDe(m: TeamMember): EstadoPersona {
  if (m.left_at !== null) return 'salio'
  return m.last_login_at === null ? 'pendiente' : 'activa'
}

const ESTADO: Record<EstadoPersona, { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  activa: { label: 'Activa', tone: 'ok' },
  pendiente: { label: 'Pendiente', tone: 'warn' },
  salio: { label: 'Dejó el coro', tone: 'neutral' },
}

/** "Hoy", "Ayer", "hace 3 d", "Nunca entró". */
function ultimoAcceso(iso: string | null): string {
  if (iso === null) return 'Nunca entró'
  const texto = daysAgo(iso)
  return texto === 'hoy' ? 'Hoy' : texto === 'ayer' ? 'Ayer' : texto
}

/** El renglón bajo el nombre en escritorio: cuánto lleva o cuándo se fue. */
function contextoDe(m: TeamMember): string {
  if (m.left_at !== null) return `Dejó el coro ${daysAgo(m.left_at)}`
  if (m.last_login_at === null) return `Sumada ${daysAgo(m.joined_at)}`
  return m.seasons === 1 ? '1ª temporada' : `${m.seasons}ª temporada`
}

/**
 * El mismo renglón en celular, donde no hay columnas: ahí tiene que llevar lo
 * que es la razón de entrar a Equipo —cuánto vendió y cuánto debe rendir—, no
 * el número de temporada, que en la tabla es apenas contexto.
 */
function resumenMovil(m: TeamMember, esCorista: boolean): string {
  if (m.left_at !== null) return `Dejó el coro · vendió ${m.tickets_sold}`
  if (m.last_login_at === null) return 'Nunca entró · invitación pendiente'
  if (esCorista) {
    const vendidas = `${m.tickets_sold} ${m.tickets_sold === 1 ? 'vendida' : 'vendidas'}`
    return m.balance_cents > 0
      ? `${vendidas} · debe rendir ${formatMoney(m.balance_cents)}`
      : `${vendidas} · al día`
  }
  if (m.checkins > 0) return `${m.checkins} ingresos registrados`
  return contextoDe(m)
}

// --- Fila de persona --------------------------------------------------------

function PersonaRow({
  m,
  q,
  esCorista,
  seleccionada,
  onSeleccionar,
  onAbrir,
  onInvitar,
  onRendicion,
}: {
  m: TeamMember
  q: string
  esCorista: boolean
  seleccionada: boolean
  onSeleccionar: (on: boolean) => void
  onAbrir: () => void
  onInvitar: () => void
  onRendicion: () => void
}) {
  const estado = estadoDe(m)
  const uso = m.assigned > 0 ? Math.round((m.tickets_sold / m.assigned) * 100) : null

  return (
    <div
      className={`prow${seleccionada ? ' prow--sel' : ''}${estado === 'salio' ? ' prow--out' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onAbrir()
        }
      }}
    >
      <span className="srow__pick" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={seleccionada}
          aria-label={`Seleccionar a ${m.name}`}
          onChange={(e) => onSeleccionar(e.target.checked)}
        />
      </span>

      <span className="srow__buyer">
        {/* El avatar es siempre índigo: el rol lo comunica el bloque, no el
            color de la persona. */}
        <span className="ini">{initials(m.name)}</span>
        <span className="srow__who">
          <b>
            <Hl text={m.name} q={q} />
          </b>
          {/* Para quien se fue, cuándo fue importa más que el mail: es el
              dato con el que se entiende su fila entera. */}
          <span className="srow__mail">
            {m.left_at !== null ? `Dejó el coro ${daysAgo(m.left_at)}` : m.email}
          </span>
          <span className="srow__sub">{resumenMovil(m, esCorista)}</span>
        </span>
      </span>

      <span className="srow__col prow__n">{esCorista ? m.tickets_sold : m.checkins || '—'}</span>
      <span className="srow__col prow__uso">
        {esCorista && uso !== null ? (
          <>
            <ProgressBar value={m.tickets_sold} max={m.assigned} tone={uso >= 80 ? 'ok' : 'blue'} />
            {/* Arriba de 100% no es "aprovechó bien el cupo": vendió más de lo
                que tiene asignado, y eso hay que mirarlo. */}
            <small className={uso > 100 ? 'y' : undefined}>{uso}%</small>
          </>
        ) : (
          '—'
        )}
      </span>
      <span className="srow__col prow__debe">
        {esCorista ? (
          <b className={m.balance_cents > 0 ? 'y' : ''}>{formatMoney(Math.max(m.balance_cents, 0))}</b>
        ) : (
          '—'
        )}
      </span>
      <span className="srow__col prow__when">{ultimoAcceso(m.last_login_at)}</span>

      <span className={`chip chip--${ESTADO[estado].tone} prow__chip`}>{ESTADO[estado].label}</span>

      <span className="srow__act" onClick={(e) => e.stopPropagation()}>
        {estado === 'pendiente' ? (
          <button className="srow__do" type="button" onClick={onInvitar}>
            Reenviar
          </button>
        ) : m.balance_cents > 0 ? (
          <button className="srow__do" type="button" onClick={onRendicion}>
            Ver rendición
          </button>
        ) : null}
      </span>

      <span className="srow__dots" onClick={(e) => e.stopPropagation()}>
        <Menu
          trigger="kebab"
          label={`Acciones de ${m.name}`}
          align="right"
          groups={[
            {
              options: [
                { id: 'ver', label: 'Ver y editar', icon: <UserPlus size={15} />, onSelect: onAbrir },
                {
                  id: 'invitar',
                  label: 'Reenviar invitación',
                  icon: <Mail size={15} />,
                  disabled: estado !== 'pendiente',
                  disabledReason: 'Ya entró alguna vez: lo que corresponde es resetear la clave',
                  onSelect: onInvitar,
                },
                {
                  id: 'rendicion',
                  label: 'Ver rendición',
                  hint: m.balance_cents > 0 ? `debe ${formatMoney(m.balance_cents)}` : 'está al día',
                  icon: <Wallet size={15} />,
                  disabled: !esCorista,
                  disabledReason: 'No es corista: no tiene nada que rendir',
                  onSelect: onRendicion,
                },
              ],
            },
          ]}
        />
      </span>
    </div>
  )
}

// --- Bloque por rol ---------------------------------------------------------

function BloqueRol({
  role,
  title,
  sub,
  gente,
  q,
  seleccion,
  onSeleccion,
  onAbrir,
  onInvitar,
  onRendicion,
}: {
  role: Role
  title: string
  sub: string
  gente: TeamMember[]
  q: string
  seleccion: Set<number>
  onSeleccion: (ids: number[], on: boolean) => void
  onAbrir: (m: TeamMember) => void
  onInvitar: (m: TeamMember) => void
  onRendicion: (m: TeamMember) => void
}) {
  const esCorista = role === 'seller'
  const ids = gente.map((m) => m.id)
  const todas = ids.length > 0 && ids.every((id) => seleccion.has(id))
  const vendidas = gente.reduce((acc, m) => acc + m.tickets_sold, 0)
  const sinRendir = gente.reduce((acc, m) => acc + Math.max(m.balance_cents, 0), 0)
  const ingresos = gente.reduce((acc, m) => acc + m.checkins, 0)

  return (
    <section className={`sblock sblock--team sblock--${role}`}>
      <div className="sblock__h">
        <span className="sblock__nm">
          <b>{title}</b>
          <span>{sub}</span>
        </span>
        <span className="sblock__t">
          <span>
            <b>{gente.length}</b> {gente.length === 1 ? 'persona' : 'personas'}
          </span>
          {esCorista && (
            <>
              <span>
                <b>{vendidas}</b> entradas vendidas
              </span>
              <span>
                Sin rendir <b className={sinRendir > 0 ? 'y' : 'g'}>{formatMoney(sinRendir)}</b>
              </span>
            </>
          )}
          {role === 'door' && ingresos > 0 && (
            <span>
              <b>{ingresos}</b> ingresos registrados
            </span>
          )}
        </span>
      </div>

      <div className="sthead sthead--team">
        <span className="srow__pick">
          <input
            type="checkbox"
            checked={todas}
            aria-label={`Seleccionar ${title}`}
            onChange={(e) => onSeleccion(ids, e.target.checked)}
          />
        </span>
        <span>Persona</span>
        <span className="sthead__r">{esCorista ? 'Vendidas' : 'Ingresos'}</span>
        <span>Uso del cupo</span>
        <span className="sthead__r">Sin rendir</span>
        <span>Último acceso</span>
        <span className="sthead__r">Estado</span>
        <span />
        <span />
      </div>

      {gente.map((m) => (
        <PersonaRow
          key={m.id}
          m={m}
          q={q}
          esCorista={esCorista}
          seleccionada={seleccion.has(m.id)}
          onSeleccionar={(on) => onSeleccion([m.id], on)}
          onAbrir={() => onAbrir(m)}
          onInvitar={() => onInvitar(m)}
          onRendicion={() => onRendicion(m)}
        />
      ))}
    </section>
  )
}

// --- Quienes no participan de esta temporada --------------------------------

function NoParticipan({
  gente,
  seasonId,
  onCambio,
}: {
  gente: FormerMember[]
  seasonId: number | undefined
  onCambio: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const reincorporar = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) =>
      api.addMember(seasonId!, id, role),
    onSuccess: onCambio,
  })

  return (
    <section className="sblock sblock--former">
      <div className="sblock__h">
        <button
          className="sblock__fold"
          type="button"
          aria-expanded={abierto}
          onClick={() => setAbierto(!abierto)}
        >
          <ChevronDown size={14} className={abierto ? '' : 'up'} aria-hidden />
        </button>
        <span className="sblock__nm">
          <b>No participan de esta temporada</b>
          <span>Participaron en años anteriores</span>
        </span>
        <span className="sblock__t">
          <span>
            <b>{gente.length}</b> {gente.length === 1 ? 'persona' : 'personas'}
          </span>
        </span>
      </div>

      {abierto &&
        gente.map((m) => (
          <div key={m.id} className="prow prow--former">
            <span className="srow__pick" />
            <span className="srow__buyer">
              <span className="ini">{initials(m.name)}</span>
              <span className="srow__who">
                <b>{m.name}</b>
                <span className="srow__mail">
                  Última temporada: {m.last_season_name} · vendió {m.last_tickets_sold} entradas
                </span>
                <span className="srow__sub">Última temporada: {m.last_season_name}</span>
              </span>
            </span>
            <span className="srow__col prow__n">—</span>
            <span className="srow__col prow__uso">—</span>
            <span className="srow__col prow__debe">—</span>
            <span className="srow__col prow__when">{ultimoAcceso(m.last_login_at)}</span>
            <span className="prow__chip">
              <button
                className="srow__do srow__do--ok"
                type="button"
                disabled={seasonId === undefined || reincorporar.isPending}
                onClick={() => reincorporar.mutate({ id: m.id, role: m.last_role })}
              >
                Reincorporar
              </button>
            </span>
            <span className="srow__act" />
            <span className="srow__dots" />
          </div>
        ))}
    </section>
  )
}

function NewUserSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (access: UserAccessResponse) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('seller')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => api.createUser({ name: name.trim(), email: email.trim(), role }),
    onSuccess: (access) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['attention'] })
    void queryClient.invalidateQueries({ queryKey: ['home'] })
      onCreated(access)
      onClose()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario.'),
  })

  const ready = name.trim() !== '' && email.trim() !== ''

  return (
    <ActionPanel open onClose={onClose} label="Nuevo usuario">
      <div className="sheet-head">
        <span className="ini" aria-hidden>
          <UserPlus size={16} />
        </span>
        <span>
          <b>Nuevo usuario</b>
          <span>Le llega un email con su acceso</span>
        </span>
      </div>

      {error && (
        <p className="alert" role="alert" style={{ margin: '12px 0 0' }}>
          {error}
        </p>
      )}

      <label className="field">
        <span className="field__label">Nombre</span>
        <input
          className="field__input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Josefina"
          autoFocus
        />
      </label>

      <label className="field">
        <span className="field__label">Email</span>
        <input
          className="field__input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="josefina@gmail.com"
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="email"
        />
      </label>

      <div className="field">
        <span className="field__label">Rol</span>
        <RolePicker value={role} onChange={setRole} />
      </div>

      <button
        className="button"
        style={{ marginTop: 12 }}
        type="button"
        disabled={!ready || create.isPending}
        onClick={() => create.mutate()}
      >
        {create.isPending ? 'Creando…' : 'Crear y enviar invitación'}
      </button>
      <p className="muted" style={{ textAlign: 'center', fontSize: 10.5, margin: '8px 0 0' }}>
        Le llega un email con acceso y contraseña temporal.
      </p>
    </ActionPanel>
  )
}

/** Segmento de tres con los roles, en el orden del mockup. */
function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: Role
  onChange: (role: Role) => void
  disabled?: boolean
}) {
  return (
    <div className="segmented" role="tablist" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      {(['seller', 'door', 'admin'] as Role[]).map((role) => (
        <button
          key={role}
          type="button"
          role="tab"
          aria-selected={role === value}
          className={role === value ? 'on' : ''}
          disabled={disabled}
          onClick={() => onChange(role)}
        >
          {roleLabel(role)}
        </button>
      ))}
    </div>
  )
}

/**
 * Detalle de una persona: editar nombre y rol, reenviar la invitación (si
 * nunca entró), resetear la contraseña y dar de baja. La baja es lógica: sus
 * ventas quedan, pero no puede entrar más.
 */
function UserSheet({
  user,
  isSelf,
  onClose,
  onAccess,
}: {
  user: User
  isSelf: boolean
  onClose: () => void
  onAccess: (access: UserAccessResponse) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [role, setRole] = useState<Role>(user.role)
  const [error, setError] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] })
    // Las invitaciones pendientes son una alerta del panel (C9).
    void queryClient.invalidateQueries({ queryKey: ['attention'] })
    void queryClient.invalidateQueries({ queryKey: ['home'] })
  }
  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError ? err.message : fallback)

  const update = useMutation({
    mutationFn: (input: { name: string; email: string; role: Role; is_active: boolean }) =>
      api.updateUser(user.id, input),
    onSuccess: refresh,
    onError: (err) => fail(err, 'No se pudo guardar.'),
  })

  const access = useMutation({
    mutationFn: (kind: 'invite' | 'reset') =>
      kind === 'invite' ? api.resendInvite(user.id) : api.resetPassword(user.id),
    onSuccess: (result) => {
      refresh()
      onAccess(result)
      onClose()
    },
    onError: (err) => fail(err, 'No se pudo generar el acceso.'),
  })

  const pending = user.last_login_at === null
  const dirty = name.trim() !== user.name || email.trim() !== user.email || role !== user.role
  const busy = update.isPending || access.isPending

  /**
   * Guarda lo editado y recien despues sigue. Las acciones (reenviar, resetear)
   * no pueden descartar en silencio un cambio de nombre o de rol que la persona
   * ya escribio: si el guardado falla, la accion no se ejecuta y queda el error.
   */
  async function guardarY(despues?: () => void) {
    setError(null)
    if (dirty) {
      try {
        await update.mutateAsync({
          name: name.trim(),
          email: email.trim(),
          role,
          is_active: user.is_active,
        })
      } catch {
        return // el error ya quedo a la vista
      }
    }
    despues?.()
  }

  return (
    <ActionPanel open onClose={onClose} label={`Editar a ${user.name}`}>
      <div className="sheet-head">
        <span className={`ini ini--${ROLE_TONE[user.role]}`} aria-hidden>
          {initials(user.name)}
        </span>
        <span>
          <b>{user.name}</b>
          <span>
            {pending
              ? 'Invitación pendiente · nunca entró'
              : `Último ingreso ${daysAgo(user.last_login_at!)}`}
          </span>
        </span>
      </div>

      {error && (
        <p className="alert" role="alert" style={{ margin: '12px 0 0' }}>
          {error}
        </p>
      )}

      <label className="field">
        <span className="field__label">Nombre</span>
        <input
          className="field__input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">Email</span>
        <input
          className="field__input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="email"
        />
      </label>

      <div className="field">
        <span className="field__label">Rol</span>
        <RolePicker value={role} onChange={setRole} disabled={isSelf} />
        {isSelf && (
          <p className="muted" style={{ fontSize: 10.5, margin: '6px 0 0' }}>
            No podés cambiarte el rol a vos misma: quedarías afuera de dirección.
          </p>
        )}
      </div>

      <button
        className="button"
        style={{ margin: '12px 0 4px' }}
        type="button"
        disabled={!dirty || busy}
        onClick={() => void guardarY(onClose)}
      >
        {update.isPending ? 'Guardando…' : 'Guardar cambios'}
      </button>

      {pending && user.is_active && (
        <SheetAction
          icon={<Mail size={15} />}
          disabled={busy}
          hint={dirty ? 'guarda y reenvía' : 'genera una clave nueva'}
          onClick={() => void guardarY(() => access.mutate('invite'))}
        >
          Reenviar invitación
        </SheetAction>
      )}

      {!pending && user.is_active && (
        <SheetAction
          icon={<KeyRound size={15} />}
          disabled={busy}
          hint={dirty ? 'guarda y resetea' : 'se la mandamos por email'}
          onClick={() => void guardarY(() => access.mutate('reset'))}
        >
          Resetear contraseña
        </SheetAction>
      )}

      {!isSelf && (
        <SheetAction
          icon={<UserMinus size={15} />}
          tone={user.is_active ? 'danger' : 'ok'}
          disabled={busy}
          onClick={() => {
            if (user.is_active && !confirmOff) {
              setConfirmOff(true)
              return
            }
            // Guarda tambien lo editado: la baja no es excusa para perder un
            // cambio de nombre o de rol que ya estaba escrito.
            update.mutate(
              {
                name: name.trim(),
                email: email.trim(),
                role,
                is_active: !user.is_active,
              },
              { onSuccess: onClose },
            )
          }}
        >
          {!user.is_active
            ? 'Reactivar'
            : confirmOff
              ? '¿Seguro? No va a poder entrar más'
              : 'Desactivar'}
        </SheetAction>
      )}

      {user.is_active && !isSelf && (
        <p className="muted" style={{ fontSize: 10.5, margin: '10px 0 0' }}>
          Desactivar no borra nada: sus ventas quedan y deja de aparecer en las asignaciones de
          cupo.
        </p>
      )}
    </ActionPanel>
  )
}

export function UsersPage() {
  const { user: me } = useSession()
  const escritorio = useIsDesktop()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [detailFor, setDetailFor] = useState<User | null>(null)
  const [access, setAccess] = useState<UserAccessResponse | null>(null)
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<'todas' | 'pendientes' | 'deben' | 'salieron'>('todas')
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const [aviso, setAviso] = useState<string | null>(null)

  // La temporada la manda el selector global (C16): se va el selector propio
  // de esta pantalla, que podía estar mirando un año distinto que Plata.
  const { season, current: enCurso } = useSeason()
  const mirando = season?.id
  const esLaEnCurso = mirando === enCurso?.id

  const { data, isPending } = useQuery({
    queryKey: ['team', mirando],
    queryFn: () => api.team(mirando),
  })
  const members = data?.members ?? []
  const former = data?.former ?? []
  const resumen = data?.summary

  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: ['team'] })
    void queryClient.invalidateQueries({ queryKey: ['users'] })
    void queryClient.invalidateQueries({ queryKey: ['home'] })
  }

  const invitar = useMutation({
    mutationFn: (id: number) => api.resendInvite(id),
    onSuccess: (res) => {
      setAccess(res)
      refrescar()
    },
    onError: (err) => setAviso(err instanceof ApiError ? err.message : 'No se pudo reenviar.'),
  })
  const sacar = useMutation({
    mutationFn: (id: number) => api.removeMember(mirando!, id),
    onSuccess: () => {
      setSeleccion(new Set())
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
      setDetailFor(comoUser(m))
      setSearchParams({}, { replace: true })
    }
  }, [focusId, members, setSearchParams])

  const nq = normalizeText(q)
  const coincide = (m: TeamMember) =>
    nq === '' || normalizeText(m.name).includes(nq) || normalizeText(m.email).includes(nq)
  const pasaFiltro = (m: TeamMember) => {
    switch (filtro) {
      case 'pendientes':
        return estadoDe(m) === 'pendiente'
      case 'deben':
        return m.balance_cents > 0
      case 'salieron':
        return estadoDe(m) === 'salio'
      default:
        return true
    }
  }
  const visibles = members.filter((m) => coincide(m) && pasaFiltro(m))
  const seleccionadas = members.filter((m) => seleccion.has(m.id))

  function cambiarSeleccion(ids: number[], on: boolean) {
    setSeleccion((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const deben = members.filter((m) => m.balance_cents > 0).length
  const salieron = members.filter((m) => estadoDe(m) === 'salio').length

  return (
    <>
      <PageHead
        title="Equipo"
        sub={
          resumen
            ? `${resumen.total} ${resumen.total === 1 ? 'persona participa' : 'personas participan'} de esta temporada`
            : undefined
        }
        action={{ label: 'Sumar persona', onClick: () => setCreating(true) }}
      />

      {access && <AccessCard access={access} onClose={() => setAccess(null)} />}

      {!esLaEnCurso && (
        <div className="seasonbar">
          <span>
            Estás mirando el equipo de otra temporada. La que usa el resto de la app es{' '}
            <b>{enCurso?.name}</b>.
          </span>
        </div>
      )}

      {resumen && (
        <div className="tstrip">
          <div>
            <b>{resumen.active}</b>
            <span>Activas</span>
          </div>
          <div>
            <b className={resumen.pending > 0 ? 'y' : undefined}>{resumen.pending}</b>
            <span>Invitaciones pendientes</span>
          </div>
          <div>
            <b>{resumen.tickets_sold}</b>
            <span>Entradas vendidas</span>
          </div>
          <div>
            <b className={resumen.balance_cents > 0 ? 'y' : 'g'}>
              {formatMoney(resumen.balance_cents)}
            </b>
            <span>Sin rendir</span>
          </div>
        </div>
      )}

      <div className="sticky-bar">
        <SearchBar value={q} onChange={setQ} placeholder="Buscar por nombre o email…" />
        <FilterChips<'todas' | 'pendientes' | 'deben' | 'salieron'>
          value={filtro}
          onChange={setFiltro}
          options={[
            { value: 'todas', label: 'Todas', count: members.length },
            { value: 'pendientes', label: 'Pendientes', count: resumen?.pending, tone: 'warn' },
            { value: 'deben', label: 'Deben rendir', count: deben, tone: 'warn' },
            { value: 'salieron', label: 'Dejaron el coro', count: salieron },
          ]}
        />
      </div>

      {isPending ? (
        <p className="muted">Cargando…</p>
      ) : members.length === 0 ? (
        <EmptyState icon={<UserPlus size={20} />} title="Todavía no hay nadie más">
          Sumá a las coristas: a cada una le llega su acceso por email.
        </EmptyState>
      ) : visibles.length === 0 ? (
        <EmptyState icon={<UserPlus size={20} />} title="No hay nadie que coincida">
          <button
            className="button button--ghost"
            type="button"
            onClick={() => {
              setQ('')
              setFiltro('todas')
            }}
          >
            Limpiar filtros
          </button>
        </EmptyState>
      ) : (
        <div className="sblocks">
          {GROUPS.map(({ role, title, sub }) => {
            const gente = visibles.filter((m) => m.role === role)
            if (gente.length === 0) return null
            return (
              <BloqueRol
                key={role}
                role={role}
                title={title}
                sub={sub}
                gente={gente}
                q={q}
                seleccion={seleccion}
                onSeleccion={cambiarSeleccion}
                onAbrir={(m) => setDetailFor(comoUser(m))}
                onInvitar={(m) => invitar.mutate(m.id)}
                onRendicion={(m) => navigate(`/panel/rendiciones/${m.id}`)}
              />
            )
          })}
          {former.length > 0 && (
            <NoParticipan gente={former} seasonId={mirando} onCambio={refrescar} />
          )}
        </div>
      )}

      {/* La selección múltiple es de escritorio, como en Ventas. */}
      {escritorio && esLaEnCurso && seleccionadas.length > 0 && (
        <div className="selbar" role="status">
          <b>
            {seleccionadas.length}{' '}
            {seleccionadas.length === 1 ? 'persona seleccionada' : 'personas seleccionadas'}
          </b>
          <button
            type="button"
            disabled={invitar.isPending}
            onClick={() => {
              for (const m of seleccionadas) {
                if (estadoDe(m) === 'pendiente') invitar.mutate(m.id)
              }
              setSeleccion(new Set())
            }}
          >
            <Send size={14} aria-hidden /> Reenviar invitación
          </button>
          <button
            type="button"
            disabled={sacar.isPending}
            onClick={() => {
              for (const m of seleccionadas) {
                if (m.id !== me?.id) sacar.mutate(m.id)
              }
            }}
          >
            <UserMinus size={14} aria-hidden /> Sacar de la temporada
          </button>
          <button
            className="selbar__x"
            type="button"
            aria-label="Limpiar selección"
            onClick={() => setSeleccion(new Set())}
          >
            <X size={15} aria-hidden />
          </button>
        </div>
      )}

      {aviso && (
        <p className="selbar__msg" role="status" onAnimationEnd={() => setAviso(null)}>
          {aviso}
        </p>
      )}

      {creating && (
        <NewUserSheet onClose={() => setCreating(false)} onCreated={(result) => setAccess(result)} />
      )}

      {detailFor && (
        <UserSheet
          user={detailFor}
          isSelf={detailFor.id === me?.id}
          onClose={() => setDetailFor(null)}
          onAccess={(result) => setAccess(result)}
        />
      )}
    </>
  )
}

/** El drawer sigue trabajando con `User`: la fila del equipo tiene todo lo que
 *  necesita, más los números de la temporada. */
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
