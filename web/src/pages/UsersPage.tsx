import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, roleLabel } from '../api/client'
import type { Role, User } from '../api/client'
import { useSession } from '../auth/session'

interface CreatedCredentials {
  name: string
  email: string
  tempPassword: string
}

/** Tarjeta con las credenciales nuevas y el mensaje listo para WhatsApp. */
function CredentialsCard({ credentials }: { credentials: CreatedCredentials }) {
  const [copied, setCopied] = useState(false)

  const message = [
    `Hola ${credentials.name}! Te creamos tu acceso a Acapelius:`,
    window.location.origin,
    `Email: ${credentials.email}`,
    `Contrasena: ${credentials.tempPassword}`,
    'Al entrar te va a pedir elegir tu propia contrasena.',
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
    <div className="panel panel--success">
      <p className="panel__label">Acceso de {credentials.name}</p>
      <div className="credentials">
        <div className="credentials__line">
          <span className="muted">Email</span>
          <strong>{credentials.email}</strong>
        </div>
        <div className="credentials__line">
          <span className="muted">Contrasena</span>
          <strong>{credentials.tempPassword}</strong>
        </div>
      </div>
      <button className="button" type="button" onClick={() => void copy()}>
        {copied ? 'Copiado ✓' : 'Copiar mensaje para WhatsApp'}
      </button>
      <p className="muted" style={{ margin: '0.6rem 0 0', fontSize: '0.85rem' }}>
        Copia el mensaje completo con el link, el email y la contrasena. No se vuelve a mostrar.
      </p>
    </div>
  )
}

/** Fila del equipo, expandible para editar (CRUD del admin). */
function TeamRow({ user, selfId }: { user: User; selfId: number }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [role, setRole] = useState<Role>(user.role)
  const [error, setError] = useState<string | null>(null)

  const update = useMutation({
    mutationFn: (input: { name: string; email: string; role: Role; is_active: boolean }) =>
      api.updateUser(user.id, input),
    onSuccess: () => {
      setError(null)
      setEditing(false)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo guardar.'),
  })

  const isSelf = user.id === selfId

  return (
    <li className={user.is_active ? '' : 'list__item--inactive'}>
      <div className="list__item list__item--static">
        <span>
          {user.name}
          {!user.is_active && ' · inactiva'}
          <br />
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {user.email}
            {user.must_change_password && user.is_active && ' · todavia no entro'}
          </span>
        </span>
        <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="badge">{roleLabel(user.role)}</span>
          <button
            className="button button--ghost"
            type="button"
            onClick={() => {
              setEditing(!editing)
              setError(null)
            }}
          >
            {editing ? 'Cerrar' : 'Editar'}
          </button>
        </span>
      </div>

      {editing && (
        <div className="team-edit">
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="form-grid">
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
              <span className="field__label">Rol</span>
              <select
                className="field__input"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={isSelf}
              >
                <option value="seller">Corista</option>
                <option value="door">Puerta</option>
                <option value="admin">Direccion</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoCapitalize="none"
            />
          </label>
          <div className="form-row">
            <button
              className="button"
              type="button"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ name: name.trim(), email: email.trim(), role, is_active: user.is_active })
              }
            >
              Guardar
            </button>
            {!isSelf && (
              <button
                className="button button--ghost form-row__action"
                type="button"
                disabled={update.isPending}
                onClick={() => {
                  const action = user.is_active ? 'desactivar' : 'reactivar'
                  if (window.confirm(`¿${action === 'desactivar' ? 'Desactivar' : 'Reactivar'} a ${user.name}?`)) {
                    update.mutate({
                      name: name.trim(),
                      email: email.trim(),
                      role,
                      is_active: !user.is_active,
                    })
                  }
                }}
              >
                {user.is_active ? 'Desactivar' : 'Reactivar'}
              </button>
            )}
          </div>
          {user.is_active && !isSelf && (
            <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.82rem' }}>
              Desactivar no borra nada: sus ventas quedan, pero no puede entrar mas.
            </p>
          )}
        </div>
      )}
    </li>
  )
}

export function UsersPage() {
  const { user: me } = useSession()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('seller')
  const [error, setError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<CreatedCredentials | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.listUsers(),
  })

  const createUser = useMutation({
    mutationFn: () => api.createUser({ name: name.trim(), email: email.trim(), role }),
    onSuccess: (result) => {
      setCredentials(
        result.temp_password
          ? { name: result.user.name, email: result.user.email, tempPassword: result.temp_password }
          : null,
      )
      setName('')
      setEmail('')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setCredentials(null)
    if (name.trim() === '' || email.trim() === '') {
      setError('Falta el nombre o el email.')
      return
    }
    createUser.mutate()
  }

  return (
    <>
      <h1 className="page-title">Usuarios</h1>

      {credentials && <CredentialsCard credentials={credentials} />}

      <form className="panel" onSubmit={handleSubmit} style={{ marginTop: credentials ? '1rem' : 0 }}>
        <p className="panel__label">Nuevo usuario</p>
        {error && (
          <p className="alert" role="alert">
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
            placeholder="Carolina"
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
            placeholder="carolina@gmail.com"
          />
        </label>
        <label className="field">
          <span className="field__label">Rol</span>
          <select
            className="field__input"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="seller">Corista</option>
            <option value="door">Puerta</option>
            <option value="admin">Direccion</option>
          </select>
        </label>
        <button className="button" type="submit" disabled={createUser.isPending}>
          {createUser.isPending ? 'Creando...' : 'Crear usuario'}
        </button>
      </form>

      <div className="panel">
        <p className="panel__label">Equipo</p>
        {isPending ? (
          <p className="muted">Cargando...</p>
        ) : (
          <ul className="list">
            {data?.users.map((user) => <TeamRow key={user.id} user={user} selfId={me?.id ?? 0} />)}
          </ul>
        )}
      </div>
    </>
  )
}
