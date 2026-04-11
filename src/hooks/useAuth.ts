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
import * as scoped from '../services/scopedStorage'

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(getActiveSession)
  const [knownSessions, setKnownSessions] = useState(getKnownSessions)

  // Restore API keys and init crypto on mount
  useEffect(() => {
    if (currentUser) {
      const keys = scoped.getJSON<{ anthropic: string; gemini?: string; mistral?: string }>('api-keys')
      if (keys?.anthropic) {
        setActiveKeys(keys.anthropic, keys.gemini, keys.mistral)
        initCrypto(keys.anthropic).catch(() => {})
      }
    }
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

    // Initialize encryption with the API key
    await initCrypto(credentials.anthropicKey)

    // Store API keys as plain JSON for sync reads (getJSON in useEffect)
    // DO NOT encrypt with migrateKey — it overwrites plain with encrypted,
    // making getJSON() fail on page reload (see BUG 1 in CLAUDE.md)
    scoped.setJSON('api-keys', {
      anthropic: credentials.anthropicKey,
      gemini: credentials.geminiKey,
      mistral: credentials.mistralKey,
    })

    // Set active keys in memory for AI clients
    setActiveKeys(credentials.anthropicKey, credentials.geminiKey, credentials.mistralKey)

    setCurrentUser(session)
    setKnownSessions(getKnownSessions())

    return session
  }, [])

  const logout = useCallback(async () => {
    // Clear API keys from memory
    clearActiveKeys()
    // Clear Google tokens and user data
    scoped.removeItem('google-tokens')
    scoped.removeItem('google-user')
    // Sign out from native Google Sign-In (clears cached account)
    try {
      const { Capacitor } = await import('@capacitor/core')
      if (Capacitor.isNativePlatform()) {
        const { registerPlugin } = await import('@capacitor/core')
        const GoogleSignInNative = registerPlugin<{ signOut(): Promise<void> }>('GoogleSignInNative')
        await GoogleSignInNative.signOut()
      }
    } catch {}
    // Clear session
    clearActiveSession()
    setCurrentUser(null)
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
    const keys = scoped.getJSON<{ anthropic: string; gemini?: string; mistral?: string }>('api-keys')
    if (keys?.anthropic) {
      await initCrypto(keys.anthropic)
      setActiveKeys(keys.anthropic, keys.gemini, keys.mistral)
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
