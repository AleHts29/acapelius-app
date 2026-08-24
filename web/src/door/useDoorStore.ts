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
import { codeFromPayload, validateLocally } from './logic'

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
}

const SNAPSHOT_REFRESH_MS = 30_000
const SYNC_RETRY_MS = 15_000

export function useDoorStore(functionId: number): DoorStore {
  const [snapshot, setSnapshot] = useState<DoorSnapshot | null>(null)
  const [pending, setPending] = useState<QueuedCheckin[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [loadError, setLoadError] = useState<string | null>(null)

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
  const refreshSnapshot = useCallback(async () => {
    try {
      const fresh = await api.doorSnapshot(functionId)
      await saveStoredSnapshot(functionId, fresh)
      setSnapshot(fresh)
      setOnline(true)
      setLoadError(null)
    } catch {
      setOnline(navigator.onLine)
      if (!snapshotRef.current) {
        setLoadError(
          'No se pudo bajar la lista de entradas y este dispositivo no tiene una copia local. Necesitas conexion la primera vez.',
        )
      }
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

      await api.syncCheckins({
        function_id: functionId,
        device_id: deviceId(),
        checkins: items.map((q) => ({
          payload: q.payload,
          code: q.payload ? undefined : q.code,
          method: q.method,
          at: q.at,
        })),
      })

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
      const verdict = validateLocally(current, pendingRef.current, code)

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
    [functionId, refreshPending, flushQueue],
  )

  return { snapshot, pending, online, loadError, checkin }
}
