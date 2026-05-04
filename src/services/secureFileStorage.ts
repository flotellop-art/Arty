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
  const db = await getDB()
  const record = (await db.get(STORE, fileId)) as StoredFile | undefined
  if (!record || record.ownerKey !== getOwnerKey()) return
  await db.delete(STORE, fileId)
}

// Wipe TOUS les fichiers (du user actif uniquement). Appelé dans logout()
// pour respecter BUG 41.
export async function wipeFileStorage(): Promise<void> {
  const db = await getDB()
  const ownerKey = getOwnerKey()
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
export async function purgeOrphanFiles(referencedIds: Set<string>): Promise<number> {
  const db = await getDB()
  const ownerKey = getOwnerKey()
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
