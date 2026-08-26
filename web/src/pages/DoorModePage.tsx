import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Moon, Sun } from 'lucide-react'
import { Html5Qrcode } from 'html5-qrcode'

import type { CheckinResponse, DoorTicket } from '../api/client'
import type { CheckinAttempt } from '../door/useDoorStore'
import { useDoorStore } from '../door/useDoorStore'
import { doorCounter, effectiveTickets } from '../door/logic'
import { filterTickets } from '../lib/search'

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
export type CamState = 'idle' | 'starting' | 'active' | 'denied' | 'unavailable'

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

  async function startCamera() {
    if (camState === 'starting' || camState === 'active') return
    if (!window.isSecureContext) {
      setCamState('unavailable')
      return
    }
    setCamState('starting')
    try {
      // El contenedor #door-scanner ya esta montado y con dimensiones reales.
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
      setCamState('active')
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
  onCheckin: (code: string) => void
}) {
  const [query, setQuery] = useState('')
  const found = filterTickets(tickets, query)

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
        {query.trim() !== '' && found.length === 0 && (
          <p className="muted" style={{ padding: '10px 2px' }}>
            No aparece. Probá con menos letras, o solo el apellido.
          </p>
        )}
        {found.slice(0, 20).map((ticket) => (
          <div key={ticket.code} className="door-ticket">
            <span>
              <strong>{ticket.buyer_name}</strong>
              {ticket.is_comp && ' · cortesía'}
              <br />
              <span className="muted" style={{ fontSize: 11.5 }}>le vendió {ticket.seller_name}</span>
            </span>
            {ticket.status === 'issued' ? (
              <button className="mark-btn" type="button" onClick={() => onCheckin(ticket.code)}>
                Marcar ingreso
              </button>
            ) : (
              <span className="muted" style={{ fontSize: 11.5, flexShrink: 0 }}>
                {ticket.status === 'checked_in' ? 'Ya entró' : 'Anulada'}
              </span>
            )}
          </div>
        ))}
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

export function DoorModePage() {
  const { functionId: raw } = useParams()
  const functionId = Number(raw)
  const navigate = useNavigate()

  const [night, setNight] = useState(() => localStorage.getItem(NIGHT_KEY) === '1')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [result, setResult] = useState<DisplayResult | null>(null)
  const timerRef = useRef<number | null>(null)

  const store = useDoorStore(functionId)
  useWakeLock()

  const { camState, startCamera } = useCamera(
    (payload) => void attempt({ method: 'scan', payload }),
    result === null && !sheetOpen,
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
          <SearchSheet tickets={tickets} onCheckin={(code) => void attempt({ method: 'manual', code })} />
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
            if (camState === 'idle' || camState === 'denied') void startCamera()
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
    </div>
  )
}
