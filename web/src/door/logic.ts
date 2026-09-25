// Logica pura del modo puerta offline (spec §6.2): la validacion local de un
// escaneo contra el snapshot + la cola. Sin IndexedDB ni red, para poder
// testearla directo.

import type { CheckinResponse, DoorCheckin, DoorSnapshot, DoorTicket } from '../api/client'
import type { QueuedCheckin } from './db'

/**
 * Extrae el codigo del ticket de un payload de QR (`{code}.{firma}`). La
 * firma la verifica el server al sincronizar; localmente alcanza con que el
 * codigo exista en el snapshot (spec §6.2).
 */
export function codeFromPayload(payload: string): string {
  const dot = payload.indexOf('.')
  return dot > 0 ? payload.slice(0, dot) : ''
}

/**
 * Valida un check-in contra el snapshot y la cola local, y devuelve el mismo
 * shape que responde el server online, para que la pantalla verde/rojo no
 * distinga de donde salio el veredicto.
 *
 * Un codigo que no esta en el snapshot es `invalid`: puede ser un QR trucho o
 * una entrada de otra funcion — sin conexion no se distinguen, y ambos son
 * rojo igual.
 */
export function validateLocally(
  snapshot: DoorSnapshot,
  pending: QueuedCheckin[],
  code: string,
): CheckinResponse {
  if (code === '') return { result: 'invalid' }

  const ticket = snapshot.tickets.find((t) => t.code === code)
  if (!ticket) return { result: 'invalid' }

  const base = { code, buyer_name: ticket.buyer_name, seller_name: ticket.seller_name }

  if (ticket.status === 'void') {
    return { result: 'void', ...base }
  }

  // ¿Ya entro? Primero el registro del server, despues la cola local.
  const serverCheckin = snapshot.checkins.find((c) => c.ticket_code === code)
  if (serverCheckin || ticket.status === 'checked_in') {
    return {
      result: 'already_checked_in',
      ...base,
      checked_in_at: serverCheckin?.created_at,
      by_name: serverCheckin?.by_name ?? 'otro dispositivo',
    }
  }

  const queued = pending.find((q) => q.code === code)
  if (queued) {
    return {
      result: 'already_checked_in',
      ...base,
      checked_in_at: queued.at,
      by_name: 'este dispositivo',
    }
  }

  return { result: 'ok', ...base, checked_in_at: new Date().toISOString() }
}

/** Codigos que este dispositivo ya marco (server + cola local). */
export function enteredCodes(snapshot: DoorSnapshot, pending: QueuedCheckin[]): Set<string> {
  const codes = new Set<string>()
  for (const t of snapshot.tickets) {
    if (t.status === 'checked_in') codes.add(t.code)
  }
  for (const c of snapshot.checkins) codes.add(c.ticket_code)
  for (const q of pending) codes.add(q.code)
  return codes
}

/** Contador de la puerta: ingresados / emitidos, cola local incluida. */
export function doorCounter(
  snapshot: DoorSnapshot,
  pending: QueuedCheckin[],
): { entered: number; issued: number } {
  const issued = snapshot.tickets.filter((t) => t.status !== 'void').length
  return { entered: enteredCodes(snapshot, pending).size, issued }
}

/** Vista de tickets para la busqueda manual, con la cola local aplicada. */
export function effectiveTickets(snapshot: DoorSnapshot, pending: QueuedCheckin[]): DoorTicket[] {
  const pendingCodes = new Set(pending.map((q) => q.code))
  return snapshot.tickets.map((t) =>
    t.status === 'issued' && pendingCodes.has(t.code) ? { ...t, status: 'checked_in' } : t,
  )
}

/**
 * La lista de check-ins con los pendientes locales al final. Un ticket aparece
 * una sola vez: entre que la cola se sincroniza y el snapshot se refresca hay
 * un instante en que el mismo ingreso está en los dos lados, y en la mesa de
 * entrada eso se veía como dos filas iguales.
 */
export function effectiveCheckins(snapshot: DoorSnapshot, pending: QueuedCheckin[]): DoorCheckin[] {
  const yaEstan = new Set(snapshot.checkins.map((c) => c.ticket_code))
  const local: DoorCheckin[] = pending
    .filter((q) => !yaEstan.has(q.code))
    .map((q) => ({
      ticket_code: q.code,
      created_at: q.at,
      method: q.method,
      by_name: 'este dispositivo',
    }))
  return [...snapshot.checkins, ...local]
}

/**
 * Modo nocturno por defecto (AFICHE_APP_SPEC §6): sin preferencia guardada,
 * una funcion que empieza a las 19 o mas tarde arranca en nocturno. El papel
 * de dia encandila en una sala a oscuras.
 */
export function nocturnoPorDefecto(startsAt: string | undefined): boolean {
  if (!startsAt) return false
  return new Date(startsAt).getHours() >= 19
}
