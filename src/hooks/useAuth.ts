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
import { initCrypto, migrateKey } from '../services/crypto'
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
    // migrateKey handles encryption separately
    scoped.setJSON('api-keys', {
      anthropic: credentials.anthropicKey,
      gemini: credentials.geminiKey,
      mistral: credentials.mistralKey,
    })

    // Migrate the api-keys entry to encrypted format
    await migrateKey(`arty-${userId}-api-keys`)

    // Set active keys in memory for AI clients
    setActiveKeys(credentials.anthropicKey, credentials.geminiKey, credentials.mistralKey)

    setCurrentUser(session)
    setKnownSessions(getKnownSessions())

    return session
  }, [])

  const logout = useCallback(() => {
    clearActiveKeys()
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
