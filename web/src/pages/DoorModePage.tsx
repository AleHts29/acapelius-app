import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Html5Qrcode } from 'html5-qrcode'

import { ApiError, api } from '../api/client'
import type { CheckinInput, CheckinResponse, DoorTicket } from '../api/client'
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
        detail: `${resp.buyer_name} entro a las ${resp.checked_in_at ? timeOf(resp.checked_in_at) : '?'} (lo marco ${resp.by_name})`,
        autoCloseMs: 4000,
      }
    case 'void':
      return { ok: false, title: 'Entrada anulada', detail: resp.buyer_name, autoCloseMs: 4000 }
    case 'wrong_function':
      return {
        ok: false,
        title: 'Es de otra funcion',
        detail: resp.buyer_name,
        autoCloseMs: 4000,
      }
    case 'invalid':
      return { ok: false, title: 'QR invalido', detail: 'No es una entrada de este sistema.', autoCloseMs: 4000 }
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
  busy,
}: {
  tickets: DoorTicket[]
  onCheckin: (code: string) => void
  busy: boolean
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
                disabled={busy}
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

export function DoorModePage() {
  const { functionId: raw } = useParams()
  const functionId = Number(raw)
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<'scan' | 'search'>('scan')
  const [result, setResult] = useState<DisplayResult | null>(null)

  const snapshot = useQuery({
    queryKey: ['door-snapshot', functionId],
    queryFn: () => api.doorSnapshot(functionId),
    enabled: Number.isInteger(functionId),
    // Refresco periodico mientras hay conexion (spec §6.5).
    refetchInterval: 30_000,
  })

  const checkin = useMutation({
    mutationFn: (input: CheckinInput) => api.checkin(input),
    onSuccess: (resp) => {
      setResult(toDisplay(resp))
      void queryClient.invalidateQueries({ queryKey: ['door-snapshot', functionId] })
    },
    onError: (err) => {
      setResult({
        ok: false,
        title: err instanceof ApiError && err.code === 'network_error' ? 'Sin conexion' : 'Error',
        detail:
          err instanceof ApiError && err.code === 'network_error'
            ? 'El modo offline llega en la proxima version.'
            : 'No se pudo registrar. Proba de nuevo.',
        autoCloseMs: 4000,
      })
    },
  })

  if (!Number.isInteger(functionId)) {
    return <p className="alert">Funcion invalida.</p>
  }

  const tickets = snapshot.data?.tickets ?? []
  const issued = tickets.filter((t) => t.status !== 'void').length
  const entered = tickets.filter((t) => t.status === 'checked_in').length
  const fn = snapshot.data?.function

  return (
    <>
      <div className="door-head">
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            {fn ? (fn.name ?? fn.venue) : 'Puerta'}
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            {fn?.venue}
          </p>
        </div>
        <div className="door-counter" aria-label="Ingresados sobre emitidos">
          <span className="door-counter__big">{entered}</span>
          <span className="door-counter__small">/ {issued}</span>
        </div>
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
          enabled={result === null && !checkin.isPending}
          onScan={(payload) =>
            checkin.mutate({ function_id: functionId, method: 'scan', payload })
          }
        />
      ) : (
        <ManualSearch
          tickets={tickets}
          busy={checkin.isPending}
          onCheckin={(code) => checkin.mutate({ function_id: functionId, method: 'manual', code })}
        />
      )}

      {result && <ResultOverlay result={result} onClose={() => setResult(null)} />}
    </>
  )
}
