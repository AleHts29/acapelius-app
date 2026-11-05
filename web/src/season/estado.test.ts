import { describe, expect, it } from 'vitest'

import { estadoTemporada } from './estado'

describe('estadoTemporada', () => {
  it('la activa con funciones por delante está en curso', () => {
    expect(estadoTemporada({ is_active: true, functions: 3, next_at: '2026-12-01T21:00:00Z' })).toBe('en curso')
  })
  it('la activa con todas las funciones pasadas está terminada', () => {
    expect(estadoTemporada({ is_active: true, functions: 5, next_at: null })).toBe('terminada')
  })
  it('una no activa sin funciones o con funciones por delante se está preparando', () => {
    expect(estadoTemporada({ is_active: false, functions: 0, next_at: null })).toBe('preparándose')
    expect(estadoTemporada({ is_active: false, functions: 2, next_at: '2027-03-01T21:00:00Z' })).toBe('preparándose')
  })
  it('una no activa con todo pasado está terminada', () => {
    expect(estadoTemporada({ is_active: false, functions: 4, next_at: null })).toBe('terminada')
  })
})
