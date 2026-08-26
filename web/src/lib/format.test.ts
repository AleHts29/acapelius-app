import { describe, expect, it } from 'vitest'

import { dayLabel, daysAgo, formatDateTime, formatMoney, isoToLocalInput, localInputToISO, pesosToCents } from './format'

describe('formatMoney', () => {
  it('muestra centavos como pesos argentinos', () => {
    // El separador de miles de es-AR es un punto; el espacio puede ser NBSP.
    expect(formatMoney(800000).replace(/\s/g, ' ')).toBe('$ 8.000')
    expect(formatMoney(0).replace(/\s/g, ' ')).toBe('$ 0')
  })

  it('conserva los decimales cuando los hay', () => {
    expect(formatMoney(800050)).toContain('8.000,5')
  })
})

describe('pesosToCents', () => {
  it('acepta enteros y decimales con punto o coma', () => {
    expect(pesosToCents('8000')).toBe(800000)
    expect(pesosToCents('8000.50')).toBe(800050)
    expect(pesosToCents('8000,50')).toBe(800050)
    expect(pesosToCents(' 150 ')).toBe(15000)
    expect(pesosToCents('0')).toBe(0)
  })

  it('rechaza lo que no es un precio', () => {
    expect(pesosToCents('')).toBeNull()
    expect(pesosToCents('abc')).toBeNull()
    expect(pesosToCents('-100')).toBeNull()
    expect(pesosToCents('1.2.3')).toBeNull()
    expect(pesosToCents('100,123')).toBeNull() // mas de 2 decimales
  })
})

describe('fechas en hora de Buenos Aires', () => {
  // 2026-12-05T21:00 -03:00 es medianoche UTC del dia 6.
  const iso = '2026-12-06T00:00:00Z'

  it('formatea en es-AR con la zona correcta', () => {
    const formatted = formatDateTime(iso)
    expect(formatted).toContain('5 de diciembre')
    expect(formatted).toContain('21:00')
  })

  it('convierte ida y vuelta con el input datetime-local', () => {
    expect(isoToLocalInput(iso)).toBe('2026-12-05T21:00')
    expect(localInputToISO('2026-12-05T21:00')).toBe('2026-12-05T21:00:00-03:00')
    // Ida y vuelta: el instante es el mismo.
    expect(new Date(localInputToISO(isoToLocalInput(iso))).getTime()).toBe(new Date(iso).getTime())
  })
})

describe('dayLabel y daysAgo (historial C5)', () => {
  it('hoy y ayer llevan prefijo', () => {
    const now = new Date()
    expect(dayLabel(now.toISOString())).toMatch(/^Hoy · /)
    const ayer = new Date(now.getTime() - 86400_000)
    expect(dayLabel(ayer.toISOString())).toMatch(/^Ayer · /)
  })

  it('dias anteriores: "Jue 21 ago" capitalizado y sin puntuacion', () => {
    const label = dayLabel('2026-08-20T12:00:00-03:00')
    expect(label[0]).toBe(label[0].toUpperCase())
    expect(label).not.toMatch(/[.,]/)
    expect(label).toContain('20')
  })

  it('daysAgo relata en castellano', () => {
    expect(daysAgo(new Date().toISOString())).toBe('hoy')
    expect(daysAgo(new Date(Date.now() - 86400_000).toISOString())).toBe('ayer')
    expect(daysAgo(new Date(Date.now() - 3 * 86400_000).toISOString())).toBe('hace 3 días')
  })
})
