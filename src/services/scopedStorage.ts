/**
 * Scoped localStorage — automatically prefixes keys with the active userId.
 * Each user's data is isolated from others.
 */

import { getActiveUserId } from './userSession'
import { secureSet, secureGet, isCryptoReady } from './crypto'

function buildKey(baseKey: string): string {
  const userId = getActiveUserId()
  if (!userId) return `arty-${baseKey}`
  return `arty-${userId}-${baseKey}`
}

export function getItem(baseKey: string): string | null {
  return localStorage.getItem(buildKey(baseKey))
}

export function setItem(baseKey: string, value: string): void {
  localStorage.setItem(buildKey(baseKey), value)
}

export function removeItem(baseKey: string): void {
  localStorage.removeItem(buildKey(baseKey))
}

/** Get parsed JSON, returns null on failure */
export function getJSON<T>(baseKey: string): T | null {
  try {
    const raw = getItem(baseKey)
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
 * Secure set: write plain JSON immediately (sync, no UI bug),
 * then encrypt in background if crypto is ready.
 */
export function secureSetJSON(baseKey: string, value: unknown): void {
  const key = buildKey(baseKey)
  // 1. Write plain JSON immediately for sync reads
  localStorage.setItem(key, JSON.stringify(value))
  // 2. Encrypt in background if crypto is initialized
  if (isCryptoReady()) {
    secureSet(key, value).catch(() => {})
  }
}

/**
 * Secure get: try decrypting first, fallback to plain JSON.
 * Works for both encrypted and non-encrypted data.
 */
export async function secureGetJSON<T>(baseKey: string): Promise<T | null> {
  const key = buildKey(baseKey)

  // Try encrypted read first
  if (isCryptoReady()) {
    try {
      const result = await secureGet<T>(key)
      if (result !== null) return result
    } catch {
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
