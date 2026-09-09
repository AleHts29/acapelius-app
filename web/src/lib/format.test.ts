import { describe, expect, it } from 'vitest'

import { calendarDaysUntil, dayAndMonth, dayLabel, daysAgo, formatDateTime, formatMoney, functionDay, functionTime, isoToLocalInput, localInputToISO, pesosToCents } from './format'

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

describe('calendarDaysUntil (rótulo del hero en Inicio)', () => {
  /** Un ISO de hoy a la hora que se pida, en la zona del navegador. */
  const hoyALas = (hora: number) => {
    const d = new Date()
    d.setHours(hora, 0, 0, 0)
    return d.toISOString()
  }

  it('la función de esta noche está a 0 días, no a 1', () => {
    // El bug: con la resta de horas, una función a las 21:00 mirada a la
    // tarde daba 0,x y Math.ceil la mandaba a "mañana".
    expect(calendarDaysUntil(hoyALas(21))).toBe(0)
    expect(calendarDaysUntil(hoyALas(1))).toBe(0)
  })

  it('ayer es -1 aunque hayan pasado pocas horas', () => {
    const anoche = new Date()
    anoche.setDate(anoche.getDate() - 1)
    anoche.setHours(23, 30, 0, 0)
    expect(calendarDaysUntil(anoche.toISOString())).toBe(-1)
  })

  it('mañana es 1 aunque falte menos de un día entero', () => {
    const manana = new Date()
    manana.setDate(manana.getDate() + 1)
    manana.setHours(0, 30, 0, 0)
    expect(calendarDaysUntil(manana.toISOString())).toBe(1)
  })
})

describe('fecha de una función (fila de Temporadas)', () => {
  // 21:00 en Buenos Aires. En UTC ya es el día siguiente: si el formateo no
  // fijara la zona, la fila mostraría la función un día corrido.
  const nocheDelTrece = '2026-09-14T00:00:00Z'

  it('functionDay arranca en mayúscula y sin la coma del locale', () => {
    expect(functionDay(nocheDelTrece)).toBe('Dom 13 de septiembre')
  })

  it('functionTime da la hora de Buenos Aires, no la del navegador', () => {
    expect(functionTime(nocheDelTrece)).toBe('21:00')
  })

  it('dayAndMonth arma los extremos del rango de la temporada', () => {
    expect(dayAndMonth('2026-08-14T21:00:00-03:00')).toBe('14 de agosto')
  })
})
