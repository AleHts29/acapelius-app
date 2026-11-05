import { describe, expect, it } from 'vitest'

import { butacas, contar } from './sala'

describe('contar', () => {
  it('reparte la capacidad en estados que suman la capacidad', () => {
    const c = contar([
      { capacity: 80, sold: 16, assigned: 22, entered: 0 },
      { capacity: 45, sold: 34, assigned: 45, entered: 31 },
    ])
    expect(c).toEqual({ entro: 31, vendida: 19, repartida: 17, libre: 58 })
  })

  it('no se rompe si se vendió más de lo repartido', () => {
    const c = contar([{ capacity: 10, sold: 6, assigned: 2, entered: 0 }])
    expect(c).toEqual({ entro: 0, vendida: 6, repartida: 0, libre: 4 })
  })
})

describe('butacas', () => {
  it('dibuja una butaca por entrada, con los estados en orden', () => {
    const b = butacas({ entro: 3, vendida: 4, repartida: 5, libre: 8 })
    expect(b).toHaveLength(20)
    expect(b.filter((x) => x.estado === 'repartida')).toHaveLength(5)
    expect(b[0].estado).toBe('entro')
    expect(b[19].estado).toBe('libre')
  })

  it('sin capacidad no dibuja nada', () => {
    expect(butacas({ entro: 0, vendida: 0, repartida: 0, libre: 0 })).toEqual([])
  })
})
