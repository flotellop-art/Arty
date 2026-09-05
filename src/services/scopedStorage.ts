/**
 * Scoped localStorage — automatically prefixes keys with the active userId.
 * Each user's data is isolated from others.
 */

import { getActiveUserId } from './userSession'
import { secureSet, secureGet, isCryptoReady, isCryptoContextChanged } from './crypto'
import { assertDocumentWorkspace, documentStorageKey } from './workspaceWriter/runtime'

function buildKey(baseKey: string): string {
  const userId = getActiveUserId()
  return documentStorageKey(userId, baseKey)
}

function buildKeyForUser(userId: string, baseKey: string): string {
  return documentStorageKey(userId, baseKey)
}

export function getItem(baseKey: string): string | null {
  assertDocumentWorkspace()
  return localStorage.getItem(buildKey(baseKey))
}

export function setItem(baseKey: string, value: string): void {
  assertDocumentWorkspace()
  localStorage.setItem(buildKey(baseKey), value)
}

export function removeItem(baseKey: string): void {
  assertDocumentWorkspace()
  localStorage.removeItem(buildKey(baseKey))
}

/** Get parsed JSON, returns null on failure */
export function getJSON<T>(baseKey: string): T | null {
  assertDocumentWorkspace()
  try {
    const raw = getItem(baseKey)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

/** Lecture ciblée sans changer la session active (finalisation OAuth). */
export function getJSONForUser<T>(userId: string, baseKey: string): T | null {
  assertDocumentWorkspace()
  try {
    const raw = localStorage.getItem(buildKeyForUser(userId, baseKey))
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

/** Set as JSON string */
export function setJSON(baseKey: string, value: unknown): void {
  setItem(baseKey, JSON.stringify(value))
}

/**
 * Secure set: encrypt if crypto is ready, otherwise write plain JSON as fallback.
 * Plain JSON is overwritten as soon as crypto becomes available.
 */
export function secureSetJSON(baseKey: string, value: unknown): void {
  assertDocumentWorkspace()
  const key = buildKey(baseKey)
  // Always write plain JSON first for sync reads (getJSON)
  localStorage.setItem(key, JSON.stringify(value))
  // Then encrypt in background if crypto is ready (overwrites with encrypted version)
  if (isCryptoReady()) {
    secureSet(key, value).catch(() => {})
  }
}

/**
 * Secure get: try decrypting first, fallback to plain JSON.
 * Works for both encrypted and non-encrypted data.
 */
export async function secureGetJSON<T>(baseKey: string): Promise<T | null> {
  assertDocumentWorkspace()
  const key = buildKey(baseKey)

  // Try encrypted read first
  if (isCryptoReady()) {
    try {
      const result = await secureGet<T>(key)
      if (result !== null) return result
    } catch (error) {
      if (isCryptoContextChanged(error)) throw error
      // Decryption failed — try plain
    }
  }

  // Fallback: plain JSON
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

/**
 * Supprime TOUTES les clés localStorage du user actif (suppression de compte).
 * Ne touche qu'au préfixe `arty-{userId}-` : les données des autres comptes
 * présents sur le même appareil sont préservées (cf. BUG 45). No-op si aucun
 * user actif (on ne wipe jamais en aveugle les clés globales `arty-*`).
 */
export function clearAllForActiveUser(): void {
  assertDocumentWorkspace()
  const userId = getActiveUserId()
  if (!userId) return
  const prefix = `arty-${userId}-`
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(prefix)) toRemove.push(k)
  }
  toRemove.forEach((k) => localStorage.removeItem(k))
}
