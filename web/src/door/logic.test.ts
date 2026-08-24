import { describe, expect, it } from 'vitest'

import type { DoorSnapshot } from '../api/client'
import type { QueuedCheckin } from './db'
import {
  codeFromPayload,
  doorCounter,
  effectiveTickets,
  enteredCodes,
  validateLocally,
} from './logic'

function snapshot(): DoorSnapshot {
  return {
    function: {
      id: 1,
      name: null,
      venue: 'Teatro',
      starts_at: '2026-12-10T21:00:00-03:00',
      capacity: 100,
    },
    tickets: [
      { code: 'T1', status: 'issued', buyer_name: 'Maria Dutra', seller_name: 'Carolina', is_comp: false },
      { code: 'T2', status: 'issued', buyer_name: 'Maria Dutra', seller_name: 'Carolina', is_comp: false },
      { code: 'T3', status: 'checked_in', buyer_name: 'Pedro', seller_name: 'Valeria', is_comp: false },
      { code: 'T4', status: 'void', buyer_name: 'Anulada', seller_name: 'Carolina', is_comp: false },
    ],
    checkins: [
      { ticket_code: 'T3', created_at: '2026-12-10T21:05:00-03:00', method: 'scan', by_name: 'Recepcion' },
    ],
  }
}

function queued(code: string): QueuedCheckin {
  return { functionId: 1, code, method: 'scan', at: '2026-12-10T21:10:00-03:00' }
}

describe('codeFromPayload', () => {
  it('separa el codigo de la firma', () => {
    expect(codeFromPayload('T1.abc123')).toBe('T1')
  })
  it('rechaza payloads sin forma de entrada', () => {
    expect(codeFromPayload('sin-punto')).toBe('')
    expect(codeFromPayload('.solo-firma')).toBe('')
    expect(codeFromPayload('')).toBe('')
  })
})

describe('validateLocally', () => {
  it('ticket emitido y sin usar → verde', () => {
    const verdict = validateLocally(snapshot(), [], 'T1')
    expect(verdict.result).toBe('ok')
    expect(verdict.buyer_name).toBe('Maria Dutra')
    expect(verdict.seller_name).toBe('Carolina')
  })

  it('codigo desconocido → invalid (QR trucho u otra funcion)', () => {
    expect(validateLocally(snapshot(), [], 'NO-EXISTE').result).toBe('invalid')
  })

  it('ticket anulado → void', () => {
    expect(validateLocally(snapshot(), [], 'T4').result).toBe('void')
  })

  it('ya ingresado segun el server → rojo con hora y quien', () => {
    const verdict = validateLocally(snapshot(), [], 'T3')
    expect(verdict.result).toBe('already_checked_in')
    expect(verdict.checked_in_at).toBe('2026-12-10T21:05:00-03:00')
    expect(verdict.by_name).toBe('Recepcion')
  })

  it('ya en la cola local → rojo, dedupe sin conexion', () => {
    const verdict = validateLocally(snapshot(), [queued('T1')], 'T1')
    expect(verdict.result).toBe('already_checked_in')
    expect(verdict.by_name).toBe('este dispositivo')
    expect(verdict.checked_in_at).toBe('2026-12-10T21:10:00-03:00')
  })
})

describe('contador y vistas', () => {
  it('cuenta ingresados unicos sobre emitidos (sin anulados)', () => {
    // T3 del server + T1 en cola = 2; emitidos = 3 (T4 anulado no cuenta).
    expect(doorCounter(snapshot(), [queued('T1')])).toEqual({ entered: 2, issued: 3 })
  })

  it('no cuenta dos veces un ticket en server y en cola', () => {
    expect(enteredCodes(snapshot(), [queued('T3')]).size).toBe(1)
  })

  it('la busqueda manual ve los pendientes locales como ingresados', () => {
    const tickets = effectiveTickets(snapshot(), [queued('T1')])
    expect(tickets.find((t) => t.code === 'T1')?.status).toBe('checked_in')
    expect(tickets.find((t) => t.code === 'T2')?.status).toBe('issued')
  })
})
