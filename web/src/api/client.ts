// Cliente HTTP de la API. Todo pasa por aca para que el manejo de errores y
// las cookies de sesion sean consistentes.

export type Role = 'admin' | 'seller' | 'door'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  must_change_password: boolean
  is_active: boolean
  created_at: string
  /** null = nunca entró: la invitación sigue pendiente (C7). */
  last_login_at: string | null
}

/** Respuesta del alta, del reenvío de invitación y del reseteo (C7). */
export interface UserAccessResponse {
  user: User
  temp_password?: string
  email_status: 'sent' | 'failed' | 'none'
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
  | 'no_allocation'
  | 'allocation_exceeded'
  | 'allocation_below_sold'
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
  /** Entradas vivas emitidas (para barras de progreso). */
  sold: number
  /** Ingresos ya registrados. Con al menos uno, la función queda congelada. */
  entered: number
  /** Cupo ya repartido entre coristas. La diferencia con capacity es lo que falta. */
  assigned: number
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
  /** Lo ya cobrado. La diferencia con amount_cents es lo que se debe. */
  paid_cents: number
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

/** Fila del listado de ventas (C3), con funcion, corista y ultimo envio. */
export interface SaleListItem {
  id: number
  code: string
  buyer_name: string
  buyer_email: string | null
  quantity: number
  amount_cents: number
  /** Lo ya cobrado. La diferencia con amount_cents es lo que se debe. */
  paid_cents: number
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  is_comp: boolean
  voided_at: string | null
  created_at: string
  function_id: number
  function_venue: string
  function_starts_at: string
  function_name: string | null
  seller_name: string
  last_email_at: string | null
}

export interface SalesSummary {
  tickets_sold: number
  paid_cents: number
  pending_cents: number
  total_count: number
  pending_count: number
}

export type SaleStatusFilter = 'pending' | 'paid' | 'comp'

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
  /** Agrupa las entradas de una misma compra. Puede faltar en un snapshot
   * guardado por una versión anterior de la app: ahí se agrupa por nombre. */
  sale_id?: number
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

/** Un cobro de una venta: total o parcial. */
export interface SalePayment {
  id: number
  sale_id: number
  amount_cents: number
  method: PaymentMethod
  created_at: string
  /** Quién lo registró. */
  by_name: string
}

export interface SalePayments {
  sale: Sale
  payments: SalePayment[]
}

export type CheckinResult = 'ok' | 'already_checked_in' | 'invalid' | 'void' | 'wrong_function'

export interface CheckinResponse {
  result: CheckinResult
  buyer_name?: string
  seller_name?: string
  checked_in_at?: string
  by_name?: string
}

export interface PublicSingleTicket {
  code: string
  status: TicketStatus
  buyer_name: string
  seller_name: string
  is_comp: boolean
  voided: boolean
  ticket_index: number
  sale_quantity: number
  payload?: string
  function: { name: string | null; venue: string; starts_at: string }
}

/** Cupo de la corista logueada en una funcion (C8). */
export interface MyAllocation {
  function_id: number
  function_name: string | null
  venue: string
  starts_at: string
  assigned: number
  sold: number
  remaining: number
}

/** Fila del tablero de asignacion de una funcion (C8, admin). */
export interface AllocationBoardRow {
  user_id: number
  seller_name: string
  assigned: number
  sold: number
}

export type CheckinInput =
  | { function_id: number; method: 'scan'; payload: string; device_id?: string }
  | { function_id: number; method: 'manual'; code: string; device_id?: string }

export interface SalesReportRow {
  function_id: number
  function_venue: string
  function_starts_at: string
  function_name: string | null
  seller_id: number
  seller_name: string
  tickets_sold: number
  comp_tickets: number
  paid_cents: number
  pending_cents: number
}

export interface SettlementReportRow {
  seller_id: number
  seller_name: string
  collected_cents: number
  pending_cents: number
  settled_cents: number
  balance_cents: number
}

export interface Settlement {
  id: number
  seller_id: number
  season_id: number
  amount_cents: number
  method: PaymentMethod
  notes: string | null
  created_at: string
  seller_name: string
}

/**
 * Alerta del panel de Dirección (C9). El server decide cuáles hay y con qué
 * datos; el texto, el ícono y el destino los pone la UI.
 */
export type AlertKind = 'settlement' | 'allocation' | 'invite'

export interface Alert {
  kind: AlertKind
  name: string
  /** settlement */
  seller_id?: number
  amount_cents?: number
  /** allocation */
  function_id?: number
  missing?: number
  capacity?: number
  starts_at?: string
  /** invite */
  user_id?: number
  role?: Role
  /** Referencia temporal del pendiente: último cobro o alta. */
  since?: string
}

/** Una función con su avance de venta, lo recaudado y lo asignado (C9). */
export interface FunctionSummary {
  id: number
  name: string | null
  venue: string
  starts_at: string
  capacity: number
  price_cents: number
  sold: number
  collected_cents: number
  assigned: number
  entered: number
}

export interface SalesTimeline {
  days: Array<{ day: string; tickets: number }>
  /** Entradas de la última semana menos las de la anterior. */
  delta: number
  total: number
}

export interface AttendanceCheckin {
  at: string
  method: 'scan' | 'manual'
  by_name: string
}

export interface AttendanceTicket {
  ticket_id: number
  checkin: AttendanceCheckin | null
}

/** Una fila por comprador (C6): sus entradas y el estado de cada una. */
export interface AttendanceSale {
  sale_id: number
  buyer_name: string
  seller_name: string
  is_comp: boolean
  total: number
  entered: number
  last_checkin_at: string | null
  last_method: 'scan' | 'manual' | null
  tickets: AttendanceTicket[]
}

export interface AttendanceReport {
  function: {
    id: number
    name: string | null
    venue: string
    starts_at: string
    capacity: number
  }
  issued: number
  entered: number
  buyers_total: number
  buyers_complete: number
  sales: AttendanceSale[]
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
    request<UserAccessResponse>('POST', '/users', input),
  updateUser: (
    id: number,
    input: { name: string; email: string; role: Role; is_active: boolean },
  ) => request<{ user: User }>('PATCH', `/users/${id}`, input),
  resendInvite: (id: number) => request<UserAccessResponse>('POST', `/users/${id}/resend-invite`),
  resetPassword: (id: number) => request<UserAccessResponse>('POST', `/users/${id}/reset-password`),

  listSeasons: () => request<{ seasons: Season[] }>('GET', '/seasons'),
  createSeason: (name: string) => request<{ season: Season }>('POST', '/seasons', { name }),
  activateSeason: (id: number) => request<{ season: Season }>('POST', `/seasons/${id}/activate`),

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
  listSales: (opts?: {
    mine?: boolean
    functionId?: number
    q?: string
    status?: SaleStatusFilter
    cursor?: string
  }) => {
    const params = new URLSearchParams()
    if (opts?.mine) params.set('mine', '1')
    if (opts?.functionId !== undefined) params.set('function_id', String(opts.functionId))
    if (opts?.q) params.set('q', opts.q)
    if (opts?.status) params.set('status', opts.status)
    if (opts?.cursor) params.set('cursor', opts.cursor)
    const qs = params.toString()
    return request<{ sales: SaleListItem[]; summary: SalesSummary; next_cursor?: string }>(
      'GET',
      qs ? `/sales?${qs}` : '/sales',
    )
  },
  updateSalePayment: (id: number, status: PaymentStatus, method?: PaymentMethod) =>
    request<{ sale: Sale }>('PATCH', `/sales/${id}`, {
      payment_status: status,
      payment_method: method ?? '',
    }),
  salePayments: (id: number) => request<SalePayments>('GET', `/sales/${id}/payments`),
  addSalePayment: (id: number, amountCents: number, method: PaymentMethod) =>
    request<SalePayments>('POST', `/sales/${id}/payments`, {
      amount_cents: amountCents,
      method,
    }),
  deleteSalePayment: (id: number, paymentId: number) =>
    request<SalePayments>('DELETE', `/sales/${id}/payments/${paymentId}`),
  resendSaleEmail: (id: number) =>
    request<{ email_status: EmailStatus }>('POST', `/sales/${id}/resend-email`),
  voidSale: (id: number) => request<{ sale: Sale }>('POST', `/sales/${id}/void`),

  publicSale: (code: string) => request<PublicSale>('GET', `/public/sales/${code}`),
  publicTicket: (code: string) => request<PublicSingleTicket>('GET', `/public/tickets/${code}`),

  myAllocations: () => request<{ allocations: MyAllocation[] }>('GET', '/me/allocations'),
  functionAllocations: (functionId: number) =>
    request<{ capacity: number; total_assigned: number; allocations: AllocationBoardRow[] }>(
      'GET',
      `/functions/${functionId}/allocations`,
    ),
  putAllocations: (functionId: number, entries: Array<{ user_id: number; quantity: number }>) =>
    request<{ total_assigned: number; remaining: number }>(
      'PUT',
      `/functions/${functionId}/allocations`,
      { allocations: entries },
    ),

  doorSnapshot: (functionId: number) =>
    request<DoorSnapshot>('GET', `/functions/${functionId}/door-snapshot`),
  checkin: (input: CheckinInput) => request<CheckinResponse>('POST', '/checkins', input),
  syncCheckins: (input: {
    function_id: number
    device_id: string
    checkins: Array<{ payload?: string; code?: string; method: 'scan' | 'manual'; at: string }>
  }) => request<{ results: CheckinResponse[] }>('POST', '/checkins/sync', input),

  salesReport: (opts?: { functionId?: number; sellerId?: number }) => {
    const params = new URLSearchParams()
    if (opts?.functionId !== undefined) params.set('function_id', String(opts.functionId))
    if (opts?.sellerId !== undefined) params.set('seller_id', String(opts.sellerId))
    const qs = params.toString()
    return request<{ rows: SalesReportRow[] }>('GET', qs ? `/reports/sales?${qs}` : '/reports/sales')
  },
  settlementsReport: (seasonId: number) =>
    request<{ rows: SettlementReportRow[]; settlements: Settlement[] }>(
      'GET',
      `/reports/settlements?season_id=${seasonId}`,
    ),
  attention: (seasonId: number) =>
    request<{ alerts: Alert[] }>('GET', `/reports/attention?season_id=${seasonId}`),
  functionsSummary: (seasonId: number) =>
    request<{ functions: FunctionSummary[] }>(
      'GET',
      `/reports/functions-summary?season_id=${seasonId}`,
    ),
  salesTimeline: (seasonId: number, days = 14) =>
    request<SalesTimeline>('GET', `/reports/sales-timeline?season_id=${seasonId}&days=${days}`),
  listSettlements: (seasonId: number, sellerId?: number) =>
    request<{ settlements: Settlement[] }>(
      'GET',
      `/settlements?season_id=${seasonId}${sellerId !== undefined ? `&seller_id=${sellerId}` : ''}`,
    ),
  createSettlement: (input: {
    seller_id: number
    season_id: number
    amount_cents: number
    method: PaymentMethod
    notes?: string
  }) => request<{ settlement: Settlement }>('POST', '/settlements', input),
  attendanceReport: (functionId: number) =>
    request<AttendanceReport>('GET', `/reports/attendance?function_id=${functionId}`),
}

/**
 * La temporada en curso. Hay una sola marcada activa (el backend lo garantiza
 * al crear y al activar); el fallback a la primera es por si alguna base vieja
 * quedo sin ninguna. Toda pantalla que necesite "la temporada" sale de aca:
 * antes tomaban `seasons[0]` — la mas nueva — y crear una temporada nueva
 * dejaba Rendiciones en cero con plata sin rendir.
 */
export function activeSeason(seasons: Season[] | undefined): Season | undefined {
  if (!seasons || seasons.length === 0) return undefined
  return seasons.find((s) => s.is_active) ?? seasons[0]
}

/** Link publico de una venta, para compartir por WhatsApp. */
export function publicSaleURL(code: string): string {
  return `${window.location.origin}/e/${code}`
}

/** Link publico de UNA entrada, para reenviarle a cada persona la suya. */
export function publicTicketURL(code: string): string {
  return `${window.location.origin}/t/${code}`
}

/** Compartir con la hoja nativa del celular; si no hay, copia al portapapeles. */
export async function shareOrCopy(text: string, url: string): Promise<'shared' | 'copied' | 'failed'> {
  if (navigator.share) {
    try {
      await navigator.share({ text, url })
      return 'shared'
    } catch {
      // Cancelado por el usuario o sin permiso: probamos copiar.
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`.trim())
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** Etiqueta de rol para mostrar en pantalla. */
export function roleLabel(role: Role): string {
  switch (role) {
    case 'admin':
      return 'Dirección'
    case 'seller':
      return 'Corista'
    case 'door':
      return 'Puerta'
  }
}
