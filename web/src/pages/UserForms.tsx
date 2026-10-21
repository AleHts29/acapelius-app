import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, roleLabel } from '../api/client'
import type { Role, User, UserAccessResponse } from '../api/client'
import { daysAgo } from '../lib/format'
import { Button, Seg } from '../ui/Button'
import { Label } from '../ui/Label'
import { Modal } from '../ui/Modal'
import { Row } from '../ui/Row'

// Los formularios de Equipo: sumar una persona y editar sus datos y su acceso.
// Mismos flujos de siempre, en el popup del sistema B (C19).

const ROLES: Array<{ value: Role; label: string }> = (['seller', 'door', 'admin'] as Role[]).map((r) => ({
  value: r,
  label: roleLabel(r),
}))

function useRefrescar() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] })
    void queryClient.invalidateQueries({ queryKey: ['team'] })
    // Las invitaciones pendientes son una alerta de Inicio y Dirección.
    void queryClient.invalidateQueries({ queryKey: ['attention'] })
    void queryClient.invalidateQueries({ queryKey: ['home'] })
  }
}

export function NewUserSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (access: UserAccessResponse) => void
}) {
  const refrescar = useRefrescar()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('seller')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => api.createUser({ name: name.trim(), email: email.trim(), role }),
    onSuccess: (access) => {
      refrescar()
      onCreated(access)
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario.'),
  })

  const ready = name.trim() !== '' && email.trim() !== ''

  return (
    <Modal
      open
      onClose={onClose}
      label="Equipo"
      title="Sumar persona"
      sub="Le llega un mail con su acceso y una contraseña provisoria"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button go disabled={!ready || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creando…' : 'Crear y mandar la invitación'}
          </Button>
        </>
      }
    >
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <label className="field">
        <span className="lbl">Nombre</span>
        <input className="field__input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Josefina" autoFocus />
      </label>
      <label className="field">
        <span className="lbl">Mail</span>
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
        <Label>Rol</Label>
        <Seg<Role> label="Rol" value={role} onChange={setRole} options={ROLES} />
      </div>
    </Modal>
  )
}

/**
 * Datos y acceso de una persona: editar nombre, mail y rol, reenviar la
 * invitación (si nunca entró), resetear la contraseña y dar de baja. La baja
 * es lógica: sus ventas quedan, pero no puede entrar más.
 */
export function UserSheet({
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
  const refrescar = useRefrescar()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [role, setRole] = useState<Role>(user.role)
  const [error, setError] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback)

  const update = useMutation({
    mutationFn: (input: { name: string; email: string; role: Role; is_active: boolean }) => api.updateUser(user.id, input),
    onSuccess: refrescar,
    onError: (err) => fail(err, 'No se pudo guardar.'),
  })

  const access = useMutation({
    mutationFn: (kind: 'invite' | 'reset') => (kind === 'invite' ? api.resendInvite(user.id) : api.resetPassword(user.id)),
    onSuccess: (result) => {
      refrescar()
      onAccess(result)
      onClose()
    },
    onError: (err) => fail(err, 'No se pudo generar el acceso.'),
  })

  const pending = user.last_login_at === null
  const dirty = name.trim() !== user.name || email.trim() !== user.email || role !== user.role
  const busy = update.isPending || access.isPending

  /**
   * Guarda lo editado y recién después sigue. Las acciones (reenviar,
   * resetear) no pueden descartar en silencio un cambio de nombre o de rol ya
   * escrito: si el guardado falla, la acción no se ejecuta y queda el error.
   */
  async function guardarY(despues?: () => void) {
    setError(null)
    if (dirty) {
      try {
        await update.mutateAsync({ name: name.trim(), email: email.trim(), role, is_active: user.is_active })
      } catch {
        return // el error ya quedó a la vista
      }
    }
    despues?.()
  }

  return (
    <Modal
      open
      onClose={onClose}
      label={roleLabel(user.role)}
      title={user.name}
      sub={pending ? 'Invitación pendiente · nunca entró' : `Último ingreso ${daysAgo(user.last_login_at!)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button go disabled={!dirty || busy} onClick={() => void guardarY(onClose)}>
            {update.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <label className="field">
        <span className="lbl">Nombre</span>
        <input className="field__input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="lbl">Mail</span>
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
        <Label>Rol</Label>
        <Seg<Role> label="Rol" value={role} onChange={setRole} options={ROLES} disabled={isSelf} />
        {isSelf && <p className="note">No podés cambiarte el rol a vos misma: quedarías afuera de dirección.</p>}
      </div>

      <div>
        <Label>Acceso</Label>
        <div className="mini" style={{ marginTop: 7 }}>
          {pending && user.is_active && (
            <Row
              title="Reenviar invitación"
              sub={dirty ? 'Guarda los cambios y reenvía' : 'Genera una contraseña nueva'}
              onClick={busy ? undefined : () => void guardarY(() => access.mutate('invite'))}
            />
          )}
          {!pending && user.is_active && (
            <Row
              title="Resetear contraseña"
              sub={dirty ? 'Guarda los cambios y resetea' : 'Se la mandamos por mail'}
              onClick={busy ? undefined : () => void guardarY(() => access.mutate('reset'))}
            />
          )}
          {!isSelf && (
            <Row
              title={!user.is_active ? 'Reactivar' : confirmOff ? '¿Seguro? Tocá de nuevo: no va a poder entrar más' : 'Desactivar'}
              sub={user.is_active ? 'No borra nada: sus ventas quedan y deja de aparecer en el reparto de cupos' : undefined}
              onClick={
                busy
                  ? undefined
                  : () => {
                      if (user.is_active && !confirmOff) {
                        setConfirmOff(true)
                        return
                      }
                      // Guarda también lo editado: la baja no es excusa para
                      // perder un cambio de nombre o de rol ya escrito.
                      update.mutate(
                        { name: name.trim(), email: email.trim(), role, is_active: !user.is_active },
                        { onSuccess: onClose },
                      )
                    }
              }
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
