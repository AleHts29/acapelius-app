import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'

import type { CheckinResponse, DoorCheckin, DoorTicket } from '../api/client'
import type { CheckinAttempt } from '../door/useDoorStore'
import { useDoorStore } from '../door/useDoorStore'
import { doorCounter, effectiveCheckins, effectiveTickets, nocturnoPorDefecto } from '../door/logic'
import { filterTickets, groupByBuyer } from '../lib/search'
import { useIsDesktop } from '../lib/viewport'
import { Button, Search } from '../ui/Button'
import { Card } from '../ui/Card'
import { Heel } from '../ui/Heel'
import { Row } from '../ui/Row'
import { Status } from '../ui/Status'

// Preferencia por dispositivo del modo nocturno (design system §3.7).
const NIGHT_KEY = 'acapelius-door-night'

interface DisplayResult {
  ok: boolean
  title: string
  detail?: string
  seal?: string
  autoCloseMs: number
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

function toDisplay(resp: CheckinResponse): DisplayResult {
  switch (resp.result) {
    case 'ok':
      return {
        ok: true,
        title: resp.buyer_name ?? 'Adelante',
        detail: `Le vendió ${resp.seller_name}`,
        seal: `Sello Acapelius · ${resp.checked_in_at ? timeOf(resp.checked_in_at) : ''}`,
        autoCloseMs: 2500,
      }
    case 'already_checked_in':
      return {
        ok: false,
        title: `Ya entró · ${resp.buyer_name ?? 'esta entrada'}`,
        detail: `${resp.checked_in_at ? `A las ${timeOf(resp.checked_in_at)}` : 'Antes'}${resp.by_name ? ` · la escaneó ${resp.by_name}` : ''}`,
        autoCloseMs: 5000,
      }
    case 'void':
      return { ok: false, title: 'Entrada anulada', detail: resp.buyer_name, autoCloseMs: 5000 }
    case 'wrong_function':
      return { ok: false, title: 'Es de otra función', detail: resp.buyer_name, autoCloseMs: 5000 }
    case 'invalid':
      return { ok: false, title: 'QR inválido', detail: 'No es una entrada de esta función.', autoCloseMs: 5000 }
  }
}

/** Estados del viewfinder (CAMBIOS_V2 §C4): nunca fallar en silencio. */
export type CamState = 'idle' | 'starting' | 'active' | 'denied' | 'unavailable' | 'blank'

/** Espera a que el navegador pinte: dos frames alcanzan para que el layout
 * quede firme despues de un cambio de estado de React. */
function afterLayout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/**
 * Espera a que el video de la camara tenga imagen de verdad. html5-qrcode
 * resuelve start() apenas arranca el track, pero si midio el contenedor en
 * cero el video queda de 0px: la promesa dice "listo" y la pantalla queda
 * vacia. Esto lo detecta para poder mostrarlo en vez de fingir que anda.
 */
async function videoPinta(timeoutMs = 3500): Promise<boolean> {
  const limit = Date.now() + timeoutMs
  while (Date.now() < limit) {
    const video = document.querySelector<HTMLVideoElement>('#door-scanner video')
    if (video && video.videoWidth > 0 && video.clientWidth > 0 && video.clientHeight > 0) {
      return true
    }
    await afterLayout()
  }
  return false
}

/**
 * Maneja la camara con html5-qrcode. La camara se enciende SOLO por tap
 * (iOS Safari bloquea getUserMedia sin gesto) y cada error termina en un
 * estado visible con instrucciones.
 */
function useCamera(onScan: (payload: string) => void, enabled: boolean) {
  const [camState, setCamState] = useState<CamState>(() =>
    window.isSecureContext ? 'idle' : 'unavailable',
  )
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const lastRef = useRef<{ payload: string; at: number } | null>(null)

  async function stopScanner() {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      await scanner.stop()
    } catch {
      // Ya estaba frenada: no hay nada que hacer.
    }
  }

  async function startCamera() {
    if (camState === 'starting' || camState === 'active') return
    if (!window.isSecureContext) {
      setCamState('unavailable')
      return
    }
    setCamState('starting')
    // Un reintento parte de una camara ya arrancada: primero se la frena.
    await stopScanner()
    // html5-qrcode mide el contenedor al arrancar. Si se lo llama en el mismo
    // tick en que se cierra la busqueda, mide el layout viejo (o cero) y el
    // video queda invisible aunque la camara este andando: por eso se espera
    // a que el navegador pinte antes de medir.
    await afterLayout()
    try {
      scannerRef.current ??= new Html5Qrcode('door-scanner', { verbose: false })
      await scannerRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (text) => {
          if (!enabledRef.current) return
          const now = Date.now()
          const last = lastRef.current
          if (last && last.payload === text && now - last.at < 3000) return
          lastRef.current = { payload: text, at: now }
          onScanRef.current(text)
        },
        () => {}, // frames sin QR: ruido normal
      )
      // La camara arranco, pero eso no garantiza que se vea: si el video no
      // pinta, se frena y se dice, en vez de dejar el recuadro vacio.
      if (await videoPinta()) {
        setCamState('active')
      } else {
        console.error('[puerta] la camara arranco pero el video no pinta')
        await stopScanner()
        setCamState('blank')
      }
    } catch (err) {
      console.error('[puerta] no se pudo iniciar la camara:', err)
      const message = err instanceof Error ? `${err.name} ${err.message}` : String(err)
      setCamState(/NotAllowed|Permission|denied/i.test(message) ? 'denied' : 'unavailable')
    }
  }

  useEffect(() => {
    return () => {
      const scanner = scannerRef.current
      if (scanner) {
        scanner
          .stop()
          .catch(() => {})
          .finally(() => scanner.clear())
      }
    }
  }, [])

  return { camState, startCamera }
}

/** Zona de camara con sus estados visibles: nunca falla en silencio. */
function CameraStage({
  camState,
  onStart,
}: {
  camState: CamState
  onStart: () => void
}) {
  return (
    <div className="door__scan">
      <div id="door-scanner" />
      {camState === 'idle' && (
        // Un solo "Escanear" en pantalla: el de abajo. Acá sólo se explica.
        <div className="camstate">
          <p className="camstate__t">Cámara apagada</p>
          <p className="camstate__h">Se enciende con un toque en Escanear</p>
        </div>
      )}
      {camState === 'starting' && (
        <div className="camstate" aria-live="polite">
          <p className="camstate__h">Iniciando cámara…</p>
        </div>
      )}
      {camState === 'denied' && (
        <div className="camstate" role="alert">
          <p className="camstate__t">Sin permiso de cámara</p>
          <p className="camstate__h">
            iPhone: Ajustes → Safari → Cámara → Permitir.
            <br />
            Android: candado en la barra de dirección → Permisos → Cámara.
          </p>
          <Button go onClick={onStart}>
            Reintentar
          </Button>
        </div>
      )}
      {camState === 'blank' && (
        <div className="camstate" role="alert">
          <p className="camstate__t">La cámara no se ve</p>
          <p className="camstate__h">
            Se encendió pero no llega imagen. Probá de nuevo; si sigue igual, cerrá y volvé a abrir
            la app. Mientras tanto usá <strong>Buscar por nombre</strong>.
          </p>
          <Button go onClick={onStart}>
            Reintentar
          </Button>
        </div>
      )}
      {camState === 'unavailable' && (
        <div className="camstate" role="alert">
          <p className="camstate__t">La cámara no está disponible</p>
          <p className="camstate__h">
            {window.isSecureContext
              ? 'Este dispositivo no tiene una cámara utilizable.'
              : 'El escaneo necesita una conexión segura (HTTPS).'}{' '}
            Usá <strong>Buscar por nombre</strong>: encontrás a la persona y marcás el ingreso con un
            toque.
          </p>
        </div>
      )}
      {camState === 'active' && <p className="door__hint">Apuntá al QR de la entrada</p>}
    </div>
  )
}

/**
 * Una compra en los resultados de búsqueda: quién, cuántas entraron, y los
 * botones para marcar. "Solo 1" existe porque llega uno y los demás después.
 */
function Compra({
  grupo,
  on,
  onCheckin,
}: {
  grupo: ReturnType<typeof groupByBuyer>[number]
  on?: boolean
  onCheckin: (codes: string[]) => void
}) {
  const faltan = grupo.pending.length
  return (
    <Row
      title={grupo.buyerName}
      sub={`${grupo.total === 1 ? '1 entrada' : `${grupo.entered} de ${grupo.total} entraron`} · le vendió ${grupo.sellerName}${grupo.isComp ? ' · cortesía' : ''}`}
      on={on}
      status={
        faltan === 0 ? (
          <Status tone="bad">Ya entró</Status>
        ) : (
          <span style={{ display: 'flex', gap: 'var(--s1)' }}>
            {faltan > 1 && <Button onClick={() => onCheckin([grupo.pending[0].code])}>Solo 1</Button>}
            <Button go={on !== false} onClick={() => onCheckin(grupo.pending.map((t) => t.code))}>
              {faltan === 1 ? 'Marcar ingreso' : `Marcar ${faltan === grupo.total ? 'las' : 'las otras'} ${faltan}`}
            </Button>
          </span>
        )
      }
    />
  )
}

function SearchSheet({
  tickets,
  inicial = '',
  onCheckin,
}: {
  tickets: DoorTicket[]
  /** Búsqueda que llega de Asistencia ("Marcar"). */
  inicial?: string
  /** Marca de una las entradas que se le pasen (una compra entera, o una sola). */
  onCheckin: (codes: string[]) => void
}) {
  const [query, setQuery] = useState(inicial)
  const grupos = groupByBuyer(filterTickets(tickets, query))

  return (
    <div className="door__results">
      <div style={{ display: 'flex', padding: 'var(--s3) var(--s3) var(--s2)' }}>
        <Search
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nombre de quien compró, o de la corista"
          aria-label="Buscar entrada"
          autoFocus
        />
      </div>
      {query.trim() !== '' && grupos.length === 0 && (
        <Row title="No aparece" sub="Probá con menos letras, o sólo el apellido" />
      )}
      {grupos.slice(0, 20).map((grupo) => (
        <Compra key={grupo.key} grupo={grupo} onCheckin={onCheckin} />
      ))}
    </div>
  )
}

/** Mantiene la pantalla prendida mientras la puerta esta abierta. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        // Sin soporte o denegado: la app funciona igual.
      }
    }
    void acquire()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [])
}

/**
 * La mesa de entrada: el modo puerta en escritorio. No hay cámara —nadie
 * escanea un QR con la webcam de una notebook— así que html5-qrcode ni se
 * monta. Todo gira alrededor de la búsqueda, pensada para teclado: se
 * escribe, se baja con las flechas y se marca con Enter.
 */
function EntryDesk({
  tickets,
  inicial = '',
  onCheckin,
}: {
  tickets: DoorTicket[]
  /** Búsqueda que llega de Asistencia ("Marcar"). */
  inicial?: string
  onCheckin: (codes: string[]) => void
}) {
  const [query, setQuery] = useState(inicial)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const grupos = groupByBuyer(filterTickets(tickets, query)).slice(0, 8)
  // Si la lista se acorta al seguir escribiendo, el cursor no puede quedar afuera.
  const activo = Math.min(cursor, Math.max(grupos.length - 1, 0))

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function marcar(codes: string[]) {
    onCheckin(codes)
    setQuery('')
    setCursor(0)
    inputRef.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (grupos.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, grupos.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const grupo = grupos[activo]
      if (grupo && grupo.pending.length > 0) {
        // Enter marca la compra entera; para uno solo está el botón "Solo 1".
        marcar(grupo.pending.map((t) => t.code))
      }
    }
  }

  return (
    <section className="grp" style={{ margin: 0 }}>
      <div className="bar">
        <input
          ref={inputRef}
          className="search"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Nombre de quien compró, o de la corista"
          aria-label="Buscar entrada"
        />
      </div>
      {(query.trim() !== '' || grupos.length > 0) && (
        <>
          <div className="grp__h">
            <h2 className="lbl">Resultados</h2>
            <span className="grp__n">↑ ↓ para moverte · Enter marca</span>
          </div>
          <div className="card">
            {grupos.length === 0 ? (
              <Row title="No aparece" sub="Probá con menos letras, o sólo el apellido" />
            ) : (
              grupos.map((grupo, i) => (
                <div key={grupo.key} onMouseEnter={() => setCursor(i)}>
                  <Compra grupo={grupo} on={i === activo} onCheckin={marcar} />
                </div>
              ))
            )}
          </div>
        </>
      )}
      <p className="rs" style={{ whiteSpace: 'normal', marginTop: 'var(--s2)' }}>
        Para escanear QRs usá el celular: esta mesa resuelve búsquedas e ingresos manuales.
      </p>
    </section>
  )
}

/** Los últimos ingresos y quién está en la puerta, al costado de la mesa. */
function Costado({ tickets, checkins }: { tickets: DoorTicket[]; checkins: DoorCheckin[] }) {
  const porCodigo = new Map(tickets.map((t) => [t.code, t]))
  const ultimos = [...checkins].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6)
  const enLaPuerta = new Map<string, number>()
  for (const c of checkins) enLaPuerta.set(c.by_name, (enLaPuerta.get(c.by_name) ?? 0) + 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <Card title="Últimos ingresos">
        {ultimos.length === 0 ? (
          <Row title="Todavía no entró nadie" />
        ) : (
          ultimos.map((c) => (
            <div key={c.ticket_code + c.created_at} className="feed">
              <span className="feed__t">{timeOf(c.created_at)}</span>
              <div>
                <div className="rt">{porCodigo.get(c.ticket_code)?.buyer_name ?? 'Entrada'}</div>
                <div className="rs">{c.method === 'scan' ? 'escaneo' : 'manual'}</div>
              </div>
              <span className="rs">{c.by_name}</span>
            </div>
          ))
        )}
      </Card>
      {enLaPuerta.size > 0 && (
        <Card title="Quién está en la puerta">
          {[...enLaPuerta.entries()].map(([nombre, n]) => (
            <Row key={nombre} title={nombre} amount={n} unit={n === 1 ? 'ingreso' : 'ingresos'} />
          ))}
        </Card>
      )}
    </div>
  )
}

export function DoorModePage() {
  const { functionId: raw } = useParams()
  // ?buscar= llega del "Marcar" de Asistencia: la búsqueda arranca con ese
  // nombre y el ingreso pasa por el flujo de siempre de la puerta.
  const [searchParams] = useSearchParams()
  const buscar = searchParams.get('buscar') ?? ''
  const functionId = Number(raw)
  const navigate = useNavigate()

  // Nocturno (AFICHE_APP_SPEC §6): de noche el papel encandila, asi que para
  // una funcion que empieza despues de las 19 arranca en nocturno. Si la
  // persona lo cambio alguna vez, manda su preferencia (guardada por
  // dispositivo); hasta entonces se decide por la hora de la funcion.
  const [nightPref, setNightPref] = useState<boolean | null>(() => {
    const saved = localStorage.getItem(NIGHT_KEY)
    return saved === null ? null : saved === '1'
  })
  const [sheetOpen, setSheetOpen] = useState(buscar !== '')
  const [result, setResult] = useState<DisplayResult | null>(null)
  const timerRef = useRef<number | null>(null)

  const store = useDoorStore(functionId)
  const escritorio = useIsDesktop()
  useWakeLock()

  // En escritorio la cámara no se enciende nunca: `enabled` en false deja el
  // hook inerte y el botón de escanear no se renderiza, así que html5-qrcode
  // no llega a montarse (C11).
  const { camState, startCamera } = useCamera(
    (payload) => void attempt({ method: 'scan', payload }),
    !escritorio && result === null && !sheetOpen,
  )

  function toggleNight() {
    const next = !night
    setNightPref(next)
    localStorage.setItem(NIGHT_KEY, next ? '1' : '0')
  }

  function showResult(display: DisplayResult) {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    navigator.vibrate?.(display.ok ? 120 : [90, 70, 90])
    setResult(display)
    timerRef.current = window.setTimeout(() => setResult(null), display.autoCloseMs)
  }

  function clearResult() {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    setResult(null)
  }

  async function attempt(input: CheckinAttempt) {
    const verdict = await store.checkin(input)
    setSheetOpen(false)
    showResult(toDisplay(verdict))
  }

  /**
   * Marca varias entradas de una misma compra (la familia que llega junta).
   * Se muestra un solo cartel: repetir el verde tres veces no le sirve a nadie
   * en la puerta. Si alguna sale mal, manda esa.
   */
  async function attemptGroup(codes: string[]) {
    if (codes.length === 1) {
      await attempt({ method: 'manual', code: codes[0] })
      return
    }
    const verdicts: CheckinResponse[] = []
    for (const code of codes) {
      verdicts.push(await store.checkin({ method: 'manual', code }))
    }
    setSheetOpen(false)
    const problema = verdicts.find((v) => v.result !== 'ok')
    if (problema) {
      showResult(toDisplay(problema))
      return
    }
    const primero = verdicts[0]
    showResult({
      ok: true,
      title: primero.buyer_name ?? 'Adelante',
      detail: `${verdicts.length} entradas · le vendió ${primero.seller_name}`,
      seal: `Sello Acapelius · ${primero.checked_in_at ? timeOf(primero.checked_in_at) : ''}`,
      autoCloseMs: 2500,
    })
  }

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  if (!Number.isInteger(functionId)) {
    return <p className="alert">Función inválida.</p>
  }

  if (store.loadError) {
    return (
      <div className="door">
        <div className="door__top">
          <Button onClick={() => navigate('/puerta')}>‹ Salir</Button>
        </div>
        <p className="st st--bad" role="alert" style={{ whiteSpace: 'normal' }}>
          {store.loadError}
        </p>
      </div>
    )
  }

  const snapshot = store.snapshot
  const night = nightPref ?? nocturnoPorDefecto(snapshot?.function.starts_at)
  const { entered, issued } = snapshot ? doorCounter(snapshot, store.pending) : { entered: 0, issued: 0 }
  const tickets = snapshot ? effectiveTickets(snapshot, store.pending) : []
  const checkins = snapshot ? effectiveCheckins(snapshot, store.pending) : []
  const fn = snapshot?.function

  const talon = (
    <Heel label={fn ? `${fn.name ?? fn.venue} · ${timeOf(fn.starts_at)}` : 'Puerta'}>
      <div className="heel__n" style={{ marginTop: 6 }} aria-live="polite">
        {entered} <span>de {issued} ingresaron</span>
      </div>
    </Heel>
  )

  return (
    // El nocturno es el modo oscuro de los tokens, sólo para la puerta del
    // celular: de noche, en la sala, el papel encandila. En la mesa de
    // escritorio manda el modo de la app.
    <div className="door" data-theme={escritorio ? undefined : night ? 'dark' : 'light'}>
      <div className="door__top">
        <Button onClick={() => navigate('/puerta')}>‹ Salir</Button>
        {store.online ? <Status tone="ok">En línea</Status> : <Status tone="warn">Sin conexión</Status>}
        {!escritorio && (
          <Button onClick={toggleNight} aria-pressed={night}>
            {night ? 'Modo claro' : 'Modo nocturno'}
          </Button>
        )}
      </div>

      {!store.online && (
        <p className="banner" role="status" style={{ margin: 0 }}>
          <b>Seguí escaneando</b>: la lista está guardada en el teléfono y se sincroniza sola.
          {store.pending.length > 0 &&
            ` ${store.pending.length} ${store.pending.length === 1 ? 'ingreso espera' : 'ingresos esperan'} para subir.`}
        </p>
      )}

      {escritorio ? (
        <div className="asym">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
            {talon}
            <EntryDesk tickets={tickets} inicial={buscar} onCheckin={(codes) => void attemptGroup(codes)} />
          </div>
          <Costado tickets={tickets} checkins={checkins} />
        </div>
      ) : (
        <>
          {talon}
          <div className="door__stage">
            <CameraStage camState={camState} onStart={() => void startCamera()} />
            {result && (
              <button
                type="button"
                className={`verdict ${result.ok ? 'verdict--ok' : 'verdict--bad'}`}
                onClick={clearResult}
                aria-live="assertive"
              >
                <span className="verdict__i" aria-hidden>
                  {result.ok ? '✓' : '✕'}
                </span>
                <span className="verdict__n">{result.title}</span>
                {result.detail && <span className="verdict__d">{result.detail}</span>}
                {result.seal && <span className="verdict__s">{result.seal}</span>}
              </button>
            )}
            {sheetOpen && !result && (
              <SearchSheet tickets={tickets} inicial={buscar} onCheckin={(codes) => void attemptGroup(codes)} />
            )}
          </div>

          <div className="door__btns">
            <button
              className="btn door__btn"
              type="button"
              onClick={() => {
                clearResult()
                setSheetOpen(!sheetOpen)
              }}
            >
              {sheetOpen ? 'Cerrar búsqueda' : 'Buscar por nombre'}
            </button>
            <button
              className="btn btn--go door__btn"
              type="button"
              onClick={() => {
                clearResult()
                setSheetOpen(false)
                if (camState === 'idle' || camState === 'denied' || camState === 'blank') {
                  void startCamera()
                }
              }}
            >
              {result
                ? 'Siguiente escaneo'
                : sheetOpen
                  ? 'Volver a escanear'
                  : camState === 'active'
                    ? 'Escaneando…'
                    : camState === 'starting'
                      ? 'Iniciando…'
                      : 'Escanear'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
