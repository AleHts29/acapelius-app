import { describe, expect, it } from 'vitest'

import { termsFor } from './terms'

describe('termsFor', () => {
  it('un coro tiene coristas', () => {
    expect(termsFor('choir')).toEqual({ member: 'corista', members: 'coristas', cast: 'el coro', venue: 'lugar' })
  })
  it('un grupo de teatro tiene un elenco de integrantes', () => {
    expect(termsFor('theatre').cast).toBe('el elenco')
    expect(termsFor('theatre').members).toBe('integrantes')
    expect(termsFor('theatre').venue).toBe('sala')
  })
  it('sin sesión habla como el coro', () => {
    expect(termsFor(undefined)).toEqual(termsFor('choir'))
  })
})
