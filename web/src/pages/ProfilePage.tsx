import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, avatarURL, roleLabel } from '../api/client'
import { useSession } from '../auth/session'
import { MiFoto } from '../components/MiFoto'
import { daysAgo, dayAndMonth } from '../lib/format'
import { initials } from '../lib/search'
import { useSeason } from '../season/SeasonProvider'
import { Button } from '../ui/Button'
import { DataList } from '../ui/DataList'
import { FotoGrande } from '../ui/FotoGrande'
import { Label } from '../ui/Label'
import { PageHeader } from '../ui/Page'

/** Tiene que coincidir con domain.MinPasswordLength en el backend. */
const MIN_PASSWORD_LENGTH = 8

/**
 * Mi perfil (C21): la foto (que se ve en grande al tocarla), los datos propios
 * para editar, el detalle de la cuenta y el cambio de contraseña.
 */
export function ProfilePage() {
  const { user, changePassword, logout } = useSession()
  const { current } = useSeason()
  const queryClient = useQueryClient()
  const [viendo, setViendo] = useState(false)
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [error, setError] = useState<string | null>(null)

  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [errorClave, setErrorClave] = useState<string | null>(null)
  const [cambiandoClave, setCambiandoClave] = useState(false)

  const guardar = useMutation({
    meta: { exito: 'Datos guardados' },
    mutationFn: () => api.updateMe({ name: name.trim(), email: email.trim() }),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['me'] })
      void queryClient.invalidateQueries({ queryKey: ['team'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudieron guardar los datos.'),
  })

  if (!user) return null
  const demo = user.organization_is_demo === true
  const cambio = name.trim() !== user.name || email.trim().toLowerCase() !== user.email
  const foto = user.avatar_at ? avatarURL(user.id, user.avatar_at) : null

  async function cambiarClave(e: FormEvent) {
    e.preventDefault()
    setErrorClave(null)
    if (nueva !== repetida) return setErrorClave('Las dos contraseñas nuevas no coinciden.')
    if (nueva.length < MIN_PASSWORD_LENGTH) return setErrorClave(`La contraseña nueva necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
    setCambiandoClave(true)
    try {
      await changePassword(actual, nueva)
      setActual('')
      setNueva('')
      setRepetida('')
    } catch (err) {
      setErrorClave(err instanceof ApiError ? err.message : 'No se pudo cambiar la contraseña.')
    } finally {
      setCambiandoClave(false)
    }
  }

  return (
    <>
      <PageHeader title="Mi perfil" label={user.organization_name} />

      <div className="perfil__cara">
        <button
          type="button"
          className={`perfil__foto${foto ? ' perfil__foto--ver' : ''}`}
          onClick={() => foto && setViendo(true)}
          aria-label={foto ? 'Ver la foto en grande' : undefined}
          disabled={!foto}
        >
          {foto ? <img src={foto} alt="" /> : initials(user.name)}
        </button>
        {!demo && <MiFoto tieneFoto={!!user.avatar_at} />}
      </div>

      <form
        className="perfil__sec"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          guardar.mutate()
        }}
      >
        <Label>Mis datos</Label>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          <span className="lbl">Nombre</span>
          <input className="field__input" type="text" value={name} disabled={demo} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="field">
          <span className="lbl">Mail</span>
          <input
            className="field__input"
            type="email"
            value={email}
            disabled={demo}
            onChange={(e) => setEmail(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            autoComplete="email"
          />
          <span className="rs" style={{ whiteSpace: 'normal' }}>Con este mail entrás a la app.</span>
        </label>
        {!demo && (
          <div className="perfil__acciones">
            <Button go type="submit" disabled={!cambio || guardar.isPending}>
              {guardar.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        )}
      </form>

      <section className="perfil__sec">
        <Label>Mi cuenta</Label>
        <DataList
          rows={[
            ['Rol', roleLabel(user.role)],
            ['Grupo', user.organization_name ?? '—'],
            ['Temporada', current?.name ?? '—'],
            ['En Acapelius desde', dayAndMonth(user.created_at) + ' ' + new Date(user.created_at).getFullYear()],
            ['Último ingreso', user.last_login_at ? daysAgo(user.last_login_at) : '—'],
          ]}
        />
      </section>

      {!demo && (
        <form className="perfil__sec" noValidate onSubmit={(e) => void cambiarClave(e)}>
          <Label>Cambiar contraseña</Label>
          {errorClave && (
            <p className="alert" role="alert">
              {errorClave}
            </p>
          )}
          <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
          <label className="field">
            <span className="lbl">Contraseña actual</span>
            <input className="field__input" type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="field">
            <span className="lbl">Contraseña nueva</span>
            <input className="field__input" type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="field">
            <span className="lbl">Repetila</span>
            <input className="field__input" type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} autoComplete="new-password" />
          </label>
          <div className="perfil__acciones">
            <Button type="submit" disabled={!actual || !nueva || cambiandoClave}>
              {cambiandoClave ? 'Cambiando…' : 'Cambiar contraseña'}
            </Button>
          </div>
        </form>
      )}

      <section className="perfil__sec">
        <Button wide onClick={() => void logout()}>
          Cerrar sesión
        </Button>
      </section>

      {viendo && foto && <FotoGrande src={foto} nombre={user.name} onClose={() => setViendo(false)} />}
    </>
  )
}
