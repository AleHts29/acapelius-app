import { describe, expect, it } from 'vitest'

import type { SaleRow } from '../api/client'
import { matchesFilter } from './SalesPage'

function sale(overrides: Partial<SaleRow>): SaleRow {
  return {
    id: 1,
    function_id: 1,
    seller_id: 1,
    code: 'X',
    buyer_name: 'Maria',
    buyer_email: null,
    buyer_phone: null,
    quantity: 1,
    amount_cents: 100,
    payment_status: 'pending',
    payment_method: null,
    is_comp: false,
    notes: null,
    voided_at: null,
    created_at: '2026-01-01T00:00:00Z',
    function_venue: 'Teatro',
    function_starts_at: '2026-12-01T00:00:00Z',
    function_name: null,
    seller_name: 'Carolina',
    active_tickets: 1,
    ...overrides,
  }
}

describe('matchesFilter (C2)', () => {
  const pendiente = sale({})
  const paga = sale({ payment_status: 'paid', payment_method: 'cash' })
  const cortesia = sale({ is_comp: true, amount_cents: 0 })
  const anulada = sale({ voided_at: '2026-01-02T00:00:00Z' })

  it('deben: solo pendientes vivas no-cortesía', () => {
    expect(matchesFilter(pendiente, 'deben')).toBe(true)
    expect(matchesFilter(paga, 'deben')).toBe(false)
    expect(matchesFilter(cortesia, 'deben')).toBe(false)
    expect(matchesFilter(anulada, 'deben')).toBe(false)
  })

  it('pagas y cortesías excluyen anuladas', () => {
    expect(matchesFilter(paga, 'pagas')).toBe(true)
    expect(matchesFilter(cortesia, 'cortesias')).toBe(true)
    expect(matchesFilter(sale({ is_comp: true, voided_at: 'x' }), 'cortesias')).toBe(false)
  })

  it('todas incluye todo, anuladas también', () => {
    for (const s of [pendiente, paga, cortesia, anulada]) {
      expect(matchesFilter(s, 'todas')).toBe(true)
    }
  })
})
