import { describe, expect, it } from 'vitest'

import { activeItem, navFor, tabsFor } from './nav'

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
    expect(suyos).toEqual(['Inicio', 'Ventas', 'Puerta'])
  })
})
