// Formateo de plata y fechas para es-AR. La plata viaja siempre en centavos
// (enteros); los pesos con decimales solo existen en la UI.

const TIME_ZONE = 'America/Argentina/Buenos_Aires'

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

/** Centavos → "$ 8.000". Sin decimales cuando son ,00. */
export function formatMoney(cents: number): string {
  return money.format(cents / 100)
}

/**
 * Pesos tipeados por una persona → centavos. Acepta "8000", "8000.50" y
 * "8000,50". Devuelve null si no es un numero valido o es negativo.
 */
export function pesosToCents(input: string): number | null {
  const normalized = input.trim().replace(',', '.')
  if (normalized === '' || !/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null
  }
  return Math.round(Number(normalized) * 100)
}

const dateTime = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23', // las funciones se anuncian en 24 horas: "21:00"
  timeZone: TIME_ZONE,
})

/** ISO → "viernes, 5 de diciembre, 21:00" en hora de Buenos Aires. */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso))
}

/**
 * ISO → valor para <input type="datetime-local"> en hora de Buenos Aires.
 * El input no maneja zonas, asi que la conversion es explicita.
 */
export function isoToLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TIME_ZONE,
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

/**
 * Valor de <input type="datetime-local"> (hora de Buenos Aires) → ISO con
 * offset -03:00. Argentina no tiene horario de verano desde 2009, asi que el
 * offset fijo es correcto.
 */
export function localInputToISO(value: string): string {
  return `${value}:00-03:00`
}

/** ISO → "hoy" / "ayer" / "hace N días" (para "enviado hace…"). */
export function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  return `hace ${days} días`
}

/** ISO → "Hoy · mar 25 ago" / "Ayer · lun 24 ago" / "Jue 21 ago". */
export function dayLabel(iso: string): string {
  const date = new Date(iso)
  const strip = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((strip(new Date()) - strip(date)) / 86400_000)
  const base = date
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires' })
    .replace(/[.,]/g, '')
  if (diff === 0) return `Hoy · ${base}`
  if (diff === 1) return `Ayer · ${base}`
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/** ISO → "19:02" (hora compacta del historial). */
export function timeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}
