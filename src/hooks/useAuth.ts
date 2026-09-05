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
  getActiveSessionEpoch,
  rememberSession,
  removeKnownSession,
  type UserSession,
  type AuthMethod,
} from '../services/userSession'
import { setActiveKeys, clearActiveKeys } from '../services/activeApiKey'
import { initCrypto, isCryptoReady, isCryptoContextChanged, CryptoContextChanged } from '../services/crypto'
import { bootstrapGoogleStorage, logout as googleLogout, clearOAuthState, resetGoogleMemCache } from '../services/googleAuth'
import { bootstrapFileStorage } from '../services/secureFileStorage'
import { bootstrapConversationStorage, resetConversationMemCache } from '../services/storage'
import * as scoped from '../services/scopedStorage'
import { clearTrialToken } from '../services/emailTrialClient'
import { clearWalletCache } from '../services/walletClient'
import { adoptPendingTrialRemaining, clearPendingTrialRemaining } from '../services/trialClient'
import { purgeComposerDraftsForActiveUser } from '../services/composerDrafts'
import { resetMailAccountsCache } from '../services/mailAccounts'
import { getDocumentStorageLayout } from '../services/workspaceWriter/runtime'

type StoredKeys = { anthropic: string; gemini?: string; mistral?: string; openai?: string }

export interface AuthFinalizationContext {
  userId: string
  sessionEpoch: number
}

// Les clés crypto et les caches Google sont globaux au WebView. Deux
// finalisations concurrentes ne peuvent donc pas être rendues sûres par le
// seul préfixe localStorage : on sérialise toutes les mutations de session.
let authTransactionInFlight = false

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
    if (!currentUser || currentUser.userId !== getActiveUserId()) return
    const owner = currentUser.userId, epoch = getActiveSessionEpoch()
    let cancelled = false
    const current = () => !cancelled && owner === getActiveUserId() && epoch === getActiveSessionEpoch()
    // Legacy reports predate account scoping and contain no owner metadata.
    // They cannot be assigned safely, so remove them on the first authenticated
    // boot instead of leaving personal HTML globally readable.
    if (getDocumentStorageLayout().kind === 'legacy-v1') purgeLegacyGlobalReports()
    const keys = scoped.getJSON<StoredKeys>('api-keys')
    if (!keys?.anthropic) return
    setActiveKeys(keys.anthropic, keys.gemini, keys.mistral, keys.openai)
    const initialize = isCryptoReady() ? Promise.resolve() : initCrypto(keys.anthropic, {
      assertCurrent: () => { if (!current()) throw new CryptoContextChanged() },
    })
    initialize
      .then(() => {
        if (current()) {
          adoptPendingTrialRemaining()
          return Promise.all([bootstrapGoogleStorage(), bootstrapFileStorage(), bootstrapConversationStorage()])
        }
      })
      .catch((err) => {
        if (current() && !isCryptoContextChanged(err)) console.error('[useAuth] crypto bootstrap failed:', err)
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
    },
    beforePublish?: (
      session: UserSession,
      context: AuthFinalizationContext,
    ) => Promise<void>,
  ) => {
    if (authTransactionInFlight) {
      throw new Error('Authentication is already in progress')
    }
    // `login()` construit un NOUVEAU contexte crypto/scopé. Une reconnexion
    // Google d'un compte déjà publié passe par useGoogleAuth et ne doit jamais
    // entrer ici : restaurer correctement une ancienne clé crypto, ses clés
    // BYOK et son grant après un échec serait une transaction multi-stockages.
    // Refuser avant toute mutation est la seule sémantique atomique.
    if (getActiveSession()) {
      throw new Error('Sign out before starting a new login')
    }
    authTransactionInFlight = true
    try {
      const userId = await generateUserId(method, credentials.identifier)

      const session: UserSession = {
        userId,
        authMethod: method,
        displayName: credentials.displayName,
        email: credentials.email,
        avatar: credentials.avatar,
        createdAt: Date.now(),
      }

      // Active provisoirement le scope local sans publier le compte dans React
      // ni dans la liste des comptes connus. Le finaliseur Google/email peut
      // ainsi persister son grant sous le bon userId et avec la bonne clé crypto.
      setActiveSession(session, { remember: false })
      const provisionalEpoch = getActiveSessionEpoch()
      const assertCurrentAttempt = () => {
        if (
          getActiveUserId() !== userId
          || getActiveSessionEpoch() !== provisionalEpoch
        ) throw new Error('Authentication finalization was superseded')
      }
      const previousApiKeys = scoped.getItem('api-keys')
      let writtenApiKeys: string | null = null
      let cryptoInitialized = false
      try {
      // Migrate existing data if first login after update
      migrateExistingData(userId)

      // Initialize encryption with the API key, then migrate any legacy
      // plain-JSON Google tokens into encrypted storage.
      await initCrypto(credentials.anthropicKey)
      assertCurrentAttempt()
      cryptoInitialized = true
      adoptPendingTrialRemaining()
      await bootstrapGoogleStorage()
      assertCurrentAttempt()
      // L'admission froide a déjà vérifié la compatibilité du stockage avant
      // de charger ce hook. Ces chargements restent optionnels après admission
      // (ex. quota), mais allSettled ne contourne jamais ce contrôle initial.
      // On attend leur stabilisation pour conserver l'ordre de la transaction.
      await Promise.allSettled([bootstrapConversationStorage(), bootstrapFileStorage()])
      assertCurrentAttempt()

      // Store API keys as plain JSON for sync reads (getJSON in useEffect)
      // DO NOT encrypt with migrateKey — it overwrites plain with encrypted,
      // making getJSON() fail on page reload (see BUG 1 in CLAUDE.md)
      writtenApiKeys = JSON.stringify({
        anthropic: credentials.anthropicKey,
        gemini: credentials.geminiKey,
        mistral: credentials.mistralKey,
        openai: credentials.openaiKey,
      })
      scoped.setItem('api-keys', writtenApiKeys)

      // Set active keys in memory for AI clients
      setActiveKeys(
        credentials.anthropicKey,
        credentials.geminiKey,
        credentials.mistralKey,
        credentials.openaiKey
      )

      assertCurrentAttempt()
      await beforePublish?.(session, {
        userId,
        sessionEpoch: provisionalEpoch,
      })
      assertCurrentAttempt()

      // Le grant/jeton est durable : la session devient maintenant visible.
      rememberSession(session)
      setCurrentUser(session)
      setKnownSessions(getKnownSessions())
      return session
      } catch (error) {
      // Ne jamais déconnecter un compte qui aurait remplacé cette tentative
      // pendant un await. Seule l'époque provisoire fautive est nettoyée.
      if (
        getActiveUserId() === userId
        && getActiveSessionEpoch() === provisionalEpoch
      ) {
        clearActiveKeys()
        if (method === 'google' && cryptoInitialized) {
          googleLogout({ notify: false })
        }
        // A local recovery refusal precedes any grant/bootstrap write. Never
        // delete a previously stored grant merely because crypto could not open.
        if (method === 'google') resetGoogleMemCache()
        // Un échec de reconnexion ne doit jamais effacer les clés BYOK qui
        // existaient déjà pour ce compte. Restaurer seulement si notre propre
        // écriture est encore présente (pas une édition plus récente).
        if (writtenApiKeys !== null && scoped.getItem('api-keys') === writtenApiKeys) {
          if (previousApiKeys === null) scoped.removeItem('api-keys')
          else scoped.setItem('api-keys', previousApiKeys)
        }
        clearActiveSession()
      }
      throw error
      }
    } finally {
      authTransactionInFlight = false
    }
  }, [])

  const logout = useCallback(() => {
    if (authTransactionInFlight) {
      console.warn('[useAuth] logout ignored while authentication is finalizing')
      return
    }
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
    // Comptes mail IMAP natifs : même politique que les conversations — les
    // credentials restent dans le Keystore de l'appareil, scopés par userId
    // Arty (un autre compte ne peut pas les lire). Seul le cache mémoire est
    // vidé pour que les outils mail disparaissent immédiatement du prompt.
    // Suppression définitive : Réglages → Boîtes mail, ou suppression du compte.
    resetMailAccountsCache()
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
    if (authTransactionInFlight) {
      throw new Error('Authentication is already in progress')
    }
    authTransactionInFlight = true
    try {
    const known = getKnownSessions()
    const session = known.find(s => s.userId === userId)
    if (!session) return

    // Clear old keys AND the in-memory Google token cache BEFORE switching
    // session — otherwise getStoredTokens() returns the previous account's
    // tokens during the switch window, before bootstrap repopulates them.
    clearActiveKeys()
    resetGoogleMemCache()
    resetConversationMemCache()
    // BUG 6 — cache mail vidé AVANT setActiveSession : sinon les outils mail
    // du compte quitté resteraient exposés pendant la fenêtre de switch.
    resetMailAccountsCache()
    // C-E — le cache de plan est GLOBAL : celui du compte quitté ne doit pas
    // router les modèles du compte suivant (usePlanStatus le re-remplit au
    // premier fetch). Symétrique de la purge du logout.
    try { localStorage.removeItem('arty-plan-cache') } catch { /* noop */ }
    try { localStorage.removeItem('arty-allowed-families') } catch { /* noop */ }
    clearWalletCache()
    clearPendingTrialRemaining()

    // Activate new session
    setCurrentUser(null) // Never keep account A's UI over account B's active scope.
    setActiveSession(session)
    const epoch = getActiveSessionEpoch()
    const current = () => getActiveUserId() === userId && getActiveSessionEpoch() === epoch
    const assertCurrent = () => { if (!current()) throw new CryptoContextChanged() }

    // Restore new user's API keys
    try {
    const keys = scoped.getJSON<StoredKeys>('api-keys')
    if (keys?.anthropic) {
      await initCrypto(keys.anthropic, { assertCurrent })
      assertCurrent()
      await bootstrapGoogleStorage()
      assertCurrent()
      await Promise.allSettled([bootstrapConversationStorage(), bootstrapFileStorage()])
      assertCurrent()
      setActiveKeys(keys.anthropic, keys.gemini, keys.mistral, keys.openai)
    }

    assertCurrent()
    setCurrentUser(session)
    } catch (error) {
      if (current()) {
        clearActiveKeys()
        resetGoogleMemCache()
        resetConversationMemCache()
        resetMailAccountsCache()
        clearActiveSession()
        setCurrentUser(null)
      }
      throw error
    }
    } finally {
      authTransactionInFlight = false
    }
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
