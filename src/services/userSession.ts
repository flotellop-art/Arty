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

export function setActiveSession(session: UserSession): void {
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

const LEGACY_KEYS = [
  'conversations',
  'google-tokens',
  'google-user',
  'token-usage',
  'token-init-v2',
  'response-style',
  'api-keys',
  'crypto-salt',
  'crypto-check',
]

export function migrateExistingData(userId: string): void {
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

  // Migrate reports (arty-report-{id})
  const allKeys = Object.keys(localStorage)
  for (const key of allKeys) {
    if (key.startsWith('arty-report-') && !key.includes(userId)) {
      const reportId = key.replace('arty-report-', '')
      const newKey = `arty-${userId}-report-${reportId}`
      if (!localStorage.getItem(newKey)) {
        localStorage.setItem(newKey, localStorage.getItem(key)!)
        localStorage.removeItem(key)
      }
    }
  }

  localStorage.setItem(migrationFlag, '1')
}
