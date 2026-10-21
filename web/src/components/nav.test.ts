import { describe, expect, it } from 'vitest'

import { activeItem, navFor, puedeEntrar, tabsFor } from './nav'

const lateral = navFor('admin')

/** El label del ítem que se prende en una ruta, en la lateral de escritorio. */
const prendido = (path: string) => activeItem(lateral, path)?.label

describe('activeItem: qué se prende en la navegación', () => {
  it('gana el ítem del segundo nivel sobre Dirección', () => {
    // El bug: desempataba por el largo de `to`, y "/direccion" (10) le ganaba
    // a "/usuarios" (9). Estando en Equipo se prendía Dirección.
    expect(prendido('/usuarios')).toBe('Equipo')
    expect(prendido('/temporadas')).toBe('Temporadas')
    expect(prendido('/temporadas/1')).toBe('Temporadas')
    expect(prendido('/panel/rendiciones')).toBe('Rendiciones')
    expect(prendido('/panel/rendiciones/11')).toBe('Rendiciones')
    expect(prendido('/panel/asistencia')).toBe('Asistencia')
  })

  it('Dirección se prende sólo en lo suyo', () => {
    expect(prendido('/direccion')).toBe('Dirección')
    // /panel/ventas no tiene ítem propio: ahí sí manda Dirección.
    expect(prendido('/panel/ventas')).toBe('Dirección')
  })

  it('el primer nivel no se pisa entre sí', () => {
    expect(prendido('/')).toBe('Inicio')
    expect(prendido('/ventas')).toBe('Ventas')
    expect(prendido('/ventas/nueva')).toBe('Ventas')
    expect(prendido('/puerta/4')).toBe('Puerta')
  })

  it('en el celular gana Dirección: el segundo nivel no existe ahí', () => {
    const tabs = tabsFor('admin')
    expect(activeItem(tabs, '/usuarios')?.label).toBe('Dirección')
    expect(activeItem(tabs, '/panel/rendiciones')?.label).toBe('Dirección')
  })

  it('una corista no tiene los ítems de dirección', () => {
    const suyos = navFor('seller').map((i) => i.label)
    expect(suyos).toEqual(['Inicio', 'Ventas', 'Puerta', 'Mi plata'])
  })

  it('Mi plata es una pestaña de la corista, y sólo de ella', () => {
    expect(tabsFor('seller').map((i) => i.label)).toEqual(['Inicio', 'Ventas', 'Puerta', 'Mi plata'])
    expect(prendido('/mi-plata')).toBeUndefined()
    expect(activeItem(tabsFor('seller'), '/mi-plata')?.label).toBe('Mi plata')
  })
})

describe('puedeEntrar: quién llega a cada pantalla', () => {
  it('una corista llega a su propia rendición (C19 §7.1)', () => {
    expect(puedeEntrar('seller', '/mi-plata')).toBe(true)
    // El bug: su acceso apuntaba acá, que es de dirección, y rebotaba.
    expect(puedeEntrar('seller', '/panel/rendiciones')).toBe(false)
  })

  it('ningún ítem de la navegación lleva a una pantalla que rebota', () => {
    for (const role of ['admin', 'seller', 'door'] as const) {
      for (const item of navFor(role)) {
        expect(puedeEntrar(role, item.to), `${role} → ${item.to}`).toBe(true)
      }
    }
  })

  it('dirección y equipo son sólo de dirección', () => {
    for (const p of ['/direccion', '/panel/asistencia', '/temporadas/3', '/usuarios']) {
      expect(puedeEntrar('admin', p)).toBe(true)
      expect(puedeEntrar('seller', p)).toBe(false)
      expect(puedeEntrar('door', p)).toBe(false)
    }
  })

  it('la puerta y el inicio son de todos; vender no es de la puerta', () => {
    expect(puedeEntrar('door', '/puerta/4')).toBe(true)
    expect(puedeEntrar('seller', '/')).toBe(true)
    expect(puedeEntrar('door', '/ventas')).toBe(false)
    expect(puedeEntrar('seller', '/ventas/nueva')).toBe(true)
  })
})
