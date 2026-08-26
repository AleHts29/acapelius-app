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
