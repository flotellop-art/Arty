import { useState, useCallback, useEffect } from 'react'
import {
  getActiveSession,
  setActiveSession,
  clearActiveSession,
  getKnownSessions,
  generateUserId,
  migrateExistingData,
  type UserSession,
  type AuthMethod,
} from '../services/userSession'
import { setActiveKeys, clearActiveKeys } from '../services/activeApiKey'
import { initCrypto } from '../services/crypto'
import { bootstrapGoogleStorage, logout as googleLogout } from '../services/googleAuth'
import { wipeFileStorage, bootstrapFileStorage } from '../services/secureFileStorage'
import * as scoped from '../services/scopedStorage'

type StoredKeys = { anthropic: string; gemini?: string; mistral?: string; openai?: string }

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(getActiveSession)
  const [knownSessions, setKnownSessions] = useState(getKnownSessions)

  // Restore API keys and init crypto on mount.
  // Crypto must be initialized before any sensitive data is read/written —
  // Google tokens, conversations, etc. depend on it. After init, we bootstrap
  // encrypted-at-rest storage for Google tokens and migrate legacy plain data.
  // BUG 43 — we log every failure so the next "clear data to fix it" report
  // from a tester gives us an actionable stack trace. bootstrapGoogleStorage
  // also self-heals corrupt blobs now.
  useEffect(() => {
    if (!currentUser) return
    const keys = scoped.getJSON<StoredKeys>('api-keys')
    if (!keys?.anthropic) return
    setActiveKeys(keys.anthropic, keys.gemini, keys.mistral, keys.openai)
    initCrypto(keys.anthropic)
      .then(() => Promise.all([bootstrapGoogleStorage(), bootstrapFileStorage()]))
      .catch((err) => {
        console.error('[useAuth] crypto bootstrap failed:', err)
      })
  }, [currentUser])

  const login = useCallback(async (
    method: AuthMethod,
    credentials: {
      displayName: string
      email?: string
      avatar?: string
      anthropicKey: string
      geminiKey?: string
      mistralKey?: string
      openaiKey?: string
      identifier: string
    }
  ) => {
    const userId = await generateUserId(method, credentials.identifier)

    const session: UserSession = {
      userId,
      authMethod: method,
      displayName: credentials.displayName,
      email: credentials.email,
      avatar: credentials.avatar,
      createdAt: Date.now(),
    }

    // Activate session (sets the prefix for scopedStorage)
    setActiveSession(session)

    // Migrate existing data if first login after update
    migrateExistingData(userId)

    // Initialize encryption with the API key, then migrate any legacy
    // plain-JSON Google tokens into encrypted storage.
    await initCrypto(credentials.anthropicKey)
    await bootstrapGoogleStorage()
    bootstrapFileStorage().catch(() => {})

    // Store API keys as plain JSON for sync reads (getJSON in useEffect)
    // DO NOT encrypt with migrateKey — it overwrites plain with encrypted,
    // making getJSON() fail on page reload (see BUG 1 in CLAUDE.md)
    scoped.setJSON('api-keys', {
      anthropic: credentials.anthropicKey,
      gemini: credentials.geminiKey,
      mistral: credentials.mistralKey,
      openai: credentials.openaiKey,
    })

    // Set active keys in memory for AI clients
    setActiveKeys(
      credentials.anthropicKey,
      credentials.geminiKey,
      credentials.mistralKey,
      credentials.openaiKey
    )

    setCurrentUser(session)
    setKnownSessions(getKnownSessions())

    return session
  }, [])

  const logout = useCallback(() => {
    // Clear everything synchronously first (both plain + encrypted copies)
    clearActiveKeys()
    googleLogout()
    // Wipe les fichiers chiffrés du user actif (BUG 41 — éviter qu'un autre
    // user ne récupère les fichiers du précédent). Async, fire-and-forget.
    wipeFileStorage().catch(() => {})
    clearActiveSession()
    setCurrentUser(null)

    // Sign out from native Google Sign-In in background (don't await)
    import('@capacitor/core').then(({ Capacitor, registerPlugin }) => {
      if (Capacitor.isNativePlatform()) {
        const GoogleSignInNative = registerPlugin<{ signOut(): Promise<void> }>('GoogleSignInNative')
        GoogleSignInNative.signOut().catch(() => {})
      }
    }).catch(() => {})
  }, [])

  const switchAccount = useCallback(async (userId: string) => {
    const known = getKnownSessions()
    const session = known.find(s => s.userId === userId)
    if (!session) return

    // Clear old keys BEFORE switching session to prevent cross-user leak
    clearActiveKeys()

    // Activate new session
    setActiveSession(session)

    // Restore new user's API keys
    const keys = scoped.getJSON<StoredKeys>('api-keys')
    if (keys?.anthropic) {
      await initCrypto(keys.anthropic)
      await bootstrapGoogleStorage()
      bootstrapFileStorage().catch(() => {})
      setActiveKeys(keys.anthropic, keys.gemini, keys.mistral, keys.openai)
    }

    setCurrentUser(session)
  }, [])

  return {
    currentUser,
    isAuthenticated: currentUser !== null,
    knownSessions,
    login,
    logout,
    switchAccount,
  }
}
