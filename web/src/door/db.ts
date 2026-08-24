// Persistencia local del modo puerta (spec §6): el snapshot de la funcion y
// la cola de check-ins pendientes viven en IndexedDB, para que un corte de
// red — o cerrar el browser — no pierda nada.

import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

import type { DoorSnapshot } from '../api/client'

export interface StoredSnapshot {
  functionId: number
  snapshot: DoorSnapshot
  savedAt: string
}

/** Un check-in hecho en este dispositivo que todavia no llego al server. */
export interface QueuedCheckin {
  localId?: number
  functionId: number
  code: string // codigo del ticket, para dedupe y para mostrar
  payload?: string // scan: el QR completo; el server verifica la firma
  method: 'scan' | 'manual'
  at: string // ISO: momento real del ingreso
}

interface DoorDB extends DBSchema {
  snapshots: { key: number; value: StoredSnapshot }
  queue: {
    key: number
    value: QueuedCheckin
    indexes: { 'by-function': number }
  }
}

let dbPromise: Promise<IDBPDatabase<DoorDB>> | null = null

function db(): Promise<IDBPDatabase<DoorDB>> {
  dbPromise ??= openDB<DoorDB>('acapelius-door', 1, {
    upgrade(database) {
      database.createObjectStore('snapshots', { keyPath: 'functionId' })
      const queue = database.createObjectStore('queue', {
        keyPath: 'localId',
        autoIncrement: true,
      })
      queue.createIndex('by-function', 'functionId')
    },
  })
  return dbPromise
}

export async function loadStoredSnapshot(functionId: number): Promise<StoredSnapshot | undefined> {
  return (await db()).get('snapshots', functionId)
}

export async function saveStoredSnapshot(functionId: number, snapshot: DoorSnapshot): Promise<void> {
  await (await db()).put('snapshots', {
    functionId,
    snapshot,
    savedAt: new Date().toISOString(),
  })
}

export async function enqueueCheckin(item: QueuedCheckin): Promise<void> {
  await (await db()).add('queue', item)
}

export async function pendingCheckins(functionId: number): Promise<QueuedCheckin[]> {
  return (await db()).getAllFromIndex('queue', 'by-function', functionId)
}

export async function removeQueued(localIds: number[]): Promise<void> {
  const database = await db()
  const tx = database.transaction('queue', 'readwrite')
  await Promise.all(localIds.map((id) => tx.store.delete(id)))
  await tx.done
}

const DEVICE_ID_KEY = 'acapelius-device-id'

/** Identificador estable de este dispositivo, para el registro del sync. */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}
