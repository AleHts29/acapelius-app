import { describe, expect, it } from 'vitest'

import type { DoorTicket } from '../api/client'
import { filterTickets, groupByBuyer, normalizeText } from './search'

const tickets: DoorTicket[] = [
  { code: 'T1', status: 'issued', buyer_name: 'María Dutra', seller_name: 'Carolina', is_comp: false },
  { code: 'T2', status: 'issued', buyer_name: 'María Dutra', seller_name: 'Carolina', is_comp: false },
  { code: 'T3', status: 'checked_in', buyer_name: 'Pedro Gómez', seller_name: 'Valeria', is_comp: false },
  { code: 'T4', status: 'issued', buyer_name: 'Invitado de Eli', seller_name: 'Eli', is_comp: true },
]

describe('normalizeText', () => {
  it('ignora mayusculas y tildes', () => {
    expect(normalizeText('  María GÓMEZ ')).toBe('maria gomez')
    expect(normalizeText('Ñoño')).toBe('ñoño'.normalize('NFD').replace(/\p{Diacritic}/gu, ''))
  })
})

describe('filterTickets', () => {
  it('encuentra por nombre de compradora sin tildes', () => {
    const found = filterTickets(tickets, 'maria')
    expect(found.map((t) => t.code)).toEqual(['T1', 'T2'])
  })

  it('encuentra por vendedora', () => {
    expect(filterTickets(tickets, 'valeria').map((t) => t.code)).toEqual(['T3'])
  })

  it('combina comprador y vendedora ("maria carolina")', () => {
    expect(filterTickets(tickets, 'maria carolina').map((t) => t.code)).toEqual(['T1', 'T2'])
    expect(filterTickets(tickets, 'maria valeria')).toEqual([])
  })

  it('consulta vacia no lista nada (no inundar la pantalla)', () => {
    expect(filterTickets(tickets, '')).toEqual([])
    expect(filterTickets(tickets, '   ')).toEqual([])
  })

  it('busca por partes del nombre', () => {
    expect(filterTickets(tickets, 'gom').map((t) => t.code)).toEqual(['T3'])
  })
})

describe('groupByBuyer (búsqueda de la puerta)', () => {
  const compra = (n: number, estado: DoorTicket['status'], saleId = 10): DoorTicket => ({
    code: `C${n}`,
    status: estado,
    sale_id: saleId,
    buyer_name: 'Fran Sponton',
    seller_name: 'Alejandro',
    is_comp: false,
  })

  it('una compra de tres es una sola fila con su contador', () => {
    const grupos = groupByBuyer([compra(1, 'checked_in'), compra(2, 'issued'), compra(3, 'issued')])
    expect(grupos).toHaveLength(1)
    expect(grupos[0].total).toBe(3)
    expect(grupos[0].entered).toBe(1)
    expect(grupos[0].pending.map((t) => t.code)).toEqual(['C2', 'C3'])
  })

  it('dos compras del mismo comprador no se mezclan', () => {
    const grupos = groupByBuyer([compra(1, 'issued', 10), compra(2, 'issued', 11)])
    expect(grupos).toHaveLength(2)
  })

  it('una entrada anulada no cuenta como emitida ni como ingreso', () => {
    const grupos = groupByBuyer([compra(1, 'void'), compra(2, 'issued')])
    expect(grupos[0].total).toBe(1)
    expect(grupos[0].hasVoid).toBe(true)
    expect(grupos[0].pending.map((t) => t.code)).toEqual(['C2'])
  })

  it('sin sale_id (snapshot viejo guardado offline) agrupa por comprador y vendedora', () => {
    const viejo = tickets.map(({ code, status, buyer_name, seller_name, is_comp }) => ({
      code, status, buyer_name, seller_name, is_comp,
    }))
    const grupos = groupByBuyer(viejo)
    expect(grupos.map((g) => g.buyerName)).toEqual(['María Dutra', 'Pedro Gómez', 'Invitado de Eli'])
    expect(grupos[0].total).toBe(2)
  })
})
