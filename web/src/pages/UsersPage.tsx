import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Copy, KeyRound, Mail, UserMinus, UserPlus } from 'lucide-react'

import { ApiError, api, roleLabel } from '../api/client'
import type { Role, User, UserAccessResponse } from '../api/client'
import { useSession } from '../auth/session'
import { daysAgo } from '../lib/format'
import { initials } from '../lib/search'
import { BottomSheet, SheetAction } from '../ui/BottomSheet'
import { EmptyState, PageHead } from '../ui/controls'
import { Chip, PendingInviteChip } from '../ui/StatusChip'

/** Tono del avatar y del chip según el rol (mockup usuarios-cupos, pantalla 1). */
const ROLE_TONE: Record<Role, 'ink' | 'blue' | 'ok'> = {
  admin: 'ink',
  seller: 'blue',
  door: 'ok',
}

/** Los tres grupos de la lista, en el orden en que Eli los lee. */
const GROUPS: Array<{ role: Role; title: string }> = [
  { role: 'admin', title: 'Dirección' },
  { role: 'seller', title: 'Coristas' },
  { role: 'door', title: 'Puerta' },
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
    <div className={`accesscard ${emailStatus === 'sent' ? '' : 'accesscard--warn'}`}>
      <p className="eyebrow">
        {emailStatus === 'sent' ? `Invitación enviada a ${user.email}` : 'No salió el email'}
      </p>
      <b className="accesscard__pw">{tempPassword}</b>
      <p className="muted" style={{ fontSize: 11, margin: '4px 0 10px' }}>
        {emailStatus === 'sent'
          ? 'Contraseña provisoria, por si te la pide. Cambia al primer ingreso.'
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
function TeamRow({ user, onOpen }: { user: User; onOpen: () => void }) {
  return (
    <button className={`urow ${user.is_active ? '' : 'urow--off'}`} type="button" onClick={onOpen}>
      <span className={`ini ini--${ROLE_TONE[user.role]}`} aria-hidden>
        {initials(user.name)}
      </span>
      <span className="mrow__mid">
        <b>{user.name}</b>
        <span>{user.email}</span>
      </span>
      {!user.is_active ? (
        <Chip tone="neutral">Inactiva</Chip>
      ) : user.last_login_at === null ? (
        <PendingInviteChip />
      ) : (
        <Chip tone={ROLE_TONE[user.role]}>{roleLabel(user.role)}</Chip>
      )}
      <ChevronRight size={15} aria-hidden className="mrow__dots" />
    </button>
  )
}

/** Sheet de alta: nombre, email y rol como segmento de tres (C7). */
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
      onCreated(access)
      onClose()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario.'),
  })

  const ready = name.trim() !== '' && email.trim() !== ''

  return (
    <BottomSheet open onClose={onClose} label="Nuevo usuario">
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
    </BottomSheet>
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
    <BottomSheet open onClose={onClose} label={`Editar a ${user.name}`}>
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
    </BottomSheet>
  )
}

export function UsersPage() {
  const { user: me } = useSession()
  const [creating, setCreating] = useState(false)
  const [detailFor, setDetailFor] = useState<User | null>(null)
  const [access, setAccess] = useState<UserAccessResponse | null>(null)

  const { data, isPending } = useQuery({ queryKey: ['users'], queryFn: () => api.listUsers() })
  const users = data?.users ?? []

  // ?u=N llega de una alerta de Dirección: abre el detalle de esa persona.
  const [searchParams, setSearchParams] = useSearchParams()
  const focusId = Number(searchParams.get('u')) || undefined
  useEffect(() => {
    if (focusId === undefined) return
    const user = users.find((u) => u.id === focusId)
    if (user) {
      setDetailFor(user)
      setSearchParams({}, { replace: true })
    }
  }, [focusId, users, setSearchParams])

  return (
    <>
      <PageHead title="Equipo" action={{ label: 'Nuevo usuario', onClick: () => setCreating(true) }} />

      {access && <AccessCard access={access} onClose={() => setAccess(null)} />}

      {isPending ? (
        <p className="muted">Cargando…</p>
      ) : users.length === 0 ? (
        <EmptyState icon={<UserPlus size={20} />} title="Todavía no hay nadie más">
          Sumá a las coristas con el botón de abajo: a cada una le llega su acceso por email.
        </EmptyState>
      ) : (
        GROUPS.map(({ role, title }) => {
          const group = users.filter((user) => user.role === role)
          if (group.length === 0) return null
          return (
            <div key={role}>
              <div className="ghead">
                <b>
                  {title} · {group.length}
                </b>
              </div>
              {group.map((user) => (
                <TeamRow key={user.id} user={user} onOpen={() => setDetailFor(user)} />
              ))}
            </div>
          )
        })
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
