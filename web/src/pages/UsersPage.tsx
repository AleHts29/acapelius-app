import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, roleLabel } from '../api/client'
import type { Role } from '../api/client'

interface CreatedCredentials {
  name: string
  email: string
  tempPassword: string
}

export function UsersPage() {
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

      {credentials && (
        <div className="panel panel--success">
          <p className="panel__label">Credenciales de {credentials.name}</p>
          <p className="credentials">
            {credentials.email}
            <br />
            <strong>{credentials.tempPassword}</strong>
          </p>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Pasasela por WhatsApp: no se vuelve a mostrar. Al entrar tiene que elegir la suya.
          </p>
        </div>
      )}

      <form className="panel" onSubmit={handleSubmit}>
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
            <option value="seller">Vendedora</option>
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
            {data?.users.map((user) => (
              <li key={user.id} className="list__item list__item--static">
                <span>
                  {user.name}
                  <br />
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {user.email}
                    {user.must_change_password && ' · todavia no entro'}
                  </span>
                </span>
                <span className="badge">{roleLabel(user.role)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
