// La sala (C20): las entradas dibujadas como butacas de un teatro. Acá vive lo
// que se puede probar: dónde va cada butaca y de qué estado es cada una.

export type EstadoButaca = 'entro' | 'vendida' | 'repartida' | 'libre'

export interface FuncionSala {
  capacity: number
  sold: number
  assigned: number
  entered: number
}

export type Cuentas = Record<EstadoButaca, number>

/** Reparte la capacidad en cuatro estados que siempre suman la capacidad. */
export function contar(funciones: FuncionSala[]): Cuentas {
  const c: Cuentas = { entro: 0, vendida: 0, repartida: 0, libre: 0 }
  for (const fn of funciones) {
    const vendidas = Math.min(fn.sold, fn.capacity)
    const entraron = Math.min(fn.entered, vendidas)
    const repartidas = Math.min(Math.max(fn.assigned - vendidas, 0), fn.capacity - vendidas)
    c.entro += entraron
    c.vendida += vendidas - entraron
    c.repartida += repartidas
    c.libre += fn.capacity - vendidas - repartidas
  }
  return c
}

export interface Butaca {
  x: number
  y: number
  /** Giro en grados: cada butaca mira al escenario. */
  giro: number
  estado: EstadoButaca
}

const PASO = 15
const RADIO_INICIAL = 70
const APERTURA = (62 * Math.PI) / 180

/**
 * Las butacas en filas curvas alrededor del escenario, de adelante hacia atrás
 * y del centro hacia los costados: la sala se llena como se llena un teatro.
 */
export function butacas(cuentas: Cuentas): Butaca[] {
  const total = cuentas.entro + cuentas.vendida + cuentas.repartida + cuentas.libre
  const puestos: Array<Omit<Butaca, 'estado'>> = []
  for (let fila = 0; puestos.length < total; fila++) {
    const radio = RADIO_INICIAL + fila * PASO
    const entran = Math.floor((2 * APERTURA * radio) / PASO)
    const cuantas = Math.min(entran, total - puestos.length)
    const angulos = Array.from({ length: cuantas }, (_, i) => ((i - (cuantas - 1) / 2) * PASO) / radio)
    angulos.sort((a, b) => Math.abs(a) - Math.abs(b))
    for (const a of angulos) {
      puestos.push({ x: radio * Math.sin(a), y: radio * Math.cos(a), giro: (-a * 180) / Math.PI })
    }
  }
  const orden: EstadoButaca[] = ['entro', 'vendida', 'repartida', 'libre']
  const estados = orden.flatMap((e) => Array.from({ length: cuentas[e] }, () => e))
  return puestos.map((p, i) => ({ ...p, estado: estados[i] }))
}
