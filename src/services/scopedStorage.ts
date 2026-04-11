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
 * Secure set: encrypt if crypto is ready, otherwise write plain JSON as fallback.
 * Plain JSON is overwritten as soon as crypto becomes available.
 */
export function secureSetJSON(baseKey: string, value: unknown): void {
  const key = buildKey(baseKey)
  if (isCryptoReady()) {
    // Crypto ready — encrypt directly, write plain only as sync fallback
    // (secureGet will read encrypted version first)
    secureSet(key, value).catch(() => {
      // Encryption failed — fallback to plain
      localStorage.setItem(key, JSON.stringify(value))
    })
  } else {
    // Crypto not ready yet — write plain, will be migrated later
    localStorage.setItem(key, JSON.stringify(value))
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
