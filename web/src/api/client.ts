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

export interface Season {
  id: number
  name: string
  is_active: boolean
  created_at: string
}

/** Una funcion (fecha del coro). "Function" a secas choca con el global de JS. */
export interface ShowFunction {
  id: number
  season_id: number
  name: string | null
  venue: string
  starts_at: string
  capacity: number
  price_cents: number
  created_at: string
}

export interface FunctionInput {
  season_id: number
  name: string
  venue: string
  starts_at: string
  capacity: number
  price_cents: number
}

export type PaymentStatus = 'pending' | 'paid'
export type PaymentMethod = 'cash' | 'transfer'
export type TicketStatus = 'issued' | 'checked_in' | 'void'
export type EmailStatus = 'sent' | 'failed' | 'none'

export interface Sale {
  id: number
  function_id: number
  seller_id: number
  code: string
  buyer_name: string
  buyer_email: string | null
  buyer_phone: string | null
  quantity: number
  amount_cents: number
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  is_comp: boolean
  notes: string | null
  voided_at: string | null
  created_at: string
}

export interface Ticket {
  id: number
  sale_id: number
  code: string
  status: TicketStatus
  created_at: string
}

/** Fila del listado de ventas, con los datos de la funcion y la vendedora. */
export interface SaleRow extends Sale {
  function_venue: string
  function_starts_at: string
  function_name: string | null
  seller_name: string
  active_tickets: number
}

export interface NewSaleInput {
  function_id: number
  buyer_name: string
  buyer_email?: string
  buyer_phone?: string
  quantity: number
  is_comp?: boolean
  notes?: string
}

export interface PublicTicket {
  code: string
  payload: string
  status: TicketStatus
}

export interface PublicSale {
  buyer_name: string
  seller_name: string
  quantity: number
  is_comp: boolean
  voided: boolean
  function: { name: string | null; venue: string; starts_at: string }
  tickets: PublicTicket[]
}

export interface DoorTicket {
  code: string
  status: TicketStatus
  buyer_name: string
  seller_name: string
  is_comp: boolean
}

export interface DoorCheckin {
  ticket_code: string
  created_at: string
  method: 'scan' | 'manual'
  by_name: string
}

export interface DoorSnapshot {
  function: {
    id: number
    name: string | null
    venue: string
    starts_at: string
    capacity: number
  }
  tickets: DoorTicket[]
  checkins: DoorCheckin[]
}

export type CheckinResult = 'ok' | 'already_checked_in' | 'invalid' | 'void' | 'wrong_function'

export interface CheckinResponse {
  result: CheckinResult
  buyer_name?: string
  seller_name?: string
  checked_in_at?: string
  by_name?: string
}

export type CheckinInput =
  | { function_id: number; method: 'scan'; payload: string; device_id?: string }
  | { function_id: number; method: 'manual'; code: string; device_id?: string }

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

  listSeasons: () => request<{ seasons: Season[] }>('GET', '/seasons'),
  createSeason: (name: string) => request<{ season: Season }>('POST', '/seasons', { name }),

  listFunctions: (seasonId?: number) =>
    request<{ functions: ShowFunction[] }>(
      'GET',
      seasonId === undefined ? '/functions' : `/functions?season_id=${seasonId}`,
    ),
  createFunction: (input: FunctionInput) =>
    request<{ function: ShowFunction }>('POST', '/functions', input),
  updateFunction: (id: number, input: Partial<Omit<FunctionInput, 'season_id'>>) =>
    request<{ function: ShowFunction }>('PATCH', `/functions/${id}`, input),

  createSale: (input: NewSaleInput) =>
    request<{ sale: Sale; tickets: Ticket[]; public_url: string; email_status: EmailStatus }>(
      'POST',
      '/sales',
      input,
    ),
  listSales: (opts?: { mine?: boolean; functionId?: number }) => {
    const params = new URLSearchParams()
    if (opts?.mine) params.set('mine', '1')
    if (opts?.functionId !== undefined) params.set('function_id', String(opts.functionId))
    const qs = params.toString()
    return request<{ sales: SaleRow[] }>('GET', qs ? `/sales?${qs}` : '/sales')
  },
  updateSalePayment: (id: number, status: PaymentStatus, method?: PaymentMethod) =>
    request<{ sale: Sale }>('PATCH', `/sales/${id}`, {
      payment_status: status,
      payment_method: method ?? '',
    }),
  resendSaleEmail: (id: number) =>
    request<{ email_status: EmailStatus }>('POST', `/sales/${id}/resend-email`),
  voidSale: (id: number) => request<{ sale: Sale }>('POST', `/sales/${id}/void`),

  publicSale: (code: string) => request<PublicSale>('GET', `/public/sales/${code}`),

  doorSnapshot: (functionId: number) =>
    request<DoorSnapshot>('GET', `/functions/${functionId}/door-snapshot`),
  checkin: (input: CheckinInput) => request<CheckinResponse>('POST', '/checkins', input),
}

/** Link publico de una venta, para compartir por WhatsApp. */
export function publicSaleURL(code: string): string {
  return `${window.location.origin}/e/${code}`
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
