import { describe, expect, it } from 'vitest'

import { telefonoWhatsApp, whatsAppURL } from './client'

describe('telefonoWhatsApp', () => {
  it('arma 549 + característica + número', () => {
    expect(telefonoWhatsApp('11 2345-6789')).toBe('5491123456789')
    expect(telefonoWhatsApp('011 15 2345-6789')).toBe('5491123456789')
    expect(telefonoWhatsApp('+54 9 11 2345 6789')).toBe('5491123456789')
    expect(telefonoWhatsApp('+54 11 2345 6789')).toBe('5491123456789')
    expect(telefonoWhatsApp('0351 15 612-3456')).toBe('5493516123456')
  })
  it('sin teléfono, o uno que no alcanza, va vacío', () => {
    expect(telefonoWhatsApp(null)).toBe('')
    expect(telefonoWhatsApp('1234')).toBe('')
  })
})

describe('whatsAppURL', () => {
  it('lleva el texto codificado', () => {
    expect(whatsAppURL('Hola Ana! http://x/e/1', null)).toBe('https://wa.me/?text=Hola%20Ana!%20http%3A%2F%2Fx%2Fe%2F1')
  })
})
