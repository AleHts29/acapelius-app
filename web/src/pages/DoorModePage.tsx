import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Moon, Search, Sun } from 'lucide-react'
import { Html5Qrcode } from 'html5-qrcode'

import type { CheckinResponse, DoorCheckin, DoorTicket } from '../api/client'
import type { CheckinAttempt } from '../door/useDoorStore'
import { useDoorStore } from '../door/useDoorStore'
import { doorCounter, effectiveCheckins, effectiveTickets } from '../door/logic'
import { filterTickets, groupByBuyer, initials } from '../lib/search'
import { useIsDesktop } from '../lib/viewport'
import { Hl } from '../ui/controls'
import { CounterChip } from '../ui/StatusChip'

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
        title: resp.buyer_name ?? 'Ya ingresó',
        detail: `Ya ingresó ${resp.checked_in_at ? `a las ${timeOf(resp.checked_in_at)}` : 'antes'} · ${resp.by_name ?? ''}`,
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

/** Zona de camara con sus cuatro estados visibles. */
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
        <div className="camstate">
          <button className="camstate__start" type="button" onClick={onStart}>
            Escanear
          </button>
          <p className="camstate__hint">La cámara se enciende con un toque</p>
        </div>
      )}
      {camState === 'starting' && (
        <div className="camstate" aria-live="polite">
          <span className="camstate__spinner" aria-hidden />
          <p className="camstate__hint">Iniciando cámara…</p>
        </div>
      )}
      {camState === 'denied' && (
        <div className="camstate" role="alert">
          <p className="camstate__title">Sin permiso de cámara</p>
          <p className="camstate__hint">
            iPhone: Ajustes → Safari → Cámara → Permitir.
            <br />
            Android: candado en la barra de dirección → Permisos → Cámara.
          </p>
          <button className="camstate__start" type="button" onClick={onStart}>
            Reintentar
          </button>
        </div>
      )}
      {camState === 'blank' && (
        <div className="camstate" role="alert">
          <p className="camstate__title">La cámara no se ve</p>
          <p className="camstate__hint">
            Se encendió pero no llega imagen. Probá de nuevo; si sigue igual,
            cerrá y volvé a abrir la app.
            <br />
            Mientras tanto usá <strong>Buscar nombre</strong>.
          </p>
          <button className="camstate__start" type="button" onClick={onStart}>
            Reintentar
          </button>
        </div>
      )}
      {camState === 'unavailable' && (
        <div className="camstate" role="alert">
          <p className="camstate__title">La cámara no está disponible</p>
          <p className="camstate__hint">
            {window.isSecureContext
              ? 'Este dispositivo no tiene una cámara utilizable.'
              : 'El escaneo necesita una conexión segura (HTTPS).'}
            <br />
            Usá <strong>Buscar nombre</strong>: encontrás a la persona y marcás el ingreso con un toque.
          </p>
        </div>
      )}
      {camState === 'active' && <p className="door__scan-hint">Apuntá al QR de la entrada</p>}
    </div>
  )
}

function SearchSheet({
  tickets,
  onCheckin,
}: {
  tickets: DoorTicket[]
  /** Marca de una las entradas que se le pasen (una compra entera, o una sola). */
  onCheckin: (codes: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const grupos = groupByBuyer(filterTickets(tickets, query))

  return (
    <div className="door__sheet">
      <input
        className="field__input"
        style={{ marginTop: 0 }}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Nombre de quien compró, o de la corista"
        aria-label="Buscar entrada"
        autoFocus
      />
      <div className="door__results">
        {query.trim() !== '' && grupos.length === 0 && (
          <p className="muted" style={{ padding: '10px 2px' }}>
            No aparece. Probá con menos letras, o solo el apellido.
          </p>
        )}
        {grupos.slice(0, 20).map((grupo) => {
          const faltan = grupo.pending.length
          return (
            <div key={grupo.key} className="door-ticket">
              <span>
                <strong>{grupo.buyerName}</strong>
                {grupo.isComp && ' · cortesía'}
                <br />
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {grupo.total === 1 ? '1 entrada' : `${grupo.entered} de ${grupo.total} entraron`}
                  {' · le vendió '}
                  {grupo.sellerName}
                </span>
              </span>
              {faltan === 0 ? (
                <span className="muted" style={{ fontSize: 11.5, flexShrink: 0 }}>
                  Ya entró
                </span>
              ) : (
                <span className="door-ticket__acts">
                  <button
                    className="mark-btn"
                    type="button"
                    onClick={() => onCheckin(grupo.pending.map((t) => t.code))}
                  >
                    {faltan === 1 ? 'Marcar ingreso' : `Marcar ${faltan === grupo.total ? 'las' : 'las otras'} ${faltan}`}
                  </button>
                  {faltan > 1 && (
                    <button
                      className="mark-btn mark-btn--one"
                      type="button"
                      onClick={() => onCheckin([grupo.pending[0].code])}
                    >
                      Solo 1
                    </button>
                  )}
                </span>
              )}
            </div>
          )
        })}
      </div>
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
 * La mesa de entrada (C11, frame 5): el modo puerta en escritorio. No hay
 * cámara —nadie escanea un QR con la webcam de una notebook— así que
 * html5-qrcode ni se monta. Todo gira alrededor de la búsqueda, pensada para
 * teclado: se escribe, se baja con las flechas y se marca con Enter, sin
 * soltar las manos.
 */
function EntryDesk({
  tickets,
  checkins,
  onCheckin,
}: {
  tickets: DoorTicket[]
  checkins: DoorCheckin[]
  onCheckin: (codes: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const grupos = groupByBuyer(filterTickets(tickets, query)).slice(0, 8)
  // Si la lista se acorta al seguir escribiendo, el cursor no puede quedar afuera.
  const activo = Math.min(cursor, Math.max(grupos.length - 1, 0))

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Nombre del comprador por código, para los últimos ingresos.
  const porCodigo = new Map(tickets.map((t) => [t.code, t]))
  const ultimos = [...checkins]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6)

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
    <div className="desk">
      <div className="desk__search">
        <Search size={20} aria-hidden />
        <input
          ref={inputRef}
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

      {query.trim() !== '' && grupos.length === 0 && (
        <p className="muted" style={{ padding: '12px 2px' }}>
          No aparece. Probá con menos letras, o solo el apellido.
        </p>
      )}

      {grupos.map((grupo, i) => {
        const faltan = grupo.pending.length
        return (
          <div
            key={grupo.key}
            className={`desk__row${i === activo ? ' desk__row--on' : ''}`}
            onMouseEnter={() => setCursor(i)}
          >
            <span className={`ini${faltan === 0 ? ' ini--ok' : ''}`}>{initials(grupo.buyerName)}</span>
            <span className="desk__mid">
              <b>
                <Hl text={grupo.buyerName} q={query} />
              </b>
              <span>
                le vendió {grupo.sellerName} · {grupo.total}{' '}
                {grupo.total === 1 ? 'entrada' : 'entradas'}
                {faltan > 0 && faltan < grupo.total && ` · falta${faltan === 1 ? '' : 'n'} ${faltan}`}
              </span>
            </span>
            <CounterChip count={grupo.entered} total={grupo.total} />
            <span className="desk__acts">
              <button
                className="mark-btn"
                type="button"
                disabled={faltan === 0}
                onClick={() => marcar(grupo.pending.map((t) => t.code))}
              >
                {faltan === 0
                  ? 'Ya ingresó'
                  : faltan === 1
                    ? 'Marcar ingreso'
                    : `Marcar ${faltan === grupo.total ? 'las' : 'las otras'} ${faltan}`}
              </button>
              {/* Llega uno solo y los demás vienen después: no hay que
                  marcarlos a todos de prepo. */}
              {faltan > 1 && (
                <button
                  className="mark-btn mark-btn--one"
                  type="button"
                  onClick={() => marcar([grupo.pending[0].code])}
                >
                  Solo 1
                </button>
              )}
            </span>
          </div>
        )
      })}

      {grupos.length > 0 && (
        <p className="desk__kbd">
          <kbd>↑</kbd> <kbd>↓</kbd> para moverte · <kbd>Enter</kbd> marca el ingreso
        </p>
      )}

      {ultimos.length > 0 && (
        <>
          <div className="ghead">
            <b>Últimos ingresos</b>
          </div>
          {ultimos.map((c) => (
            <div key={c.ticket_code + c.created_at} className="desk__last">
              <span>
                <b>{porCodigo.get(c.ticket_code)?.buyer_name ?? 'Entrada'}</b>{' '}
                <span className="muted">
                  {c.method === 'scan' ? 'escaneo' : 'manual'} · {c.by_name}
                </span>
              </span>
              <span className="muted">{timeOf(c.created_at)}</span>
            </div>
          ))}
        </>
      )}

      <p className="desk__tip">
        Para escanear QRs usá el celular — esta mesa resuelve búsquedas e ingresos manuales.
      </p>
    </div>
  )
}

export function DoorModePage() {
  const { functionId: raw } = useParams()
  const functionId = Number(raw)
  const navigate = useNavigate()

  const [night, setNight] = useState(() => localStorage.getItem(NIGHT_KEY) === '1')
  const [sheetOpen, setSheetOpen] = useState(false)
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
    setNight(next)
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
          <button className="door__exit" type="button" onClick={() => navigate('/puerta')}>
            <ChevronLeft size={18} aria-hidden /> Salir
          </button>
        </div>
        <p className="alert">{store.loadError}</p>
      </div>
    )
  }

  const snapshot = store.snapshot
  const { entered, issued } = snapshot ? doorCounter(snapshot, store.pending) : { entered: 0, issued: 0 }
  const tickets = snapshot ? effectiveTickets(snapshot, store.pending) : []

  return (
    <div className={`door${night ? ' night' : ''}`}>
      <div className="door__top">
        <button className="door__exit" type="button" onClick={() => navigate('/puerta')}>
          <ChevronLeft size={18} aria-hidden /> Salir
        </button>
        <button className="door__night" type="button" onClick={toggleNight} aria-pressed={night}>
          {night ? <Sun size={13} aria-hidden style={{ verticalAlign: -2 }} /> : <Moon size={13} aria-hidden style={{ verticalAlign: -2 }} />}{' '}
          {night ? 'Modo claro' : 'Modo nocturno'}
        </button>
      </div>

      <div className="door__head">
        <div className="door__fn">{snapshot ? (snapshot.function.name ?? snapshot.function.venue) : 'Puerta'}</div>
        <div className={`net${store.online ? '' : ' net--off'}`}>
          {store.online
            ? '● En línea'
            : `⬤ Sin conexión${store.pending.length > 0 ? ` · ${store.pending.length} por sincronizar` : ''}`}
        </div>
      </div>

      <div className="door__counter" aria-live="polite">
        <div className="n">
          {entered}
          <span> / {issued}</span>
        </div>
        <div className="st">INGRESARON</div>
      </div>

      {escritorio ? (
        <EntryDesk
          tickets={tickets}
          checkins={snapshot ? effectiveCheckins(snapshot, store.pending) : []}
          onCheckin={(codes) => void attemptGroup(codes)}
        />
      ) : (
      <>
      <div className="door__stage">
        <CameraStage camState={camState} onStart={() => void startCamera()} />
        {result && (
          <button
            type="button"
            className={`verdict ${result.ok ? 'verdict--ok' : 'verdict--bad'}`}
            onClick={clearResult}
            aria-live="assertive"
          >
            <span className="verdict__ring" aria-hidden>{result.ok ? '✓' : '✕'}</span>
            <span className="verdict__who">{result.title}</span>
            {result.detail && <span className="verdict__det">{result.detail}</span>}
            {result.seal && <span className="verdict__seal">{result.seal}</span>}
          </button>
        )}
        {sheetOpen && !result && (
          <SearchSheet tickets={tickets} onCheckin={(codes) => void attemptGroup(codes)} />
        )}
      </div>

      <div className="door__btns">
        <button
          className="door__btn"
          type="button"
          onClick={() => {
            clearResult()
            setSheetOpen(!sheetOpen)
          }}
        >
          {sheetOpen ? 'Cerrar búsqueda' : 'Buscar nombre'}
        </button>
        <button
          className="door__btn door__btn--primary"
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
