import { useState, useCallback, useEffect } from 'react'
import {
  getActiveSession,
  setActiveSession,
  clearActiveSession,
  getKnownSessions,
  generateUserId,
  migrateExistingData,
  purgeLegacyGlobalReports,
  getActiveUserId,
  removeKnownSession,
  type UserSession,
  type AuthMethod,
} from '../services/userSession'
import { setActiveKeys, clearActiveKeys } from '../services/activeApiKey'
import { initCrypto } from '../services/crypto'
import { bootstrapGoogleStorage, logout as googleLogout, clearOAuthState, resetGoogleMemCache } from '../services/googleAuth'
import { bootstrapFileStorage } from '../services/secureFileStorage'
import { bootstrapConversationStorage, resetConversationMemCache } from '../services/storage'
import * as scoped from '../services/scopedStorage'
import { clearTrialToken } from '../services/emailTrialClient'
import { clearWalletCache } from '../services/walletClient'
import { adoptPendingTrialRemaining, clearPendingTrialRemaining } from '../services/trialClient'
import { purgeComposerDraftsForActiveUser } from '../services/composerDrafts'

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
    adoptPendingTrialRemaining()
    // Legacy reports predate account scoping and contain no owner metadata.
    // They cannot be assigned safely, so remove them on the first authenticated
    // boot instead of leaving personal HTML globally readable.
    purgeLegacyGlobalReports()
    const keys = scoped.getJSON<StoredKeys>('api-keys')
    if (!keys?.anthropic) return
    setActiveKeys(keys.anthropic, keys.gemini, keys.mistral, keys.openai)
    initCrypto(keys.anthropic)
      .then(() => Promise.all([bootstrapGoogleStorage(), bootstrapFileStorage(), bootstrapConversationStorage()]))
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
    adoptPendingTrialRemaining()

    // Migrate existing data if first login after update
    migrateExistingData(userId)

    // Initialize encryption with the API key, then migrate any legacy
    // plain-JSON Google tokens into encrypted storage.
    await initCrypto(credentials.anthropicKey)
    await bootstrapGoogleStorage()
    bootstrapConversationStorage().catch(() => {})
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
    const leavingUserId = getActiveUserId()
    // Clear everything synchronously first (both plain + encrypted copies)
    clearActiveKeys()
    googleLogout()
    // Wipe usage metrics scoped to the leaving user — these are pure
    // counters/configs with no UX value to keep across a logout, and
    // they leak usage patterns on a shared device. Conversations and
    // pinned messages are intentionally kept (user request).
    scoped.removeItem('cost_history')
    scoped.removeItem('cost_alert')
    // BUG 41 fix (étape 9 audit) — `api-keys` stocké en clair dans
    // localStorage. Le laissait au logout faisait que la passphrase
    // crypto du user partant restait dispo pour le prochain user qui
    // se logge sur le même appareil. Wipe explicite.
    scoped.removeItem('api-keys')
    // BUG 41 — révoque + supprime le jeton d'essai email AVANT clearActiveSession
    // (le scopedStorage résout le préfixe via la session active). Sans ça, le
    // jeton resterait utilisable par le prochain user du même appareil.
    clearTrialToken()
    // C-E (revue PR 4, 2 agents) — purge le cache de plan GLOBAL : un 'free'
    // résiduel (essai email/Google du user partant) épinglerait le prochain
    // compte PAYANT sur Haiku le temps du premier fetch /api/subscription/status.
    // Trou pré-existant (jamais purgé), rendu plus fréquent par l'écriture du
    // flux essai email — fermé ici pour tous les flux.
    try { localStorage.removeItem('arty-plan-cache') } catch { /* noop */ }
    // F-14 — les familles autorisées suivent le même cycle de vie que le plan
    // (cache global rempli par usePlanStatus) : purge symétrique.
    try { localStorage.removeItem('arty-allowed-families') } catch { /* noop */ }
    clearWalletCache()
    clearPendingTrialRemaining()
    // Revue PR #353 — brouillons du composeur (mémoire + blobs chiffrés
    // `arty-composer-draft:*`). Même hygiène que BUG 41 : aucune famille de
    // clés du user partant ne doit survivre. AVANT clearActiveSession — le
    // scope userId doit encore pointer sur le compte qui part.
    purgeComposerDraftsForActiveUser()
    // Drop any pending OAuth state nonce (e.g. user clicked Google then
    // logged out before completing the redirect).
    clearOAuthState()
    // A simple logout keeps encrypted conversations AND their attachments on
    // this device. Owner scoping prevents another account from reading them;
    // permanent deletion remains the explicit "delete account" flow.
    resetConversationMemCache()
    clearActiveSession()
    if (leavingUserId) removeKnownSession(leavingUserId)
    setCurrentUser(null)
    setKnownSessions(getKnownSessions())

    // Sign out from native Google Sign-In in background (don't await)
    import('@capacitor/core').then(({ Capacitor, registerPlugin }) => {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
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
    // C-E — le cache de plan est GLOBAL : celui du compte quitté ne doit pas
    // router les modèles du compte suivant (usePlanStatus le re-remplit au
    // premier fetch). Symétrique de la purge du logout.
    try { localStorage.removeItem('arty-plan-cache') } catch { /* noop */ }
    try { localStorage.removeItem('arty-allowed-families') } catch { /* noop */ }
    clearWalletCache()
    clearPendingTrialRemaining()

    // Activate new session
    setActiveSession(session)

    // Restore new user's API keys
    const keys = scoped.getJSON<StoredKeys>('api-keys')
    if (keys?.anthropic) {
      await initCrypto(keys.anthropic)
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
