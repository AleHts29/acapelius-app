import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { api } from '../api/client'
import type { ShowFunction } from '../api/client'
import { useSession } from '../auth/session'
import { loadStoredSnapshot, saveStoredSnapshot } from '../door/db'
import { calendarDaysUntil, dayAndMonthShort, functionDay, functionTime } from '../lib/format'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Heel } from '../ui/Heel'
import { PageHeader } from '../ui/Page'
import { Row } from '../ui/Row'
import { Status } from '../ui/Status'

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

/** Si el dispositivo ya tiene la lista para trabajar sin señal. */
function Preparada({ functionId }: { functionId: number }) {
  const { guardado, fallo } = useListoOffline(functionId)
  if (fallo) return <Status tone="warn">Todavía sin copia local: la primera vez hace falta conexión</Status>
  if (!guardado) return <Status tone="mute">Preparando la copia local…</Status>
  return <Status tone="ok">Lista para trabajar sin conexión · sincronizada {haceCuanto(guardado)}</Status>
}

/** Cuándo fue o va a ser, en corto. */
function cuando(fn: ShowFunction): string {
  const dias = calendarDaysUntil(fn.starts_at)
  const dia =
    dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : dias === -1 ? 'Ayer' : dayAndMonthShort(fn.starts_at)
  return yaPaso(fn) ? dia : `${dia}, ${functionTime(fn.starts_at)}`
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
  // Lo que no es la destacada, en el orden en que puede hacer falta: lo que
  // viene primero, y después lo que pasó, de lo más reciente para atrás.
  const resto = funciones.filter((fn) => fn.id !== destacada?.id)
  const otras = [...resto.filter((fn) => !yaPaso(fn)), ...resto.filter(yaPaso).reverse()]
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

  if (isPending) return <p className="rs">Cargando funciones…</p>

  return (
    <>
      <PageHeader
        title="Puerta"
        label={`${fecha.charAt(0).toUpperCase() + fecha.slice(1)}${!hoy && funciones.length > 0 ? ' · hoy no hay función' : ''}`}
      />

      <div className="asym">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          {funciones.length === 0 ? (
            <Card title="No hay funciones cargadas">
              <p className="rs" style={{ padding: '0 var(--s3) var(--s3)', margin: 0, whiteSpace: 'normal' }}>
                Cuando dirección cargue la primera función, va a aparecer acá para abrir la puerta.
              </p>
            </Card>
          ) : hoy ? (
            // El caso que importa: un bloque, un botón, cero decisiones.
            <Heel label={`Hoy · ${faltan(hoy.starts_at)}`} title={nombre(hoy)} meta={`${functionTime(hoy.starts_at)} · ${hoy.venue}`}>
              <div className="heel__foot">
                <div>
                  <span className="lbl">Emitidas</span>
                  <b>{hoy.sold}</b>
                </div>
                <div>
                  <span className="lbl">Ingresaron</span>
                  <b>{hoy.entered}</b>
                </div>
                <div>
                  <span className="lbl">Cortesías</span>
                  <b>{hoy.comp_tickets}</b>
                </div>
                <div>
                  <span className="lbl">Coristas</span>
                  <b>{hoy.sellers}</b>
                </div>
              </div>
              <div style={{ margin: 'var(--s4) 0 var(--s2)' }}>
                <Button go wide onClick={() => navigate(`/puerta/${hoy.id}`)}>
                  Abrir la puerta
                </Button>
              </div>
              <Preparada functionId={hoy.id} />
            </Heel>
          ) : proxima ? (
            <Card title={`Próxima función · ${enCuantosDias(proxima.starts_at)}`}>
              <div style={{ padding: '0 var(--s3) var(--s3)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                <div>
                  <div className="rt">{nombre(proxima)}</div>
                  <div className="rs">
                    {functionDay(proxima.starts_at)}, {functionTime(proxima.starts_at)} · {proxima.venue}
                  </div>
                </div>
                <p className="rs" style={{ margin: 0, whiteSpace: 'normal' }}>
                  La puerta se usa el día de la función. Si querés probarla antes, podés abrirla igual:
                  los ingresos que marques quedan registrados.
                </p>
                <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                  <Button onClick={() => navigate(`/puerta/${proxima.id}`)}>Abrir igual para probar</Button>
                  {/* Asistencia es de dirección: a la puerta la mandaría a una
                      pantalla que no puede abrir. */}
                  {user?.role === 'admin' && (
                    <Button to={`/panel/asistencia?fn=${proxima.id}`}>Ver quiénes compraron</Button>
                  )}
                </div>
              </div>
            </Card>
          ) : (
            <Card title="La temporada ya terminó">
              <p className="rs" style={{ padding: '0 var(--s3) var(--s3)', margin: 0, whiteSpace: 'normal' }}>
                No queda ninguna función por delante. Las que ya pasaron siguen al lado, por si hay que
                corregir un ingreso.
              </p>
            </Card>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          {otras.length > 0 && (
            <section className="grp" style={{ margin: 0 }}>
              <div className="grp__h">
                <h2 className="lbl">{soloPasadas ? 'Funciones anteriores' : 'Otras funciones'}</h2>
                <span className="grp__n">{otras.length}</span>
              </div>
              <div className="card">
                {otras.map((fn) => (
                  <Row
                    key={fn.id}
                    title={nombre(fn)}
                    sub={`${cuando(fn)} · ${yaPaso(fn) ? `${fn.entered} de ${fn.sold} ingresaron` : `${fn.sold} emitidas`}`}
                    to={`/puerta/${fn.id}`}
                  />
                ))}
                {soloPasadas && (
                  <div className="card__f">
                    <span>Abrilas para corregir un ingreso mal marcado.</span>
                  </div>
                )}
              </div>
            </section>
          )}
          <Card title="Antes de abrir">
            <p className="rs" style={{ padding: '0 var(--s3) var(--s3)', margin: 0, whiteSpace: 'normal' }}>
              En la puerta conviene el celular: escanea los QR con la cámara. Desde la compu podés buscar
              por nombre y marcar ingresos a mano.
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}
