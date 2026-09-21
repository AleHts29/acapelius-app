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

/** Una persona en una temporada: quién es, qué rol tiene ESTA temporada y qué
 *  hizo en ella. */
export interface TeamMember {
  id: number
  name: string
  email: string
  role: Role
  joined_at: string
  /** Con fecha: dejó el coro a mitad de temporada. */
  left_at: string | null
  last_login_at: string | null
  tickets_sold: number
  assigned: number
  /** Lo cobrado menos lo rendido: lo que todavía tiene en la mano. */
  balance_cents: number
  checkins: number
  /** Cuántas temporadas lleva, contando ésta. */
  seasons: number
}

/** Alguien que participó antes pero no de esta temporada. */
export interface FormerMember {
  id: number
  name: string
  email: string
  last_login_at: string | null
  last_season_name: string
  last_role: Role
  last_tickets_sold: number
}

export interface TeamResponse {
  members: TeamMember[]
  former: FormerMember[]
  summary: {
    active: number
    pending: number
    left_choir: number
    total: number
    tickets_sold: number
    balance_cents: number
  }
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
  /** Cortesías emitidas: butacas ocupadas que no pagaron. */
  comp_tickets: number
  /** Coristas que vendieron algo para esta función. */
  sellers: number
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
  seller_id: number
  seller_name: string
  last_email_at: string | null
  /** Estado de entrega: `sent` llegó al proveedor, `failed` no salió,
   *  `none` la venta no tiene email. "Abierta" no existe: sin webhook de
   *  Resend la app no puede saberlo (spec C15 §4.2). */
  delivery: 'sent' | 'failed' | 'none'
  /** Cuántas de sus entradas ya ingresaron por la puerta. */
  entered: number
}

export interface SalesSummary {
  tickets_sold: number
  paid_cents: number
  pending_cents: number
  comp_tickets: number
  total_count: number
  pending_count: number
  paid_count: number
  comp_count: number
}

/** El mismo resumen pero con el filtro de estado aplicado. */
export interface SalesFilteredSummary {
  tickets_sold: number
  paid_cents: number
  pending_cents: number
  comp_tickets: number
  total_count: number
}

/** Subtotales del encabezado de un bloque de función. */
export interface SalesFunctionTotals {
  function_id: number
  sales: number
  tickets: number
  paid_cents: number
  pending_cents: number
}

export type SaleStatusFilter = 'pending' | 'paid' | 'comp' | 'void'

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
  collected_cents?: number
  settled_cents?: number
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

/** Una temporada con su resultado, para el índice de Temporadas. */
export interface SeasonOverview {
  id: number
  name: string
  is_active: boolean
  created_at: string
  functions: number
  capacity: number
  sold: number
  collected_cents: number
  assigned: number
  /** Coristas que efectivamente vendieron algo en la temporada. */
  sellers: number
  /** null cuando la temporada todavía no tiene funciones. */
  first_at: string | null
  last_at: string | null
  /** La próxima función que no pasó, o null si ya pasaron todas. */
  next_at: string | null
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
  home: (seasonId?: number) =>
    request<Home>('GET', seasonId === undefined ? '/home' : `/home?season_id=${seasonId}`),
  login: (email: string, password: string) =>
    request<{ user: User }>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ user: User }>('POST', '/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    }),
  /** El equipo de una temporada. Sin id, el de la que está en curso. */
  team: (seasonId?: number) =>
    request<TeamResponse>('GET', seasonId === undefined ? '/users' : `/users?season_id=${seasonId}`),
  addMember: (seasonId: number, userId: number, role: Role) =>
    request<{ member: unknown }>('POST', `/seasons/${seasonId}/members`, {
      user_id: userId,
      role,
    }),
  removeMember: (seasonId: number, userId: number) =>
    request<void>('DELETE', `/seasons/${seasonId}/members/${userId}`),
  createUser: (input: { name: string; email: string; role: Role; password?: string }) =>
    request<UserAccessResponse>('POST', '/users', input),
  updateUser: (
    id: number,
    input: { name: string; email: string; role: Role; is_active: boolean },
  ) => request<{ user: User }>('PATCH', `/users/${id}`, input),
  resendInvite: (id: number) => request<UserAccessResponse>('POST', `/users/${id}/resend-invite`),
  resetPassword: (id: number) => request<UserAccessResponse>('POST', `/users/${id}/reset-password`),

  listSeasons: () => request<{ seasons: Season[] }>('GET', '/seasons'),
  createSeason: (input: {
    name: string
    /** Si pasa a ser la temporada en curso. Por omisión sí. */
    activate?: boolean
    /** Copia la grilla de otra temporada con las fechas corridas un año. */
    copy_from_season_id?: number
    /** Si el equipo de esa temporada pasa también. Por omisión sí. */
    copy_members?: boolean
    /** El equipo elegido en el asistente. Manda sobre copy_members. */
    members?: Array<{ user_id: number; role: Role }>
  }) => request<{ season: Season; copied?: number }>('POST', '/seasons', input),
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
  deleteFunction: (id: number) => request<void>('DELETE', `/functions/${id}`),

  createSale: (input: NewSaleInput) =>
    request<{ sale: Sale; tickets: Ticket[]; public_url: string; email_status: EmailStatus }>(
      'POST',
      '/sales',
      input,
    ),
  listSales: (opts?: SalesQuery & { cursor?: string }) => {
    const params = salesParams(opts)
    if (opts?.cursor) params.set('cursor', opts.cursor)
    const qs = params.toString()
    return request<{
      sales: SaleListItem[]
      summary: SalesSummary
      filtered: SalesFilteredSummary
      function_totals: SalesFunctionTotals[]
      next_cursor?: string
    }>('GET', qs ? `/sales?${qs}` : '/sales')
  },
  sellersWithSales: (opts?: { seasonId?: number; functionId?: number }) => {
    const params = new URLSearchParams()
    if (opts?.seasonId !== undefined) params.set('season_id', String(opts.seasonId))
    if (opts?.functionId !== undefined) params.set('function_id', String(opts.functionId))
    const qs = params.toString()
    return request<{ sellers: Array<{ id: number; name: string; sales: number }> }>(
      'GET',
      qs ? `/reports/sellers?${qs}` : '/reports/sellers',
    )
  },
  bulkPayment: (saleIds: number[], method: PaymentMethod) =>
    request<{ charged: number; skipped: number; amount_cents: number }>(
      'POST',
      '/sales/bulk-payment',
      { sale_ids: saleIds, method },
    ),
  bulkResend: (saleIds: number[]) =>
    request<{ sent: number; failed: number; no_email: number }>('POST', '/sales/bulk-resend', {
      sale_ids: saleIds,
    }),
  /** URL del CSV. Se abre en una pestaña: el navegador maneja la descarga. */
  salesExportURL: (opts?: SalesQuery & { ids?: number[] }) => {
    const params = salesParams(opts)
    if (opts?.ids && opts.ids.length > 0) params.set('ids', opts.ids.join(','))
    const qs = params.toString()
    return `/api/sales/export${qs ? `?${qs}` : ''}`
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

  settlementsReport: (seasonId: number) =>
    request<{ rows: SettlementReportRow[]; settlements: Settlement[] }>(
      'GET',
      `/reports/settlements?season_id=${seasonId}`,
    ),
  direccion: (seasonId: number) =>
    request<Direccion>('GET', `/reports/direccion?season_id=${seasonId}`),
  attention: (seasonId: number) =>
    request<{ alerts: Alert[] }>('GET', `/reports/attention?season_id=${seasonId}`),
  seasonsOverview: () => request<{ seasons: SeasonOverview[] }>('GET', '/reports/seasons'),
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
  sellerDetail: (sellerId: number, seasonId: number) =>
    request<SellerDetail>('GET', `/settlements/${sellerId}/detail?season_id=${seasonId}`),
  remindSeller: (sellerId: number, seasonId: number) =>
    request<{ email_status: EmailStatus }>(
      'POST',
      `/settlements/${sellerId}/remind?season_id=${seasonId}`,
    ),
  remindAll: (seasonId: number) =>
    request<{ sent: number; failed: number }>('POST', `/settlements/remind-all?season_id=${seasonId}`),
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

/* ===== Detalle de rendición de una corista ============================== */

/** Una venta cobrada que todavía no se rindió: de ahí sale la deuda. */
export interface DebtSource {
  sale_id: number
  buyer_name: string
  function_name: string
  quantity: number
  paid_cents: number
  paid_at: string | null
}

export interface TimelineItem {
  kind: 'settlement' | 'reminder' | 'first_paid' | 'last_paid'
  at: string
  amount_cents?: number
  method?: PaymentMethod
  notes?: string
  detail?: string
}

export interface SellerDetail {
  seller_id: number
  seller_name: string
  email: string
  collected_cents: number
  settled_cents: number
  balance_cents: number
  uncollected_cents: number
  tickets_sold: number
  paid_sales: number
  first_paid_at: string | null
  last_paid_at: string | null
  last_reminder_at: string | null
  debt_sources: DebtSource[]
  timeline: TimelineItem[]
}

/* ===== Dirección minimalista =========================================== */

export interface DireccionMoney {
  sold_cents: number
  in_hand_cents: number
  unsettled_cents: number
  uncollected_cents: number
  sellers_owing: number
  sales_uncollected: number
}

export interface DireccionFunction {
  id: number
  name: string | null
  venue: string
  starts_at: string
  capacity: number
  sold: number
  entered: number
  collected_cents: number
  comp_tickets: number
  assigned: number
  price_cents: number
  occupancy_pct: number
  /** -1 = todavía no pasó: no hay asistencia que mostrar. */
  attendance_pct: number
  ticket_avg_cents: number
  done: boolean
}

/** Una conclusión de "lo que hay que mirar". El texto lo arma el server. */
export interface DireccionFinding {
  kind: 'attendance' | 'unassigned' | 'comps'
  value: string
  suffix?: string
  tone: 'danger' | 'warn' | 'indigo'
  body: string
  link_label: string
  function_id?: number
}

export interface Direccion {
  money: DireccionMoney
  functions: DireccionFunction[]
  totals: DireccionFunction
  findings: DireccionFinding[]
  in_sale: DireccionFunction | null
}

/* ===== Home por rol (C12) ================================================ */

export interface HomeFunction {
  id: number
  name: string | null
  venue: string
  starts_at: string
  capacity: number
  sold: number
  entered: number
  collected_cents: number
  assigned: number
  /** Sólo con rol corista. */
  my_assigned: number
  my_sold: number
  my_collected_cents: number
  no_allocation: boolean
}

export interface HomeSale {
  id: number
  buyer_name: string
  seller_name: string
  function_name: string
  quantity: number
  amount_cents: number
  paid_cents: number
  is_comp: boolean
  created_at: string
}

/** Una fila de "te falta cobrar" (corista). */
export interface HomeToDo {
  sale_id: number
  code: string
  buyer_name: string
  quantity: number
  balance_cents: number
  has_email: boolean
  created_at: string
}

export interface Home {
  role: Role
  name: string
  season: Season | null
  next_function: HomeFunction | null
  functions: HomeFunction[]
  alerts: Alert[]
  alert_total: number
  todo: HomeToDo[]
  todo_total: number
  last_sales: HomeSale[]
  badges: { sales_pending: number; settlements_pending: number }
  /** Solo para la corista: lo que cobró y todavía no entregó. */
  my_settlement?: MySettlement
}

/** Lo que una corista tiene que rendir, del mismo cálculo que usa Plata. */
export interface MySettlement {
  collected_cents: number
  settled_cents: number
  balance_cents: number
  /** Ventas que efectivamente cobró: es lo que hace entendible el monto. */
  sales: number
}

/**
 * La temporada en curso. Hay una sola marcada activa (el backend lo garantiza
 * al crear y al activar); el fallback a la primera es por si alguna base vieja
 * quedo sin ninguna. Toda pantalla que necesite "la temporada" sale de aca:
 * antes tomaban `seasons[0]` — la mas nueva — y crear una temporada nueva
 * dejaba Rendiciones en cero con plata sin rendir.
 */
/** Los filtros del listado de ventas, compartidos por la lista y el export. */
export interface SalesQuery {
  /** La temporada que se está mirando. Sin esto el listado mezcla años. */
  seasonId?: number
  mine?: boolean
  functionId?: number
  sellerId?: number
  q?: string
  status?: SaleStatusFilter
}

function salesParams(opts?: SalesQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (opts?.seasonId !== undefined) params.set('season_id', String(opts.seasonId))
  if (opts?.mine) params.set('mine', '1')
  if (opts?.functionId !== undefined) params.set('function_id', String(opts.functionId))
  if (opts?.sellerId !== undefined) params.set('seller_id', String(opts.sellerId))
  if (opts?.q) params.set('q', opts.q)
  if (opts?.status) params.set('status', opts.status)
  return params
}

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
