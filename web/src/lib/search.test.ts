import { describe, expect, it } from 'vitest'

import type { DoorTicket } from '../api/client'
import { filterTickets, normalizeText } from './search'

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
