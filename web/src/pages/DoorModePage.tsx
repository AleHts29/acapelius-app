import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'

import type { CheckinResponse, DoorTicket } from '../api/client'
import type { CheckinAttempt } from '../door/useDoorStore'
import { useDoorStore } from '../door/useDoorStore'
import { doorCounter, effectiveTickets } from '../door/logic'
import { filterTickets } from '../lib/search'

// Que muestra la pantalla de resultado a pantalla completa.
interface DisplayResult {
  ok: boolean
  title: string
  detail?: string
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
        title: 'Adelante',
        detail: `${resp.buyer_name} · le vendio ${resp.seller_name}`,
        autoCloseMs: 2000,
      }
    case 'already_checked_in':
      return {
        ok: false,
        title: 'Ya ingreso',
        detail: `${resp.buyer_name} entro ${resp.checked_in_at ? `a las ${timeOf(resp.checked_in_at)}` : 'antes'} (${resp.by_name ?? 'sin registro'})`,
        autoCloseMs: 4000,
      }
    case 'void':
      return { ok: false, title: 'Entrada anulada', detail: resp.buyer_name, autoCloseMs: 4000 }
    case 'wrong_function':
      return { ok: false, title: 'Es de otra funcion', detail: resp.buyer_name, autoCloseMs: 4000 }
    case 'invalid':
      return {
        ok: false,
        title: 'QR invalido',
        detail: 'No es una entrada de esta funcion.',
        autoCloseMs: 4000,
      }
  }
}

/** Overlay verde/rojo a pantalla completa; se cierra solo o con un tap. */
function ResultOverlay({ result, onClose }: { result: DisplayResult; onClose: () => void }) {
  useEffect(() => {
    navigator.vibrate?.(result.ok ? 120 : [90, 70, 90])
    const timer = setTimeout(onClose, result.autoCloseMs)
    return () => clearTimeout(timer)
  }, [result, onClose])

  return (
    <button
      type="button"
      className={`door-overlay ${result.ok ? 'door-overlay--ok' : 'door-overlay--bad'}`}
      onClick={onClose}
    >
      <span className="door-overlay__icon">{result.ok ? '✓' : '✕'}</span>
      <span className="door-overlay__title">{result.title}</span>
      {result.detail && <span className="door-overlay__detail">{result.detail}</span>}
      <span className="door-overlay__hint">toca para seguir</span>
    </button>
  )
}

/** Camara + html5-qrcode. Avisa cada payload leido; el padre decide. */
function Scanner({ onScan, enabled }: { onScan: (payload: string) => void; enabled: boolean }) {
  const [cameraError, setCameraError] = useState<string | null>(null)

  // Refs para que el callback de la camara (creado una sola vez) vea siempre
  // el estado actual sin reiniciar el scanner.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const lastRef = useRef<{ payload: string; at: number } | null>(null)

  useEffect(() => {
    const scanner = new Html5Qrcode('door-scanner', { verbose: false })
    let alive = true

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => {
          if (!enabledRef.current) return
          // La camara repite el mismo QR ~10 veces por segundo: se ignora el
          // mismo payload durante 3 segundos.
          const now = Date.now()
          const last = lastRef.current
          if (last && last.payload === text && now - last.at < 3000) return
          lastRef.current = { payload: text, at: now }
          onScanRef.current(text)
        },
        () => {}, // frames sin QR: ruido normal
      )
      .catch((err: unknown) => {
        if (alive) {
          setCameraError(
            err instanceof Error && err.message.includes('Permission')
              ? 'Sin permiso de camara. Habilitala para este sitio.'
              : 'No se pudo abrir la camara. El escaneo necesita HTTPS (o localhost).',
          )
        }
      })

    return () => {
      alive = false
      scanner
        .stop()
        .catch(() => {})
        .finally(() => scanner.clear())
    }
  }, [])

  return (
    <div className="door-scanner-wrap">
      <div id="door-scanner" />
      {cameraError && <p className="alert">{cameraError}</p>}
    </div>
  )
}

function ManualSearch({
  tickets,
  onCheckin,
}: {
  tickets: DoorTicket[]
  onCheckin: (code: string) => void
}) {
  const [query, setQuery] = useState('')
  const found = filterTickets(tickets, query)

  return (
    <div>
      <input
        className="field__input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Nombre de quien compro, o de la vendedora"
        aria-label="Buscar entrada"
        autoFocus
      />

      <div className="stack" style={{ marginTop: '0.75rem' }}>
        {query.trim() !== '' && found.length === 0 && (
          <p className="muted">No aparece. Proba con menos letras, o solo el apellido.</p>
        )}
        {found.slice(0, 20).map((ticket) => (
          <div key={ticket.code} className="panel door-ticket">
            <div>
              <strong>{ticket.buyer_name}</strong>
              {ticket.is_comp && <span className="badge" style={{ marginLeft: '0.5rem' }}>Cortesia</span>}
              <br />
              <span className="muted">le vendio {ticket.seller_name}</span>
            </div>
            {ticket.status === 'issued' ? (
              <button
                className="button"
                style={{ width: 'auto' }}
                type="button"
                onClick={() => onCheckin(ticket.code)}
              >
                Marcar ingreso
              </button>
            ) : (
              <span className="badge">{ticket.status === 'checked_in' ? 'Ya entro' : 'Anulada'}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Mantiene la pantalla prendida mientras el modo puerta esta abierto: en
 * plena fila nadie quiere desbloquear el celular entre escaneo y escaneo. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        // Denegado o sin soporte: la app funciona igual.
      }
    }
    void acquire()
    // Al volver de segundo plano el lock se pierde; se vuelve a pedir.
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

  const [tab, setTab] = useState<'scan' | 'search'>('scan')
  const [result, setResult] = useState<DisplayResult | null>(null)

  const store = useDoorStore(functionId)
  useWakeLock()

  if (!Number.isInteger(functionId)) {
    return <p className="alert">Funcion invalida.</p>
  }

  async function attempt(input: CheckinAttempt) {
    const verdict = await store.checkin(input)
    setResult(toDisplay(verdict))
  }

  if (store.loadError) {
    return <p className="alert">{store.loadError}</p>
  }
  if (!store.snapshot) {
    return <p className="muted">Cargando la lista de entradas...</p>
  }

  const { entered, issued } = doorCounter(store.snapshot, store.pending)
  const tickets = effectiveTickets(store.snapshot, store.pending)
  const fn = store.snapshot.function

  return (
    <>
      <div className="door-head">
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            {fn.name ?? fn.venue}
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            {fn.venue}
          </p>
        </div>
        <div className="door-counter" aria-label="Ingresados sobre emitidos">
          <span className="door-counter__big">{entered}</span>
          <span className="door-counter__small">/ {issued}</span>
        </div>
      </div>

      {/* Estado de conexion y de la cola (spec fase 4). El escaneo funciona
          igual sin conexion; esto solo informa. */}
      <div className={`door-status${store.online ? '' : ' door-status--offline'}`}>
        <span>{store.online ? '● En linea' : '○ Sin conexion — se sigue escaneando'}</span>
        {store.pending.length > 0 && (
          <span>
            {store.pending.length} sin sincronizar
          </span>
        )}
      </div>

      <div className="door-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'scan'}
          className={`door-tab${tab === 'scan' ? ' door-tab--active' : ''}`}
          onClick={() => setTab('scan')}
        >
          Escanear
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'search'}
          className={`door-tab${tab === 'search' ? ' door-tab--active' : ''}`}
          onClick={() => setTab('search')}
        >
          Buscar por nombre
        </button>
      </div>

      {tab === 'scan' ? (
        <Scanner
          enabled={result === null}
          onScan={(payload) => void attempt({ method: 'scan', payload })}
        />
      ) : (
        <ManualSearch
          tickets={tickets}
          onCheckin={(code) => void attempt({ method: 'manual', code })}
        />
      )}

      {result && <ResultOverlay result={result} onClose={() => setResult(null)} />}
    </>
  )
}
