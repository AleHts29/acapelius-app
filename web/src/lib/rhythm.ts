// El ritmo de entrada de Asistencia (C19 §5.3): los ingresos agrupados por
// tramo de 10 minutos, derivados en el cliente de los check-ins que ya trae
// el reporte. Sin endpoint nuevo.

const MIN = 60_000

export interface Ritmo {
  /** Ingresos por tramo, del primero al último. */
  tramos: number[]
  /** Índice del tramo en curso. -1 si todavía no empezó; tramos.length si ya terminó. */
  ahora: number
  /** El tramo con más ingresos (el primero, si hay empate). null si no entró nadie. */
  pico: { tramo: number; desde: Date; cantidad: number } | null
}

/**
 * Agrupa los check-ins (`at` en ISO) en tramos de `minutos` entre `desde` y
 * `hasta`. Un ingreso antes de `desde` cuenta en el primer tramo y uno después
 * de `hasta`, en el último: nadie que entró queda afuera del total.
 */
export function ritmo(checkins: string[], desde: Date, hasta: Date, ahora: Date, minutos = 10): Ritmo {
  const paso = minutos * MIN
  const n = Math.max(1, Math.ceil((hasta.getTime() - desde.getTime()) / paso))
  const tramos = new Array<number>(n).fill(0)
  for (const at of checkins) {
    const i = Math.floor((new Date(at).getTime() - desde.getTime()) / paso)
    tramos[Math.min(n - 1, Math.max(0, i))]++
  }

  const crudo = Math.floor((ahora.getTime() - desde.getTime()) / paso)
  const enCurso = Math.min(n, Math.max(-1, crudo))

  let pico: Ritmo['pico'] = null
  tramos.forEach((cantidad, tramo) => {
    if (cantidad > 0 && (pico === null || cantidad > pico.cantidad)) {
      pico = { tramo, desde: new Date(desde.getTime() + tramo * paso), cantidad }
    }
  })

  return { tramos, ahora: enCurso, pico }
}

/** "Entrando ahora": ingresos por minuto en los últimos `ventana` minutos. */
export function porMinuto(checkins: string[], ahora: Date, ventana = 5): number {
  const desde = ahora.getTime() - ventana * MIN
  const recientes = checkins.filter((at) => {
    const t = new Date(at).getTime()
    return t > desde && t <= ahora.getTime()
  }).length
  return Math.round(recientes / ventana)
}
