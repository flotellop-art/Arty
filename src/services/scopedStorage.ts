/**
 * Scoped localStorage — automatically prefixes keys with the active userId.
 * Each user's data is isolated from others.
 */

import { getActiveUserId } from './userSession'

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
