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
import * as scoped from '../services/scopedStorage'

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(getActiveSession)
  const [knownSessions, setKnownSessions] = useState(getKnownSessions)

  // Restore API keys from scoped storage on mount
  useEffect(() => {
    if (currentUser) {
      const keys = scoped.getJSON<{ anthropic: string; gemini?: string }>('api-keys')
      if (keys?.anthropic) {
        setActiveKeys(keys.anthropic, keys.gemini)
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
      identifier: string // email or API key — used to generate userId
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

    // Activate session (this sets the prefix for scopedStorage)
    setActiveSession(session)

    // Migrate existing data if this is the first login after update
    migrateExistingData(userId)

    // Store API keys in scoped storage
    scoped.setJSON('api-keys', {
      anthropic: credentials.anthropicKey,
      gemini: credentials.geminiKey,
    })

    // Set active keys in memory for the AI clients
    setActiveKeys(credentials.anthropicKey, credentials.geminiKey)

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
    // Find the session in known sessions
    const known = getKnownSessions()
    const session = known.find(s => s.userId === userId)
    if (!session) return

    // Activate this session
    setActiveSession(session)

    // Restore API keys
    const keys = scoped.getJSON<{ anthropic: string; gemini?: string }>('api-keys')
    if (keys?.anthropic) {
      setActiveKeys(keys.anthropic, keys.gemini)
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
