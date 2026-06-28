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
import { initCryptoForApiKey } from '../services/cryptoPassphrase'
import { bootstrapStoredApiKeys, saveApiKeys, clearApiKeys, type StoredApiKeys } from '../services/apiKeyStorage'
import { bootstrapGoogleStorage, logout as googleLogout, clearOAuthState, resetGoogleMemCache } from '../services/googleAuth'
import { wipeFileStorage, bootstrapFileStorage } from '../services/secureFileStorage'
import { bootstrapConversationStorage, resetConversationMemCache } from '../services/storage'
import * as scoped from '../services/scopedStorage'

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
    let cancelled = false

    bootstrapStoredApiKeys()
      .then(async (keys) => {
        if (cancelled) return
        if (keys?.anthropic) {
          setActiveKeys(keys.anthropic, keys.gemini, keys.mistral, keys.openai)
        }
        await Promise.all([bootstrapGoogleStorage(), bootstrapFileStorage(), bootstrapConversationStorage()])
      })
      .catch((err) => {
        console.error('[useAuth] crypto bootstrap failed:', err)
      })

    return () => { cancelled = true }
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
    await initCryptoForApiKey(credentials.anthropicKey)
    await bootstrapGoogleStorage()
    bootstrapConversationStorage().catch(() => {})
    bootstrapFileStorage().catch(() => {})

    const keysToStore: StoredApiKeys = {
      anthropic: credentials.anthropicKey,
      gemini: credentials.geminiKey,
      mistral: credentials.mistralKey,
      openai: credentials.openaiKey,
    }
    await saveApiKeys(keysToStore)

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
    // Wipe usage metrics scoped to the leaving user — these are pure
    // counters/configs with no UX value to keep across a logout, and
    // they leak usage patterns on a shared device. Conversations and
    // pinned messages are intentionally kept (user request).
    scoped.removeItem('cost_history')
    scoped.removeItem('cost_alert')
    // Wipe provider keys for the leaving user (now strictly encrypted, but
    // still sensitive and not useful after logout on a shared device).
    clearApiKeys()
    // Drop any pending OAuth state nonce (e.g. user clicked Google then
    // logged out before completing the redirect).
    clearOAuthState()
    // Wipe les fichiers chiffrés du user actif (BUG 41 — éviter qu'un autre
    // user ne récupère les fichiers du précédent). Async, fire-and-forget.
    wipeFileStorage().catch(() => {})
    resetConversationMemCache()
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

    // Clear old keys AND the in-memory Google token cache BEFORE switching
    // session — otherwise getStoredTokens() returns the previous account's
    // tokens during the switch window, before bootstrap repopulates them.
    clearActiveKeys()
    resetGoogleMemCache()
    resetConversationMemCache()

    // Activate new session
    setActiveSession(session)

    // Restore new user's API keys (encrypted path, with legacy plaintext migration)
    const keys = await bootstrapStoredApiKeys()
    if (keys?.anthropic) {
      await bootstrapGoogleStorage()
      bootstrapConversationStorage().catch(() => {})
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
