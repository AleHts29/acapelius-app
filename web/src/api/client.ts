// Cliente HTTP de la API. Todo pasa por aca para que el manejo de errores y
// las cookies de sesion sean consistentes.

export type Role = 'admin' | 'seller' | 'door'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  must_change_password: boolean
  created_at: string
}

/** Codigos de error que el frontend discrimina. Ver internal/httpx/respond.go. */
export type ApiErrorCode =
  | 'bad_request'
  | 'validation_error'
  | 'invalid_credentials'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'password_change_required'
  | 'internal_error'
  | 'too_many_requests'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'network_error'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }

  /** Cierto cuando la sesion no sirve y hay que volver al login. */
  get isUnauthenticated(): boolean {
    return this.code === 'unauthenticated'
  }

  /** Cierto mientras el usuario arrastre una contrasena provisoria. */
  get needsPasswordChange(): boolean {
    return this.code === 'password_change_required'
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('network_error', 'No hay conexion con el servidor.', 0)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const envelope = payload as ErrorEnvelope | null
    throw new ApiError(
      (envelope?.error?.code as ApiErrorCode) ?? 'internal_error',
      envelope?.error?.message ?? 'Ocurrio un error inesperado.',
      response.status,
    )
  }

  return payload as T
}

export const api = {
  me: () => request<{ user: User }>('GET', '/me'),
  login: (email: string, password: string) =>
    request<{ user: User }>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ user: User }>('POST', '/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    }),
  listUsers: () => request<{ users: User[] }>('GET', '/users'),
  createUser: (input: { name: string; email: string; role: Role; password?: string }) =>
    request<{ user: User; temp_password?: string }>('POST', '/users', input),
}

/** Etiqueta de rol para mostrar en pantalla. */
export function roleLabel(role: Role): string {
  switch (role) {
    case 'admin':
      return 'Direccion'
    case 'seller':
      return 'Vendedora'
    case 'door':
      return 'Puerta'
  }
}
