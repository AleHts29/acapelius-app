// Busqueda del modo puerta: "soy Maria Dutra, le compre a Carolina" se busca
// por nombre de compradora o de vendedora, sin que las tildes molesten.

import type { DoorTicket } from '../api/client'

/** Minusculas y sin diacriticos: "María" y "maria" son lo mismo. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
}

/** Iniciales para el avatar de una fila ("María Dutra" → "MD"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/**
 * Filtra tickets por comprador o vendedora. Todas las palabras de la consulta
 * tienen que aparecer en alguno de los dos nombres.
 */
export function filterTickets(tickets: DoorTicket[], query: string): DoorTicket[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  return tickets.filter((ticket) => {
    const haystack = `${normalizeText(ticket.buyer_name)} ${normalizeText(ticket.seller_name)}`
    return words.every((word) => haystack.includes(word))
  })
}

/** Una compra en la búsqueda de la puerta: sus entradas y cuántas entraron. */
export interface BuyerGroup {
  key: string
  buyerName: string
  sellerName: string
  isComp: boolean
  total: number
  entered: number
  /** Entradas que todavía no ingresaron, en orden. */
  pending: DoorTicket[]
  /** Alguna de sus entradas está anulada. */
  hasVoid: boolean
}

/**
 * Agrupa por compra. Un comprador con tres entradas aparecía como tres
 * renglones idénticos, sin forma de saber cuál era cuál: marcabas uno, se
 * cerraba la hoja y volvías a encontrar dos filas iguales. Ahora es una fila
 * con su contador.
 *
 * La clave es el sale_id; si el snapshot es de una versión anterior y no lo
 * trae, se cae al par comprador+vendedora, que alcanza para la puerta.
 */
export function groupByBuyer(tickets: DoorTicket[]): BuyerGroup[] {
  const groups = new Map<string, BuyerGroup>()
  for (const ticket of tickets) {
    const key =
      ticket.sale_id !== undefined
        ? `s${ticket.sale_id}`
        : `n${normalizeText(ticket.buyer_name)}|${normalizeText(ticket.seller_name)}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        buyerName: ticket.buyer_name,
        sellerName: ticket.seller_name,
        isComp: ticket.is_comp,
        total: 0,
        entered: 0,
        pending: [],
        hasVoid: false,
      }
      groups.set(key, group)
    }
    if (ticket.status === 'void') {
      group.hasVoid = true
      continue // una entrada anulada no cuenta ni como emitida ni como ingreso
    }
    group.total += 1
    if (ticket.status === 'checked_in') group.entered += 1
    else group.pending.push(ticket)
  }
  return [...groups.values()].filter((g) => g.total > 0)
}
