import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { ShowFunction } from '../api/client'
import { useSession } from '../auth/session'
import { loadStoredSnapshot, saveStoredSnapshot } from '../door/db'
import { calendarDaysUntil, dayAndMonthShort, functionDay, functionTime } from '../lib/format'
import { EmptyState } from '../ui/controls'
import { CalendarClock, ScanLine, Users } from 'lucide-react'

/** Después de esto la función se da por terminada (la misma gracia que Inicio). */
const GRACIA_MS = 3 * 60 * 60 * 1000

function nombre(fn: ShowFunction): string {
  return fn.name && fn.name !== '' ? fn.name : fn.venue
}

function yaPaso(fn: ShowFunction): boolean {
  return new Date(fn.starts_at).getTime() < Date.now() - GRACIA_MS
}

/** "en 2 h 15 min" / "empezó hace 40 min". La cuenta que importa en la puerta. */
function faltan(iso: string): string {
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  const abs = Math.abs(min)
  const texto =
    abs < 60 ? `${abs} min` : abs % 60 === 0 ? `${abs / 60} h` : `${Math.floor(abs / 60)} h ${abs % 60} min`
  return min >= 0 ? `empieza en ${texto}` : `empezó hace ${texto}`
}

/** Hoy, en el calendario: la función de las 21:00 es "hoy" desde la mañana. */
function esDeHoy(fn: ShowFunction): boolean {
  return calendarDaysUntil(fn.starts_at) === 0
}

function enCuantosDias(iso: string): string {
  const dias = calendarDaysUntil(iso)
  if (dias === 1) return 'mañana'
  return `en ${dias} días`
}

/**
 * Deja el snapshot de la función guardado en este dispositivo antes de entrar
 * a la puerta. En el teatro puede no haber señal, y la primera bajada es la
 * única que necesita conexión: mejor hacerla acá, con tiempo, que descubrirlo
 * con la fila en la puerta.
 */
function useListoOffline(functionId: number | undefined) {
  const [guardado, setGuardado] = useState<string | null>(null)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    if (functionId === undefined) return
    let vivo = true
    void (async () => {
      const previo = await loadStoredSnapshot(functionId)
      if (vivo && previo) setGuardado(previo.savedAt)
      try {
        const fresco = await api.doorSnapshot(functionId)
        await saveStoredSnapshot(functionId, fresco)
        if (!vivo) return
        setGuardado(new Date().toISOString())
        setFallo(false)
      } catch {
        // Con copia previa no hay nada que avisar: se puede trabajar igual.
        if (vivo && !previo) setFallo(true)
      }
    })()
    return () => {
      vivo = false
    }
  }, [functionId])

  return { guardado, fallo }
}

/** "hace 2 min" / "recién" — la antigüedad de la copia local. */
function haceCuanto(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const horas = Math.floor(min / 60)
  return horas === 1 ? 'hace 1 hora' : `hace ${horas} horas`
}

function Preparada({ functionId }: { functionId: number }) {
  const { guardado, fallo } = useListoOffline(functionId)
  if (fallo) {
    return (
      <p className="door-ready door-ready--off">
        <i aria-hidden />
        Todavía sin copia local: la primera vez hace falta conexión.
      </p>
    )
  }
  if (!guardado) return <p className="door-ready door-ready--wait">Preparando la copia local…</p>
  return (
    <p className="door-ready">
      <i aria-hidden />
      Listo para trabajar sin conexión · sincronizado {haceCuanto(guardado)}
    </p>
  )
}

/** Cuándo fue o va a ser, en corto: la fila de la derecha es angosta. */
function cuando(fn: ShowFunction): string {
  const dias = calendarDaysUntil(fn.starts_at)
  const dia =
    dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : dias === -1 ? 'Ayer' : dayAndMonthShort(fn.starts_at)
  return yaPaso(fn) ? dia : `${dia}, ${functionTime(fn.starts_at)}`
}

/** Fila compacta de una función que no es la protagonista. */
function Otra({ fn }: { fn: ShowFunction }) {
  const pasada = yaPaso(fn)
  return (
    <div className="door-row">
      <span className="door-row__mid">
        <b>{nombre(fn)}</b>
        <span>
          {cuando(fn)} ·{' '}
          {pasada ? (
            <>
              <b className="g">{fn.entered}</b> de {fn.sold} ingresaron
            </>
          ) : (
            <>
              <b>{fn.sold}</b> emitidas
            </>
          )}
        </span>
      </span>
      <Link className="button button--ghost button--sm" to={`/puerta/${fn.id}`}>
        Abrir
      </Link>
    </div>
  )
}

export function DoorPage() {
  const navigate = useNavigate()
  const { user } = useSession()
  const { data, isPending } = useQuery({
    queryKey: ['functions'],
    queryFn: () => api.listFunctions(),
  })

  const funciones = data?.functions ?? []
  const hoy = funciones.find(esDeHoy)
  // Sin función hoy, la próxima: es lo único que alguien puede querer abrir.
  const proxima = hoy ?? funciones.find((fn) => !yaPaso(fn))
  const destacada = hoy ?? proxima
  // Todo lo que no es la destacada, en el orden en que puede hacer falta: lo
  // que viene primero, y después lo que pasó, de lo más reciente para atrás.
  const resto = funciones.filter((fn) => fn.id !== destacada?.id)
  const otras = [
    ...resto.filter((fn) => !yaPaso(fn)),
    ...resto.filter(yaPaso).reverse(),
  ]
  const soloPasadas = otras.length > 0 && otras.every(yaPaso)

  // "Miércoles 9 de septiembre": es-AR mete una coma que acá sobra.
  const fecha = new Date()
    .toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'America/Argentina/Buenos_Aires',
    })
    .replace(',', '')

  if (isPending) return <p className="muted">Cargando funciones…</p>

  return (
    <div className="door-pick">
      <h1 className="page-title" style={{ marginBottom: 2 }}>
        Modo puerta
      </h1>
      <p className="page-head__sub" style={{ margin: '0 0 4px' }}>
        {fecha.charAt(0).toUpperCase() + fecha.slice(1)}
        {!hoy && funciones.length > 0 && ' · hoy no hay función'}
      </p>

      <div className="door-grid">
        <div className="door-col">
          {funciones.length === 0 ? (
            <EmptyState icon={<CalendarClock size={20} />} title="No hay funciones cargadas">
              Cuando dirección cargue la primera función, va a aparecer acá para abrir la puerta.
            </EmptyState>
          ) : hoy ? (
            // El caso que importa: un bloque, un botón, cero decisiones.
            <div className="door-hoy">
              <p className="door-hoy__e">Hoy · {faltan(hoy.starts_at)}</p>
              <p className="door-hoy__fn">{nombre(hoy)}</p>
              <p className="door-hoy__m">
                {functionTime(hoy.starts_at)} · {hoy.venue}
              </p>
              <div className="door-hoy__stats">
                <div>
                  <b>{hoy.sold}</b>
                  <span>Entradas emitidas</span>
                </div>
                <div>
                  <b>{hoy.entered}</b>
                  <span>Ingresaron</span>
                </div>
                <div>
                  <b>{hoy.comp_tickets}</b>
                  <span>Cortesías</span>
                </div>
                <div>
                  <b>{hoy.sellers}</b>
                  <span>Coristas vendieron</span>
                </div>
              </div>
              <button className="door-hoy__cta" type="button" onClick={() => navigate(`/puerta/${hoy.id}`)}>
                <ScanLine size={17} aria-hidden />
                Abrir modo puerta
              </button>
              <Preparada functionId={hoy.id} />
            </div>
          ) : proxima ? (
            <div className="door-soon">
              <p className="door-soon__e">Próxima función · {enCuantosDias(proxima.starts_at)}</p>
              <p className="door-soon__fn">{nombre(proxima)}</p>
              <p className="door-soon__m">
                {functionDay(proxima.starts_at)}, {functionTime(proxima.starts_at)} · {proxima.venue}
              </p>
              <p className="door-soon__info">
                El modo puerta se activa solo el día de la función. Si querés probarlo antes, podés
                abrirlo igual: los ingresos que marques quedan registrados.
              </p>
              <div className="door-soon__acts">
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => navigate(`/puerta/${proxima.id}`)}
                >
                  Abrir igual para probar
                </button>
                {/* Asistencia es de dirección: a la persona de la puerta el botón
                    la mandaría a una pantalla que no puede abrir. */}
                {user?.role === 'admin' && (
                  <Link className="button button--ghost" to={`/panel/asistencia?fn=${proxima.id}`}>
                    <Users size={15} aria-hidden />
                    Ver quiénes compraron
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <EmptyState icon={<CalendarClock size={20} />} title="La temporada ya terminó">
              No queda ninguna función por delante. Las que ya pasaron siguen abajo, por si hay que
              corregir un ingreso.
            </EmptyState>
          )}

        </div>

        <div className="door-col">
          {otras.length > 0 && (
            <div>
              <p className="sectrule">
                <b>{soloPasadas ? 'Funciones anteriores' : 'Otras funciones'}</b>
              </p>
              <div className="door-list">
                {otras.map((fn) => (
                  <Otra key={fn.id} fn={fn} />
                ))}
              </div>
              {soloPasadas && (
                <p className="door-hint">
                  Abrilas para corregir ingresos que quedaron mal marcados.
                </p>
              )}
            </div>
          )}

          <div>
            <p className="sectrule">
              <b>Antes de abrir</b>
            </p>
            <div className="door-tip">
              En la puerta conviene el <b>celular</b>: escanea los QR con la cámara. Desde la
              compu podés buscar por nombre y marcar ingresos a mano.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
