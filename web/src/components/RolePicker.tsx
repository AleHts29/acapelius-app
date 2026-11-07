import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api, roleLabel } from '../api/client'
import type { CustomRole, Role } from '../api/client'
import { Button, Seg } from '../ui/Button'
import { Label } from '../ui/Label'

/** El rol elegido: uno de base, o uno propio con su rol de base. */
export interface RolElegido {
  role: Role
  custom_role_id: number | null
}

const BASES: Role[] = ['seller', 'door', 'admin']
const clave = (r: RolElegido) => (r.custom_role_id ? `c${r.custom_role_id}` : r.role)

/**
 * El selector de rol de Equipo (C21): los tres de base más los propios de la
 * organización, y "+ Nuevo rol" para crear uno con nombre y permisos de base.
 */
export function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: RolElegido
  onChange: (r: RolElegido) => void
  disabled?: boolean
}) {
  const queryClient = useQueryClient()
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.listRoles() })
  const propios: CustomRole[] = roles.data?.roles ?? []
  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [base, setBase] = useState<Role>('seller')
  const [error, setError] = useState<string | null>(null)

  const crear = useMutation({
    meta: { exito: 'Rol creado' },
    mutationFn: () => api.createRole({ name: nombre.trim(), base_role: base }),
    onSuccess: ({ role }) => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] })
      onChange({ role: role.base_role, custom_role_id: role.id })
      setCreando(false)
      setNombre('')
      setError(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo crear el rol.'),
  })

  const borrar = useMutation({
    meta: { exito: 'Rol eliminado' },
    mutationFn: (id: number) => api.deleteRole(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] })
      void queryClient.invalidateQueries({ queryKey: ['team'] })
      onChange({ role: value.role, custom_role_id: null })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo eliminar el rol.'),
  })

  const opciones = [
    ...BASES.map((r) => ({ value: r as string, label: roleLabel(r) })),
    ...propios.map((r) => ({ value: `c${r.id}`, label: r.name })),
  ]
  const elegido = propios.find((r) => r.id === value.custom_role_id)

  return (
    <div className="field">
      <Label>Rol</Label>
      <div className="rolepick">
        <Seg<string>
          label="Rol"
          value={clave(value)}
          disabled={disabled}
          options={opciones}
          onChange={(k) => {
            const propio = propios.find((r) => `c${r.id}` === k)
            onChange(propio ? { role: propio.base_role, custom_role_id: propio.id } : { role: k as Role, custom_role_id: null })
          }}
        />
        {!disabled && !creando && (
          <button type="button" className="rolepick__nuevo" onClick={() => setCreando(true)}>
            + Nuevo rol
          </button>
        )}
      </div>
      {elegido && (
        <p className="rs rolepick__nota">
          Tiene los permisos de {roleLabel(elegido.base_role)}.{' '}
          {!disabled && (
            <button type="button" className="rolepick__borrar" disabled={borrar.isPending} onClick={() => borrar.mutate(elegido.id)}>
              Eliminar este rol
            </button>
          )}
        </p>
      )}
      {creando && (
        <div className="rolepick__form">
          <input
            className="field__input"
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre del rol (ej. Acomodador)"
            aria-label="Nombre del rol nuevo"
            maxLength={40}
            autoFocus
          />
          <span className="lbl">Con los permisos de</span>
          <Seg<Role> label="Permisos del rol nuevo" value={base} onChange={setBase} options={BASES.map((r) => ({ value: r, label: roleLabel(r) }))} />
          <div className="rolepick__acciones">
            <Button onClick={() => { setCreando(false); setError(null) }}>Cancelar</Button>
            <Button go disabled={nombre.trim() === '' || crear.isPending} onClick={() => crear.mutate()}>
              {crear.isPending ? 'Creando…' : 'Crear rol'}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
