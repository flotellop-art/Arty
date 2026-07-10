// Stockage IndexedDB chiffré pour les fichiers attachés (images, PDFs).
// Permet à Arty de garder les fichiers en mémoire entre les tours d'une
// conversation (comme ChatGPT/Claude.ai), sans backend, en réutilisant
// la couche crypto existante (AES-256-GCM via crypto.ts).
//
// Pourquoi pas localStorage : limite 5 MB → un fichier HD suffit à crasher
// (BUG 11 dans CLAUDE.md). IndexedDB a 50 MB → 1 GB selon la plateforme.

import { openDB, type IDBPDatabase } from 'idb'
import { encrypt, decrypt, isCryptoReady, selfTestCrypto } from './crypto'
import { getActiveUserId } from './userSession'
import { generateId } from '../utils/generateId'
import { compressImageIfNeeded } from './imageCompression'
import type { FileAttachment } from '../types'

const DB_NAME = 'arty-files'
const DB_VERSION = 1
const STORE = 'files'

interface StoredFile {
  fileId: string
  ownerKey: string
  name: string
  mimeType: string
  size: number
  encryptedData: string
  createdAt: number
}

let dbPromise: Promise<IDBPDatabase> | null = null

function getOwnerKey(): string {
  const userId = getActiveUserId()
  return userId ? `arty-${userId}` : 'arty-anon'
}

function ownerKeyFor(userId: string | null): string {
  return userId ? `arty-${userId}` : 'arty-anon'
}

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'fileId' })
          store.createIndex('ownerKey', 'ownerKey', { unique: false })
        }
      },
    })
  }
  return dbPromise
}

// Bootstrap: ouvre la DB et vérifie que la clé crypto est valide. Dispatch
// un event de signal pour les hooks qui voudraient réagir. Pattern copié
// de bootstrapGoogleStorage (BUG 43 — ne JAMAIS lire en sync au mount des
// stores chiffrés ; toujours attendre l'event ready).
export async function bootstrapFileStorage(): Promise<void> {
  try {
    await getDB()
    if (isCryptoReady()) {
      await selfTestCrypto()
    }
  } finally {
    window.dispatchEvent(new CustomEvent('file-storage-ready'))
  }
}

// Persiste un fichier. Compresse les images > 500 KB AVANT chiffrement.
// Retourne le fileId stable à stocker dans Message.files[].id.
export async function putFile(file: FileAttachment): Promise<string> {
  if (!isCryptoReady()) {
    throw new Error('Crypto not ready — cannot persist file')
  }
  if (!file.data) {
    throw new Error('File has no data to persist')
  }

  const compressed = await compressImageIfNeeded(file.data, file.type)
  const encryptedData = await encrypt(compressed.data)
  const fileId = file.id || generateId()
  const record: StoredFile = {
    fileId,
    ownerKey: getOwnerKey(),
    name: file.name,
    mimeType: compressed.mimeType,
    size: compressed.size,
    encryptedData,
    createdAt: Date.now(),
  }

  const db = await getDB()
  await db.put(STORE, record)
  return fileId
}

// Lit + déchiffre un fichier. Retourne null si absent ou si la clé n'est
// pas la bonne (multi-compte).
export async function getFile(fileId: string): Promise<FileAttachment | null> {
  if (!isCryptoReady()) return null
  const db = await getDB()
  const record = (await db.get(STORE, fileId)) as StoredFile | undefined
  if (!record) return null
  if (record.ownerKey !== getOwnerKey()) return null
  try {
    const data = await decrypt(record.encryptedData)
    return {
      id: record.fileId,
      name: record.name,
      type: record.mimeType,
      data,
      size: record.size,
    }
  } catch {
    return null
  }
}

export async function getFiles(fileIds: string[]): Promise<FileAttachment[]> {
  const results = await Promise.all(fileIds.map((id) => getFile(id)))
  return results.filter((f): f is FileAttachment => f !== null)
}

export async function deleteFile(fileId: string): Promise<void> {
  const ownerKey = getOwnerKey()
  const db = await getDB()
  const record = (await db.get(STORE, fileId)) as StoredFile | undefined
  if (!record || record.ownerKey !== ownerKey) return
  await db.delete(STORE, fileId)
}

/**
 * Delete a bounded set of files for one captured owner.
 *
 * Conversation deletion must never run a global "all unreferenced files"
 * sweep: another conversation may have persisted a file in IndexedDB but not
 * yet committed its Message reference. Restricting deletion to IDs that came
 * from the deleted conversation closes that race. The owner is captured before
 * opening IndexedDB so an account switch cannot redirect the cleanup.
 */
export async function deleteOwnedFiles(
  fileIds: Iterable<string>,
  ownerUserId: string | null = getActiveUserId(),
): Promise<number> {
  const ownerKey = ownerKeyFor(ownerUserId)
  const uniqueIds = [...new Set(fileIds)]
  if (uniqueIds.length === 0) return 0

  const db = await getDB()
  const tx = db.transaction(STORE, 'readwrite')
  let deleted = 0
  for (const fileId of uniqueIds) {
    const record = (await tx.store.get(fileId)) as StoredFile | undefined
    if (record?.ownerKey !== ownerKey) continue
    await tx.store.delete(fileId)
    deleted++
  }
  await tx.done
  return deleted
}

// Wipe TOUS les fichiers (du user actif uniquement). Appelé dans logout()
// pour respecter BUG 41.
export async function wipeFileStorage(ownerUserId: string | null = getActiveUserId()): Promise<void> {
  // Capture identity before the first await. Logout clears the active session;
  // resolving it afterwards would target arty-anon and leave user files behind.
  const ownerKey = ownerKeyFor(ownerUserId)
  const db = await getDB()
  const tx = db.transaction(STORE, 'readwrite')
  const index = tx.store.index('ownerKey')
  let cursor = await index.openCursor(IDBKeyRange.only(ownerKey))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
  window.dispatchEvent(new CustomEvent('file-storage-ready'))
}

// Purge les fichiers orphelins : ceux qui ne sont plus référencés par
// aucune conversation. Retourne le nombre de fichiers supprimés.
export async function purgeOrphanFiles(
  referencedIds: Set<string>,
  ownerUserId: string | null = getActiveUserId(),
): Promise<number> {
  const ownerKey = ownerKeyFor(ownerUserId)
  const db = await getDB()
  const tx = db.transaction(STORE, 'readwrite')
  const index = tx.store.index('ownerKey')
  let count = 0
  let cursor = await index.openCursor(IDBKeyRange.only(ownerKey))
  while (cursor) {
    const record = cursor.value as StoredFile
    if (!referencedIds.has(record.fileId)) {
      await cursor.delete()
      count++
    }
    cursor = await cursor.continue()
  }
  await tx.done
  return count
}

export async function estimateStorageUsage(): Promise<{ usage: number; quota: number }> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const est = await navigator.storage.estimate()
    return { usage: est.usage || 0, quota: est.quota || 0 }
  }
  return { usage: 0, quota: 0 }
}
