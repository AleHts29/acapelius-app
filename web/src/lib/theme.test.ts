import { beforeEach, describe, expect, it } from 'vitest'

import { applyTheme, getTheme, setTheme } from './theme'

// Los tests corren en Node: un storage y un <html> mínimos alcanzan.
function stubDom() {
  const store = new Map<string, string>()
  const attrs = new Map<string, string>()
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
    document: {
      documentElement: {
        setAttribute: (k: string, v: string) => void attrs.set(k, v),
        removeAttribute: (k: string) => void attrs.delete(k),
        getAttribute: (k: string) => attrs.get(k) ?? null,
      },
    },
  })
}

describe('tema', () => {
  beforeEach(stubDom)

  it('sin nada guardado es el del sistema y no fija data-theme', () => {
    expect(getTheme()).toBe('system')
    applyTheme(getTheme())
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('elegir oscuro lo guarda y lo aplica; volver a sistema lo saca', () => {
    setTheme('dark')
    expect(getTheme()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    setTheme('system')
    expect(getTheme()).toBe('system')
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })
})
