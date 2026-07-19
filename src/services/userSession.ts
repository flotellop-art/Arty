/**
 * User Session Manager
 * Manages multi-user isolation in localStorage via userId prefixing.
 */

const ACTIVE_SESSION_KEY = 'arty-active-session'
const KNOWN_SESSIONS_KEY = 'arty-known-sessions'

export type AuthMethod = 'google' | 'email' | 'apikey' | 'demo'

export interface UserSession {
  userId: string
  authMethod: AuthMethod
  displayName: string
  email?: string
  avatar?: string
  createdAt: number
}

// Current active session
let _activeSession: UserSession | null = null
let _sessionEpoch = 0

// ─── Hash helper ───

async function shortHash(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(hash)
  // Take first 8 bytes → 16 hex chars
  return Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── User ID generation ───

export async function generateUserId(method: AuthMethod, identifier: string): Promise<string> {
  const hash = await shortHash(identifier.toLowerCase().trim())
  return `${method}-${hash}`
}

// ─── Session management ───

export function getActiveSession(): UserSession | null {
  if (_activeSession) return _activeSession

  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY)
    if (raw) {
      _activeSession = JSON.parse(raw) as UserSession
      return _activeSession
    }
  } catch {}
  return null
}

export function getActiveUserId(): string | null {
  return getActiveSession()?.userId || null
}

/** Change à chaque switch/logout, même si l'utilisateur revient au même ID. */
export function getActiveSessionEpoch(): number {
  return _sessionEpoch
}

export function setActiveSession(session: UserSession): void {
  _sessionEpoch += 1
  _activeSession = session
  localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session))

  // Add to known sessions
  const known = getKnownSessions()
  const existing = known.findIndex(s => s.userId === session.userId)
  if (existing >= 0) {
    known[existing] = session
  } else {
    known.unshift(session)
  }
  localStorage.setItem(KNOWN_SESSIONS_KEY, JSON.stringify(known))
}

export function clearActiveSession(): void {
  _sessionEpoch += 1
  _activeSession = null
  localStorage.removeItem(ACTIVE_SESSION_KEY)
}

export function getKnownSessions(): UserSession[] {
  try {
    const raw = localStorage.getItem(KNOWN_SESSIONS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function removeKnownSession(userId: string): void {
  const known = getKnownSessions().filter(s => s.userId !== userId)
  localStorage.setItem(KNOWN_SESSIONS_KEY, JSON.stringify(known))
}

// ─── Data migration ───

/**
 * Reports created before account scoping contain no owner metadata. Assigning
 * them to the next account that signs in could disclose another person's
 * report on a shared device, so the only safe migration is deletion.
 */
export function purgeLegacyGlobalReports(): number {
  // Legacy IDs were generated with Date.now().toString(36): lowercase
  // alphanumerics only. The exact shape avoids matching a scoped key when a
  // synthetic/test userId itself starts with "report-".
  const keys = Object.keys(localStorage).filter((key) => /^arty-report-[a-z0-9]+$/.test(key))
  keys.forEach((key) => localStorage.removeItem(key))
  return keys.length
}

const LEGACY_KEYS = [
  'conversations',
  'google-tokens',
  'google-user',
  'token-usage',
  'token-init-v2',
  'response-style',
  'api-keys',
  // Les métadonnées crypto sont migrées de manière non destructive par
  // crypto.ts vers des clés par compte. Ne pas les déplacer ici : ce module ne
  // possède ni la passphrase ni la capacité de re-chiffrer les blobs.
]

export function migrateExistingData(userId: string): void {
  // Do this before the per-user migration flag check: an ownerless report may
  // appear after an earlier migration (for example after restoring old data).
  purgeLegacyGlobalReports()

  const migrationFlag = `arty-migration-done-${userId}`
  if (localStorage.getItem(migrationFlag)) return

  for (const key of LEGACY_KEYS) {
    const oldKey = `arty-${key}`
    const newKey = `arty-${userId}-${key}`

    const oldData = localStorage.getItem(oldKey)
    if (oldData && !localStorage.getItem(newKey)) {
      localStorage.setItem(newKey, oldData)
      localStorage.removeItem(oldKey)
    }
  }

  localStorage.setItem(migrationFlag, '1')
}
