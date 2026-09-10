import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, roleLabel } from './client'

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api', () => {
  it('devuelve el cuerpo cuando la respuesta es exitosa', async () => {
    const user = { id: 1, name: 'Eli', email: 'eli@x.com', role: 'admin' }
    mockFetch(200, { user })

    await expect(api.me()).resolves.toEqual({ user })
  })

  it('manda el body como JSON y conserva las cookies del mismo origen', async () => {
    const fetchMock = mockFetch(200, { user: {} })
    await api.login('eli@x.com', 'secreta')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/auth/login')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'eli@x.com', password: 'secreta' })
  })

  it('convierte el error de la API en un ApiError con su codigo', async () => {
    mockFetch(401, { error: { code: 'invalid_credentials', message: 'Email o contrasena incorrectos.' } })

    const error = await api.login('eli@x.com', 'mala').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.code).toBe('invalid_credentials')
    expect(apiError.status).toBe(401)
    expect(apiError.message).toBe('Email o contrasena incorrectos.')
    expect(apiError.isUnauthenticated).toBe(false)
  })

  it('reconoce la sesion vencida y el cambio de contrasena pendiente', async () => {
    mockFetch(401, { error: { code: 'unauthenticated', message: 'Necesitas iniciar sesion.' } })
    const unauth = (await api.me().catch((e: unknown) => e)) as ApiError
    expect(unauth.isUnauthenticated).toBe(true)

    mockFetch(403, { error: { code: 'password_change_required', message: 'Cambia tu contrasena.' } })
    const pending = (await api.team().catch((e: unknown) => e)) as ApiError
    expect(pending.needsPasswordChange).toBe(true)
  })

  it('trata un 204 como respuesta vacia', async () => {
    mockFetch(204, null)
    await expect(api.logout()).resolves.toBeUndefined()
  })

  it('reporta la falta de red como network_error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const error = (await api.me().catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('network_error')
    expect(error.status).toBe(0)
  })

  it('no rompe si el cuerpo del error no es el sobre esperado', async () => {
    mockFetch(500, 'vaya cosa')

    const error = (await api.me().catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('internal_error')
    expect(error.status).toBe(500)
  })
})

describe('roleLabel', () => {
  it('traduce los roles a lo que se muestra en pantalla', () => {
    expect(roleLabel('admin')).toBe('Dirección')
    expect(roleLabel('seller')).toBe('Corista')
    expect(roleLabel('door')).toBe('Puerta')
  })
})
