// Stockage IndexedDB chiffré pour les fichiers attachés (images, PDFs).
// Permet à Arty de garder les fichiers en mémoire entre les tours d'une
// conversation (comme ChatGPT/Claude.ai), sans backend, en réutilisant
// la couche crypto existante (AES-256-GCM via crypto.ts).
//
// Pourquoi pas localStorage : limite 5 MB → un fichier HD suffit à crasher
// (BUG 11 dans CLAUDE.md). IndexedDB a 50 MB → 1 GB selon la plateforme.

import { openDB, type IDBPDatabase } from 'idb'
import { encrypt, decrypt, isCryptoReady, selfTestCrypto, captureCryptoGuard, CryptoContextChanged } from './crypto'
import { getActiveUserId, getActiveSessionEpoch } from './userSession'
import { generateId } from '../utils/generateId'
import { compressImageIfNeeded } from './imageCompression'
import {
  IMAGE_NORMALIZATION_VERSION,
  MAX_IMAGE_DIMENSION,
  MAX_NORMALIZED_IMAGE_BYTES,
} from './imageNormalization'
import type { FileAttachment } from '../types'
import { assertDocumentWorkspace, guardDocumentTransaction, getDocumentStorageLayout } from './workspaceWriter/runtime'
import { openExistingDB } from './readOnlyExistingDB'
import { BACKUP_LIMITS, BackupError } from './workspaceBackup/types'

const STORE = 'files'

interface StoredFile {
  fileId: string
  ownerKey: string
  name: string
  mimeType: string
  size: number
  encryptedData: string
  createdAt: number
  width?: number
  height?: number
  normalizationVersion?: number
}

let dbPromise: Promise<IDBPDatabase> | null = null

function ownerKeyFor(userId: string | null): string {
  return userId ? `arty-${userId}` : 'arty-anon'
}

function getDB(): Promise<IDBPDatabase> {
  assertDocumentWorkspace()
  if (!dbPromise) {
    const { name, version } = getDocumentStorageLayout().files
    dbPromise = openDB(name, version, {
      upgrade(db) {
        assertDocumentWorkspace()
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
  const owner = getActiveUserId(), epoch = getActiveSessionEpoch()
  const cryptoCurrent = isCryptoReady() ? captureCryptoGuard() : () => false
  try {
    await getDB()
    if (cryptoCurrent()) {
      await selfTestCrypto()
    }
  } finally {
    if (owner === getActiveUserId() && epoch === getActiveSessionEpoch() && cryptoCurrent()) window.dispatchEvent(new CustomEvent('file-storage-ready'))
  }
}

function base64ByteLength(value: string): number {
  const payload = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

// Persiste un fichier. Les assets canoniques PR-A sont chiffrés tels quels :
// les recompresser ici recréerait la divergence RAM/retry (A6). Les anciens
// callers restent sur le compresseur 2048 historique jusqu'à activation du
// feature flag et les images générées sans métadonnées gardent ce fallback.
// Retourne le fileId stable à stocker dans Message.files[].id.
export async function putFile(
  file: FileAttachment,
  ownerUserId: string | null = getActiveUserId(),
  requestGuard?: () => void,
): Promise<string> {
  assertDocumentWorkspace()
  requestGuard?.()
  if (ownerUserId !== getActiveUserId()) throw new CryptoContextChanged()
  if (!isCryptoReady()) {
    throw new Error('Crypto not ready — cannot persist file')
  }
  if (!file.data) {
    throw new Error('File has no data to persist')
  }
  const cryptoCurrent = captureCryptoGuard()
  const assertCurrent = () => {
    assertDocumentWorkspace()
    requestGuard?.()
    if (!cryptoCurrent() || ownerUserId !== getActiveUserId()) throw new CryptoContextChanged()
  }

  const hasNormalizationMetadata = file.normalizationVersion !== undefined
  if (
    hasNormalizationMetadata &&
    file.normalizationVersion !== IMAGE_NORMALIZATION_VERSION
  ) {
    throw new Error('Unsupported canonical image normalization version')
  }

  const markedCanonical = file.normalizationVersion === IMAGE_NORMALIZATION_VERSION
  const canonicalSize = markedCanonical ? base64ByteLength(file.data) : 0
  if (
    markedCanonical &&
    (
      !Number.isInteger(file.width) ||
      !Number.isInteger(file.height) ||
      !file.width ||
      !file.height ||
      file.width <= 0 ||
      file.height <= 0 ||
      file.width > MAX_IMAGE_DIMENSION ||
      file.height > MAX_IMAGE_DIMENSION
    )
  ) {
    throw new Error('Canonical image has invalid dimensions')
  }
  if (
    markedCanonical &&
    file.type !== 'image/jpeg' &&
    file.type !== 'image/png'
  ) {
    throw new Error('Canonical image has unsupported MIME type')
  }
  if (markedCanonical && (canonicalSize <= 0 || canonicalSize > MAX_NORMALIZED_IMAGE_BYTES)) {
    throw new Error('Canonical image has invalid binary size')
  }

  const stored = markedCanonical
    ? {
        data: file.data,
        mimeType: file.type,
        // Ne jamais faire confiance à `FileAttachment.size` : certains
        // callers historiques passent 0 ou une taille source.
        size: canonicalSize,
      }
    : await compressImageIfNeeded(file.data, file.type)
  assertCurrent()
  const encryptedData = await encrypt(stored.data)
  assertCurrent()
  const fileId = file.id || generateId()
  const record: StoredFile = {
    fileId,
    // Capturé avant les await : un changement de compte pendant le
    // chiffrement ne peut pas déplacer le blob dans le scope suivant.
    ownerKey: ownerKeyFor(ownerUserId),
    name: file.name,
    mimeType: stored.mimeType,
    size: stored.size,
    encryptedData,
    createdAt: Date.now(),
    ...(markedCanonical
      ? {
          width: file.width,
          height: file.height,
          normalizationVersion: file.normalizationVersion,
        }
      : {}),
  }

  const db = await getDB()
  assertCurrent()
  const tx = guardDocumentTransaction(db.transaction(STORE, 'readwrite'))
  try {
    const existing = await tx.store.get(fileId) as StoredFile | undefined
    assertCurrent()
    if (existing && existing.ownerKey !== record.ownerKey) throw new CryptoContextChanged()
    await tx.store.put(record)
    assertCurrent()
    await tx.done
  } catch (error) {
    try { tx.abort() } catch { /* already completed/aborted */ }
    await tx.done.catch(() => {})
    throw error
  }
  assertCurrent()
  return fileId
}

// Lit + déchiffre un fichier. Retourne null si absent ou si la clé n'est
// pas la bonne (multi-compte).
export async function getFile(
  fileId: string,
  ownerUserId: string | null = getActiveUserId(),
): Promise<FileAttachment | null> {
  assertDocumentWorkspace()
  if (!isCryptoReady() || ownerUserId !== getActiveUserId()) return null
  const cryptoCurrent = captureCryptoGuard()
  const db = await getDB()
  if (!cryptoCurrent()) return null
  const record = (await db.get(STORE, fileId)) as StoredFile | undefined
  if (!cryptoCurrent() || !record) return null
  if (record.ownerKey !== ownerKeyFor(ownerUserId)) return null
  try {
    const data = await decrypt(record.encryptedData)
    if (!cryptoCurrent()) return null
    return {
      id: record.fileId,
      name: record.name,
      type: record.mimeType,
      data,
      size: record.size,
      width: record.width,
      height: record.height,
      normalizationVersion: record.normalizationVersion,
    }
  } catch {
    return null
  }
}

export async function getFiles(fileIds: string[]): Promise<FileAttachment[]> {
  const results = await Promise.all(fileIds.map((id) => getFile(id)))
  return results.filter((f): f is FileAttachment => f !== null)
}

/** Capture all directly referenced encrypted records at one IDB snapshot point.
 * No getFile/null filtering, decrypt, bootstrap or version upgrade here. */
export async function readOwnedFileSnapshot(ids: readonly string[], assertScope: () => void, signal?: AbortSignal): Promise<ReadonlyMap<string, Readonly<StoredFile>>> {
  assertDocumentWorkspace(); assertScope()
  const owner = getActiveUserId(), epoch = getActiveSessionEpoch(), cryptoCurrent = captureCryptoGuard()
  const assertCurrent = () => {
    assertDocumentWorkspace(); assertScope()
    if (signal?.aborted || !owner || getActiveUserId() !== owner || getActiveSessionEpoch() !== epoch || !cryptoCurrent()) throw new BackupError('cancelled')
  }
  assertCurrent()
  if (ids.length > BACKUP_LIMITS.files) throw new BackupError('limit')
  const selected = [...new Set(ids)]
  if (selected.some(id => typeof id !== 'string' || id.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(id))) throw new BackupError('format')
  if (!selected.length) return new Map()
  const { name, version } = getDocumentStorageLayout().files
  const db = await openExistingDB(name, version, assertCurrent, signal)
  if (!db) throw new BackupError('missing')
  try {
    if (!db.objectStoreNames.contains(STORE)) throw new BackupError('format')
    const tx = db.transaction(STORE, 'readonly')
    const result = new Map<string, Readonly<StoredFile>>()
    let cipherChars = 0
    try { for (const id of selected) {
      // Sequential IDB requests, in ONE transaction, bound the retained clones
      // before requesting another record. No crypto/non-IDB await in this loop.
      const row = await tx.store.get(id) as StoredFile | undefined
      assertCurrent()
      if (!row || row.ownerKey !== ownerKeyFor(owner)) throw new BackupError('missing')
      if (row.fileId !== id || typeof row.encryptedData !== 'string' ||
        row.encryptedData.length > Math.ceil((Math.ceil(BACKUP_LIMITS.objectBytes * 4 / 3) + 1024) * 4 / 3) + 1024) throw new BackupError('format')
      cipherChars += row.encryptedData.length
      if (cipherChars > Math.ceil(BACKUP_LIMITS.plaintextBytes * 16 / 9) + 128 * 2048) throw new BackupError('limit')
      // IDB supplied an independent structured clone. Unknown fields are not
      // forwarded into the archive; the capture mapper validates the allowlist.
      result.set(id, Object.freeze(row))
    }
    await tx.done; assertCurrent()
    } catch (error) { try { tx.abort() } catch { /* complete */ }; await tx.done.catch(() => {}); throw error }
    return result
  } finally { db.close() }
}

export async function deleteFile(fileId: string): Promise<void> {
  await deleteOwnedFiles([fileId], getActiveUserId())
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
  assertDocumentWorkspace()
  const ownerKey = ownerKeyFor(ownerUserId)
  const uniqueIds = [...new Set(fileIds)]
  if (uniqueIds.length === 0) return 0

  const db = await getDB()
  const tx = guardDocumentTransaction(db.transaction(STORE, 'readwrite'))
  let deleted = 0
  try {
  for (const fileId of uniqueIds) {
    const record = (await tx.store.get(fileId)) as StoredFile | undefined
    assertDocumentWorkspace()
    if (record?.ownerKey !== ownerKey) continue
    await tx.store.delete(fileId)
    deleted++
  }
  await tx.done
  assertDocumentWorkspace()
  return deleted
  } catch (error) {
    try { tx.abort() } catch { /* completed */ }
    await tx.done.catch(() => {}); throw error
  }
}

// Wipe TOUS les fichiers (du user actif uniquement). Appelé dans logout()
// pour respecter BUG 41.
export async function wipeFileStorage(ownerUserId: string | null = getActiveUserId()): Promise<void> {
  // Capture identity before the first await. Logout clears the active session;
  // resolving it afterwards would target arty-anon and leave user files behind.
  const ownerKey = ownerKeyFor(ownerUserId)
  const db = await getDB()
  const tx = guardDocumentTransaction(db.transaction(STORE, 'readwrite'))
  const index = tx.store.index('ownerKey')
  try {
  let cursor = await index.openCursor(IDBKeyRange.only(ownerKey))
  while (cursor) {
    assertDocumentWorkspace()
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
  assertDocumentWorkspace()
  window.dispatchEvent(new CustomEvent('file-storage-ready'))
  } catch (error) {
    try { tx.abort() } catch { /* completed */ }
    await tx.done.catch(() => {}); throw error
  }
}

// Purge les fichiers orphelins : ceux qui ne sont plus référencés par
// aucune conversation. Retourne le nombre de fichiers supprimés.
export async function purgeOrphanFiles(
  referencedIds: Set<string>,
  ownerUserId: string | null = getActiveUserId(),
): Promise<number> {
  const ownerKey = ownerKeyFor(ownerUserId)
  const db = await getDB()
  const tx = guardDocumentTransaction(db.transaction(STORE, 'readwrite'))
  const index = tx.store.index('ownerKey')
  let count = 0
  try {
  let cursor = await index.openCursor(IDBKeyRange.only(ownerKey))
  while (cursor) {
    assertDocumentWorkspace()
    const record = cursor.value as StoredFile
    if (!referencedIds.has(record.fileId)) {
      await cursor.delete()
      count++
    }
    cursor = await cursor.continue()
  }
  await tx.done
  assertDocumentWorkspace()
  return count
  } catch (error) {
    try { tx.abort() } catch { /* completed */ }
    await tx.done.catch(() => {}); throw error
  }
}

export async function estimateStorageUsage(): Promise<{ usage: number; quota: number }> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const est = await navigator.storage.estimate()
    return { usage: est.usage || 0, quota: est.quota || 0 }
  }
  return { usage: 0, quota: 0 }
}
