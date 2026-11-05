import { describe, expect, it } from 'vitest'

import { repartirPorIgual } from './reparto'

describe('repartirPorIgual', () => {
  it('divide exacto cuando alcanza para todas', () => {
    expect(repartirPorIgual(80, Array(10).fill(0))).toEqual(Array(10).fill(8))
  })

  it('lo que sobra va de a una a las primeras', () => {
    expect(repartirPorIgual(11, [0, 0, 0])).toEqual([4, 4, 3])
  })

  it('nadie baja de lo que ya vendió', () => {
    expect(repartirPorIgual(20, [12, 0, 0])).toEqual([12, 4, 4])
  })

  it('completa a las que vendieron menos hasta emparejar', () => {
    expect(repartirPorIgual(12, [5, 3, 0])).toEqual([5, 4, 3])
  })

  it('si lo vendido ya cubre el cupo, no agrega nada', () => {
    expect(repartirPorIgual(5, [3, 3])).toEqual([3, 3])
  })

  it('sin coristas no hay nada que repartir', () => {
    expect(repartirPorIgual(10, [])).toEqual([])
  })
})
