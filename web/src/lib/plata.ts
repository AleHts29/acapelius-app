import { useSyncExternalStore } from 'react'

/**
 * El ojito de la plata: oculta todos los montos de la app, como en el home
 * banking, para usarla delante de otros. Es de este dispositivo (localStorage)
 * y arranca visible. formatMoney lo lee, así que tapa todo monto sin que cada
 * pantalla tenga que saberlo.
 */
const CLAVE = 'acapelius.plata-oculta'
const oyentes = new Set<() => void>()

let oculta = (() => {
  try {
    return localStorage.getItem(CLAVE) === '1'
  } catch {
    return false
  }
})()

export function plataOculta(): boolean {
  return oculta
}

export function setPlataOculta(valor: boolean) {
  oculta = valor
  try {
    localStorage.setItem(CLAVE, valor ? '1' : '0')
  } catch {
    // Sin storage (navegación privada): vale hasta recargar.
  }
  for (const o of oyentes) o()
}

function suscribir(o: () => void) {
  oyentes.add(o)
  return () => oyentes.delete(o)
}

export function usePlataOculta(): boolean {
  return useSyncExternalStore(suscribir, plataOculta)
}
