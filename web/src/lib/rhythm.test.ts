import { describe, expect, it } from 'vitest'

import { porMinuto, ritmo } from './rhythm'

const desde = new Date('2026-12-11T19:20:00-03:00')
const hasta = new Date('2026-12-11T20:50:00-03:00')
const a = (hhmm: string) => `2026-12-11T${hhmm}:00-03:00`

describe('ritmo', () => {
  it('agrupa por tramo de 10 minutos', () => {
    const r = ritmo([a('19:21'), a('19:29'), a('19:30'), a('19:55')], desde, hasta, hasta)
    expect(r.tramos).toHaveLength(9)
    expect(r.tramos.slice(0, 4)).toEqual([2, 1, 0, 1])
    expect(r.tramos.reduce((s, n) => s + n, 0)).toBe(4)
  })

  it('el que entró antes o después de la ventana cuenta en el tramo del borde', () => {
    const r = ritmo([a('19:05'), a('21:10')], desde, hasta, hasta)
    expect(r.tramos[0]).toBe(1)
    expect(r.tramos[8]).toBe(1)
  })

  it('marca el tramo en curso', () => {
    expect(ritmo([], desde, hasta, new Date(a('20:17'))).ahora).toBe(5)
    expect(ritmo([], desde, hasta, new Date(a('19:00'))).ahora).toBe(-1)
    expect(ritmo([], desde, hasta, new Date(a('22:00'))).ahora).toBe(9)
  })

  it('el pico es el tramo con más ingresos, con su hora', () => {
    const r = ritmo([a('19:21'), a('20:01'), a('20:02'), a('20:09')], desde, hasta, hasta)
    expect(r.pico?.tramo).toBe(4)
    expect(r.pico?.cantidad).toBe(3)
    expect(r.pico?.desde.toISOString()).toBe(new Date(a('20:00')).toISOString())
  })

  it('sin ingresos no hay pico', () => {
    expect(ritmo([], desde, hasta, hasta).pico).toBeNull()
  })
})

describe('porMinuto', () => {
  it('promedia los últimos cinco minutos', () => {
    const ahora = new Date(a('20:17'))
    const recientes = Array.from({ length: 10 }, () => a('20:15'))
    expect(porMinuto([...recientes, a('20:05')], ahora)).toBe(2)
  })
})
