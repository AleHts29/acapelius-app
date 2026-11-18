// Estado offline-first del modo puerta (spec §6): snapshot en IndexedDB,
// validacion local de cada escaneo, cola de pendientes y sync en cuanto hay
// conexion. La red nunca esta en el camino de un escaneo.

import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api/client'
import type { CheckinResponse, DoorSnapshot } from '../api/client'
import {
  deviceId,
  enqueueCheckin,
  loadStoredSnapshot,
  pendingCheckins,
  removeQueued,
  saveStoredSnapshot,
} from './db'
import type { QueuedCheckin } from './db'
import { codeFromPayload, rechazosDelSync, validateLocally } from './logic'
import type { Rechazo } from './logic'

export type CheckinAttempt =
  | { method: 'scan'; payload: string }
  | { method: 'manual'; code: string }

export interface DoorStore {
  snapshot: DoorSnapshot | null
  pending: QueuedCheckin[]
  online: boolean
  /** null mientras no fallo nada; texto si el snapshot nunca se pudo bajar. */
  loadError: string | null
  checkin: (attempt: CheckinAttempt) => Promise<CheckinResponse>
  /** Cuándo se bajó la lista que tiene el teléfono (ISO), o null si nunca. */
  savedAt: string | null
  /** Baja la lista ya. Devuelve si pudo. */
  refreshNow: () => Promise<boolean>
  /** Ingresos que se dejaron pasar sin conexión y el sistema rechazó. */
  rechazos: Rechazo[]
  descartarRechazos: () => void
}

// Los rechazos se guardan para que no se pierdan si se cierra la app antes
// de leerlos. Si el navegador no deja guardar, quedan en memoria.
const rechazosKey = (functionId: number) => `acapelius-door-rechazos-${functionId}`
function leerRechazos(functionId: number): Rechazo[] {
  try {
    const raw = localStorage.getItem(rechazosKey(functionId))
    return raw ? (JSON.parse(raw) as Rechazo[]) : []
  } catch {
    return []
  }
}
function guardarRechazos(functionId: number, items: Rechazo[]) {
  try {
    if (items.length === 0) localStorage.removeItem(rechazosKey(functionId))
    else localStorage.setItem(rechazosKey(functionId), JSON.stringify(items))
  } catch {
    // Sin almacenamiento: quedan en memoria.
  }
}

const SNAPSHOT_REFRESH_MS = 30_000
const SYNC_RETRY_MS = 15_000

export function useDoorStore(functionId: number): DoorStore {
  const [snapshot, setSnapshot] = useState<DoorSnapshot | null>(null)
  const [pending, setPending] = useState<QueuedCheckin[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [rechazos, setRechazos] = useState<Rechazo[]>(() => leerRechazos(functionId))

  // Refs espejo para que los callbacks de timers vean el estado actual.
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const flushingRef = useRef(false)

  const refreshPending = useCallback(async () => {
    const items = await pendingCheckins(functionId)
    setPending(items)
    return items
  }, [functionId])

  // Baja el snapshot del server y lo persiste. Si falla, se sigue con el
  // guardado; el snapshot viejo es mejor que ninguno.
  const refreshSnapshot = useCallback(async (): Promise<boolean> => {
    try {
      const fresh = await api.doorSnapshot(functionId, deviceId())
      await saveStoredSnapshot(functionId, fresh)
      setSnapshot(fresh)
      setSavedAt(new Date().toISOString())
      setOnline(true)
      setLoadError(null)
      return true
    } catch {
      setOnline(navigator.onLine)
      if (!snapshotRef.current) {
        setLoadError(
          'No se pudo bajar la lista de entradas y este dispositivo no tiene una copia local. Necesitas conexion la primera vez.',
        )
      }
      return false
    }
  }, [functionId])

  // Empuja la cola al server. Cualquier resultado del server (ok, already,
  // invalid...) es terminal: el item sale de la cola y manda el server.
  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    try {
      const items = await pendingCheckins(functionId)
      if (items.length === 0) return

      const { results } = await api.syncCheckins({
        function_id: functionId,
        device_id: deviceId(),
        checkins: items.map((q) => ({
          payload: q.payload,
          code: q.payload ? undefined : q.code,
          method: q.method,
          at: q.at,
        })),
      })

      const nuevos = rechazosDelSync(items, results)
      if (nuevos.length > 0) {
        setRechazos((prev) => {
          const todos = [...prev, ...nuevos]
          guardarRechazos(functionId, todos)
          return todos
        })
      }

      await removeQueued(items.map((q) => q.localId!))
      await refreshPending()
      await refreshSnapshot()
    } catch {
      // Sin conexion (o server caido): la cola queda como esta y el proximo
      // intento la retoma.
      setOnline(false)
    } finally {
      flushingRef.current = false
    }
  }, [functionId, refreshPending, refreshSnapshot])

  // Arranque: snapshot guardado primero (rapido y funciona offline), despues
  // el fresco; y los timers de refresco y de reintento de sync.
  useEffect(() => {
    let alive = true

    void (async () => {
      const stored = await loadStoredSnapshot(functionId)
      if (alive && stored && !snapshotRef.current) {
        setSnapshot(stored.snapshot)
        setSavedAt(stored.savedAt)
      }
      await refreshPending()
      await refreshSnapshot()
      await flushQueue()
    })()

    const refreshTimer = setInterval(() => void refreshSnapshot(), SNAPSHOT_REFRESH_MS)
    const syncTimer = setInterval(() => void flushQueue(), SYNC_RETRY_MS)

    const onOnline = () => {
      setOnline(true)
      void flushQueue()
    }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      alive = false
      clearInterval(refreshTimer)
      clearInterval(syncTimer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [functionId, refreshPending, refreshSnapshot, flushQueue])

  // El escaneo: validacion 100% local, encolar si es verde, y disparar el
  // sync sin esperarlo. La respuesta es inmediata aunque no haya red.
  const checkin = useCallback(
    async (attempt: CheckinAttempt): Promise<CheckinResponse> => {
      const current = snapshotRef.current
      if (!current) {
        return { result: 'invalid' }
      }

      const code =
        attempt.method === 'scan' ? codeFromPayload(attempt.payload) : attempt.code
      const local = validateLocally(current, pendingRef.current, code)

      // Un QR que no está en la lista puede ser una venta que dirección
      // acaba de pasar a esta función. Con conexión se le pregunta al
      // sistema, que lo registra si es bueno; sin conexión queda el rojo.
      if (local.result === 'invalid' && attempt.method === 'scan' && code !== '' && navigator.onLine) {
        try {
          const online = await api.checkin({
            function_id: functionId,
            method: 'scan',
            payload: attempt.payload,
            device_id: deviceId(),
          })
          if (online.result !== 'invalid') {
            void refreshSnapshot()
            return online
          }
        } catch {
          // Sin respuesta: queda el veredicto local.
        }
      }
      const verdict = local

      if (verdict.result === 'ok') {
        const item: QueuedCheckin = {
          functionId,
          code,
          payload: attempt.method === 'scan' ? attempt.payload : undefined,
          method: attempt.method,
          at: new Date().toISOString(),
        }
        await enqueueCheckin(item)
        await refreshPending()
        void flushQueue()
      }

      return verdict
    },
    [functionId, refreshPending, flushQueue, refreshSnapshot],
  )

  const descartarRechazos = useCallback(() => {
    setRechazos([])
    guardarRechazos(functionId, [])
  }, [functionId])

  return {
    snapshot,
    pending,
    online,
    loadError,
    checkin,
    savedAt,
    refreshNow: refreshSnapshot,
    rechazos,
    descartarRechazos,
  }
}
