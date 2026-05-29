import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { useConversation } from './hooks/useConversation'
import { useAppSetup } from './hooks/useAppSetup'
import { useAuth } from './hooks/useAuth'
import { initCrypto, isCryptoReady } from './services/crypto'
import { bootstrapGoogleStorage, storeTokens, storeUser } from './services/googleAuth'
import { clearActiveKeys } from './services/activeApiKey'
import { bootstrapConversationStorage } from './services/storage'
import { getJSON } from './services/scopedStorage'
import { QuestionModal } from './components/chat/QuestionModal'
import { MorningBrief } from './components/home/MorningBrief'
import { HomeScreen } from './components/home/HomeScreen'
import { shouldShowMorningBrief } from './services/morningBriefService'
import { useProactiveBrief } from './hooks/useProactiveBrief'
import { isProactiveBriefEnabled } from './services/proactiveBriefSettings'
import { ConversationScreen } from './components/chat/ConversationScreen'
import { ReportPage } from './components/shared/ReportPage'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { Toaster } from './components/shared/Toaster'
import { Sidebar } from './components/layout/Sidebar'
import { OAuthCallback } from './components/google/OAuthCallback'
import { LoginScreen } from './components/auth/LoginScreen'
import { WelcomeSlides, isOnboardingDone } from './components/onboarding/WelcomeSlides'
import {
  OnboardingChoice,
  TrialIntro,
  VipSplash,
  isOnboardingChoiceDone,
  markOnboardingChoiceDone,
} from './components/onboarding/OnboardingChoice'
import {
  clearOnboardingSplash,
  getOnboardingSplash,
  getTrialRemaining,
  initTrial,
} from './services/trialClient'
import { ProfileSetupModal } from './components/onboarding/ProfileSetupModal'
import { getUserProfile } from './services/userProfile'
// H-Perf-2 (audit étape 7) — lazy-load des screens hors chemin critique.
// Avant : main chunk 514KB incluait tout, même pour afficher juste le login.
// `CurrentPlan` reste un import type-only (pas de runtime cost).
import type { CurrentPlan } from './screens/upgrade'
const UpgradeScreen = lazy(() => import('./screens/upgrade').then((m) => ({ default: m.UpgradeScreen })))
const TemplatesScreen = lazy(() => import('./screens/templates').then((m) => ({ default: m.TemplatesScreen })))
const CostsScreen = lazy(() => import('./screens/costs').then((m) => ({ default: m.CostsScreen })))
const ComparatorScreen = lazy(() => import('./screens/compare').then((m) => ({ default: m.ComparatorScreen })))

// Fallback pendant le chargement des chunks lazy — petit splash neutre,
// disparaît dès que le chunk arrive (<200ms en pratique sur 4G).
function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full text-theme-muted text-sm">
      Chargement…
    </div>
  )
}
import { checkBudgetAlert, formatCost } from './services/costTracker'
import {
  addShareListener,
  buildDraftFromShare,
  getPendingShare,
  setPendingDraft,
  type SharePayload,
} from './services/shareTargetService'
import type { FileAttachment } from './types'

function AppContent({
  onLogout,
  userName,
  authMethod,
  userEmail,
}: {
  onLogout: () => void
  userName?: string
  authMethod?: 'google' | 'email' | 'apikey'
  userEmail?: string
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showMorningBrief, setShowMorningBrief] = useState(false)
  const [showProfileSetup, setShowProfileSetup] = useState(() => getUserProfile() === null)
  const [profileName, setProfileName] = useState<string | null>(() => getUserProfile()?.name || null)
  const [budgetAlert, setBudgetAlert] = useState<{ spent: number; limit: number } | null>(() => {
    const res = checkBudgetAlert()
    return res?.triggered ? { spent: res.spent, limit: res.limit } : null
  })
  const [shareError, setShareError] = useState<string | null>(null)
  const navigate = useNavigate()

  // Listen for profile updates so the Home hero refreshes without reload
  useEffect(() => {
    const sync = () => {
      const profile = getUserProfile()
      setProfileName(profile?.name || null)
      if (profile !== null) setShowProfileSetup(false)
    }
    window.addEventListener('user-profile-changed', sync)
    return () => window.removeEventListener('user-profile-changed', sync)
  }, [])

  const conversation = useConversation()
  const {
    conversations,
    activeConversation,
    activeId,
    isStreaming,
    streamingContent,
    streamingConvIds,
    error,
    createConversation,
    selectConversation,
    clearActive,
    sendMessage,
    deleteConversation,
    branchConversation,
    stopStreaming,
    togglePinMessage,
    editAndResend,
    retryMessage,
    retryLastUserMessage,
    renameConversation,
    clearError,
  } = conversation

  // Show legacy morning brief once per day between 6h-11h — sauf si le brief
  // proactif (IA, à chaque ouverture) est actif : il le remplace pour éviter
  // deux briefs concurrents.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isProactiveBriefEnabled() && shouldShowMorningBrief()) setShowMorningBrief(true)
    }, 1500) // small delay to let the app finish loading
    return () => clearTimeout(timer)
  }, [])

  const {
    googleAuth,
    gmail,
    drive,
    browserActions,
    computerActions,
    actionScreenshot,
    setActionScreenshot,
    questionModal,
    handleAction,
  } = useAppSetup(conversation)

  const handleSendFromHome = useCallback(
    (text: string, files?: FileAttachment[]) => {
      setActionScreenshot(null)
      const isFirstConv = conversations.length === 0
      const id = createConversation(isFirstConv)
      if (files?.length) {
        navigate(`/chat/${id}`)
        setTimeout(() => sendMessage(text, id, files), 100)
      } else {
        sendMessage(text, id)
        navigate(`/chat/${id}`)
      }
    },
    [createConversation, sendMessage, navigate, setActionScreenshot, conversations.length]
  )

  // Brief proactif (façon "Daily Brief") : généré tout seul à l'ouverture / au
  // retour dans l'app (lecture seule, Haiku, anti-doublon, cadence matin). Les
  // chips d'action passent par handleSendFromHome (humain dans la boucle) ou une
  // tâche locale. Rendu sur l'accueil.
  const proactiveBrief = useProactiveBrief({
    gmail,
    isGoogleConnected: googleAuth.isConnected,
    userName: profileName || userName,
    onSend: handleSendFromHome,
  })

  const handleNewConversation = useCallback(() => {
    const isFirstConv = conversations.length === 0
    const id = createConversation(isFirstConv)
    navigate(`/chat/${id}`)
  }, [createConversation, navigate, conversations.length])

  // Share-to-Arty: handles a payload coming from the Android Share menu.
  // Creates a fresh conversation, hands the draft off to ConversationScreen
  // via the in-memory pending draft, and never auto-sends — the user must
  // confirm or edit the suggested prompt first.
  const handleSharedContent = useCallback(
    (payload: SharePayload) => {
      if (payload.error === 'file_too_large') {
        setShareError('Fichier trop volumineux (>10 MB), partage annulé.')
        return
      }
      const draft = buildDraftFromShare(payload)
      if (!draft) return
      setActionScreenshot(null)
      setPendingDraft(draft)
      const isFirstConv = conversations.length === 0
      const id = createConversation(isFirstConv)
      navigate(`/chat/${id}`)
    },
    [conversations.length, createConversation, navigate, setActionScreenshot]
  )

  // Wire the Share intent listener once auth + the navigator are ready.
  // - On mount, drain any cold-start share captured by the plugin's load().
  // - Subscribe to `shareReceived` for warm-start shares (singleTask reuses
  //   the activity instead of spawning a new one, so onNewIntent fires).
  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false
    void getPendingShare().then((payload) => {
      if (!cancelled && payload) handleSharedContent(payload)
    })
    void addShareListener((payload) => {
      handleSharedContent(payload)
    }).then((remove) => {
      if (cancelled) remove()
      else cleanup = remove
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [handleSharedContent])

  const handleNewEUConversation = useCallback(() => {
    const id = createConversation(false, true)
    navigate(`/chat/${id}`)
  }, [createConversation, navigate])

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActionScreenshot(null)
      selectConversation(id)
      navigate(`/chat/${id}`)
    },
    [selectConversation, navigate, setActionScreenshot]
  )

  // Callbacks stables pour la Sidebar (memo) et ChatRoute — les littéraux
  // inline recréés à chaque render court-circuitaient le memo pendant le
  // streaming (audit perf H2).
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  const handleImportConversation = useCallback(
    (id: string) => {
      selectConversation(id)
      navigate(`/chat/${id}`)
    },
    [selectConversation, navigate]
  )
  const handleOpenTemplates = useCallback(() => navigate('/templates'), [navigate])
  const handleSendInChat = useCallback(
    (text: string, files?: FileAttachment[]) => sendMessage(text, undefined, files),
    [sendMessage]
  )

  const handleBack = useCallback(() => {
    setActionScreenshot(null)
    clearActive()
    navigate('/')
  }, [clearActive, navigate, setActionScreenshot])

  const handleBranch = useCallback(
    (messageIndex: number) => {
      if (!activeId) return
      const newId = branchConversation(activeId, messageIndex)
      if (newId) {
        selectConversation(newId)
        navigate(`/chat/${newId}`)
      }
    },
    [activeId, branchConversation, selectConversation, navigate]
  )

  const handleTogglePin = useCallback(
    (messageId: string) => {
      if (!activeId) return
      togglePinMessage(activeId, messageId)
    },
    [activeId, togglePinMessage]
  )

  const handleOAuthCallback = useCallback(
    async (code: string) => {
      await googleAuth.handleCallback(code)
    },
    [googleAuth]
  )

  // Open the upgrade screen on demand (Settings button) or after a 403
  // `no_active_subscription` / 429 `premium_cap_reached`. We listen on a
  // window CustomEvent so child components don't need prop drilling.
  // Demande à Chrome web de garder le storage persistant (BUG 49 — sur web,
  // localStorage peut être évincé sous pression mémoire/disque, ce qui purge
  // les tokens Google et force la reconnexion. Avec persist(), Chrome garde
  // le storage tant que l'utilisateur n'efface pas explicitement les
  // données. No-op sur Capacitor natif (pas d'éviction).
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const open = () => navigate('/upgrade')
    window.addEventListener('arty-open-upgrade', open)
    return () => window.removeEventListener('arty-open-upgrade', open)
  }, [navigate])

  useEffect(() => {
    const open = () => navigate('/compare')
    window.addEventListener('arty-open-compare', open)
    return () => window.removeEventListener('arty-open-compare', open)
  }, [navigate])

  // Open the costs dashboard from Settings — same CustomEvent pattern as Upgrade.
  useEffect(() => {
    const open = () => navigate('/costs')
    window.addEventListener('arty-open-costs', open)
    return () => window.removeEventListener('arty-open-costs', open)
  }, [navigate])

  useEffect(() => {
    if (!error) return
    if (error.includes('no_active_subscription')) {
      navigate('/upgrade')
    } else if (error.includes('premium_cap_reached')) {
      navigate('/upgrade?scroll=premium')
    }
  }, [error, navigate])

  const currentPlan: CurrentPlan = authMethod === 'apikey' ? 'byok' : 'unknown'

  return (
    <div
      className="bg-theme-bg text-theme-ink font-sans font-light"
      style={{ height: 'var(--viewport-h, 100dvh)' }}
    >
      {shareError && (
        <div
          className="fixed top-0 inset-x-0 z-[61] bg-red-600 text-white px-4 py-2.5 flex items-center justify-between gap-3"
          style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top, 0.625rem))' }}
        >
          <p className="font-display italic text-sm">⚠️ {shareError}</p>
          <button
            onClick={() => setShareError(null)}
            className="font-display italic text-xs"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
      )}

      {budgetAlert && (
        <div
          className="fixed top-0 inset-x-0 z-[60] bg-theme-accent text-theme-bg px-4 py-2.5 flex items-center justify-between gap-3"
          style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top, 0.625rem))' }}
        >
          <p className="font-display italic text-sm">
            ⚠️ Budget IA dépassé — {formatCost(budgetAlert.spent)} / {formatCost(budgetAlert.limit)} ce mois-ci.
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                setBudgetAlert(null)
                navigate('/costs')
              }}
              className="font-display italic text-xs underline"
            >
              Voir
            </button>
            <button
              onClick={() => setBudgetAlert(null)}
              className="font-display italic text-xs"
              aria-label="Fermer l'alerte"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <TrialBanner onUpgrade={() => navigate('/upgrade')} />

      <Sidebar
        isOpen={sidebarOpen}
        onClose={closeSidebar}
        conversations={conversations}
        activeId={activeId}
        streamingConvIds={streamingConvIds}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onNewEU={handleNewEUConversation}
        onDelete={deleteConversation}
        onRename={renameConversation}
        userName={profileName || userName}
        onLogout={onLogout}
        onImportConversation={handleImportConversation}
        onOpenTemplates={handleOpenTemplates}
      />

      <main className="h-full">
      <Routes>
        <Route
          path="/"
          element={
            <HomeScreen
              onMenuToggle={() => setSidebarOpen((o) => !o)}
              onSend={handleSendFromHome}
              isStreaming={isStreaming}
              googleAuth={googleAuth}
              gmail={gmail}
              drive={drive}
              userName={profileName || userName}
              proactiveBrief={proactiveBrief.brief}
              briefLoading={proactiveBrief.loading}
              onDismissBrief={proactiveBrief.dismiss}
              onBriefAction={proactiveBrief.runAction}
            />
          }
        />
        <Route
          path="/auth/callback"
          element={<OAuthCallback onCallback={handleOAuthCallback} />}
        />
        <Route
          path="/upgrade"
          element={
            <Suspense fallback={<LazyFallback />}>
              <UpgradeScreen
                onBack={() => navigate('/')}
                currentPlan={currentPlan}
                email={userEmail}
              />
            </Suspense>
          }
        />
        <Route
          path="/templates"
          element={
            <Suspense fallback={<LazyFallback />}>
              <TemplatesScreen
                onBack={() => navigate('/')}
                onUpgrade={() => navigate('/upgrade')}
                onUseTemplate={(prompt) => handleSendFromHome(prompt)}
                currentPlan={currentPlan}
              />
            </Suspense>
          }
        />
        <Route
          path="/costs"
          element={
            <Suspense fallback={<LazyFallback />}>
              <CostsScreen onBack={() => navigate('/')} />
            </Suspense>
          }
        />
        <Route
          path="/compare"
          element={
            <Suspense fallback={<LazyFallback />}>
              <ComparatorScreen onBack={() => navigate('/')} />
            </Suspense>
          }
        />
        <Route
          path="/report/:id"
          element={<ReportPage />}
        />
        <Route
          path="/chat/:id"
          element={
            <ChatRoute
              activeConversation={activeConversation}
              isStreaming={isStreaming}
              streamingContent={streamingContent}
              error={error}
              onBack={handleBack}
              onSend={handleSendInChat}
              onStop={stopStreaming}
              onSelect={selectConversation}
              gmail={gmail}
              drive={drive}
              browserActions={browserActions}
              computerActions={computerActions}
              actionScreenshot={actionScreenshot}
              onAction={handleAction}
              onBranch={handleBranch}
              onTogglePin={handleTogglePin}
              onEdit={editAndResend}
              onRetry={retryMessage}
              onRetryError={retryLastUserMessage}
              onDismissError={clearError}
              conversations={conversations}
              onSelectConv={handleSelectConversation}
            />
          }
        />
      </Routes>
      </main>

      {questionModal && (
        <QuestionModal
          questions={questionModal.questions}
          onComplete={questionModal.resolve}
        />
      )}

      {showMorningBrief && (
        <MorningBrief
          onClose={() => setShowMorningBrief(false)}
          onSend={handleSendFromHome}
          userName={profileName || userName}
          isGoogleConnected={googleAuth.isConnected}
        />
      )}

      {showProfileSetup && (
        <ProfileSetupModal onClose={() => setShowProfileSetup(false)} />
      )}
    </div>
  )
}

/**
 * Bandeau d'essai gratuit. Lit `getTrialRemaining()` (storage localStorage)
 * + écoute l'event `arty-trial-remaining-changed` émis par les AI clients
 * à chaque réponse contenant le header `x-trial-remaining`. Pas de
 * polling : se rafraîchit uniquement quand le compteur change.
 */
function TrialBanner({ onUpgrade }: { onUpgrade: () => void }) {
  const [remaining, setRemaining] = useState<number | null>(() => getTrialRemaining())

  useEffect(() => {
    const sync = () => setRemaining(getTrialRemaining())
    window.addEventListener('arty-trial-remaining-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('arty-trial-remaining-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  if (remaining === null) return null

  if (remaining === 0) {
    return (
      <div
        className="sticky top-0 z-[55] bg-theme-ink text-theme-bg px-4 py-2 flex items-center justify-between gap-3"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0.5rem))' }}
      >
        <p className="font-display italic text-sm">
          Essai terminé — Choisis un plan pour continuer
        </p>
        <button
          onClick={onUpgrade}
          className="font-display italic text-xs underline shrink-0"
        >
          Voir les plans →
        </button>
      </div>
    )
  }

  return (
    <div
      className="sticky top-0 z-[55] bg-theme-accent/15 text-theme-ink px-4 py-1.5 flex items-center justify-between gap-3"
      style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top, 0.375rem))' }}
    >
      <p className="font-display italic text-xs">
        ✨ Essai gratuit — {remaining} message{remaining > 1 ? 's' : ''} restant{remaining > 1 ? 's' : ''}
      </p>
      <button
        onClick={onUpgrade}
        className="font-display italic text-xs underline shrink-0"
      >
        Passer à Pro
      </button>
    </div>
  )
}

interface ChatRouteProps {
  activeConversation: ReturnType<typeof useConversation>['activeConversation']
  isStreaming: boolean
  streamingContent: string
  error: string | null
  onBack: () => void
  onSend: (text: string, files?: FileAttachment[]) => void
  onStop: () => void
  onSelect: (id: string) => void
  gmail: ReturnType<typeof import('./hooks/useGmail').useGmail>
  drive: ReturnType<typeof import('./hooks/useDrive').useDrive>
  browserActions: ReturnType<typeof import('./hooks/useBrowser').useBrowser>
  computerActions: ReturnType<typeof import('./hooks/useComputer').useComputer>
  actionScreenshot: string | null
  onAction?: (action: string, params: Record<string, string>) => void
  onBranch?: (messageIndex: number) => void
  onTogglePin?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRetry?: (messageId: string) => void
  onRetryError?: () => void
  onDismissError?: () => void
  conversations: ReturnType<typeof useConversation>['conversations']
  onSelectConv: (id: string) => void
}

function ChatRoute({
  activeConversation,
  isStreaming,
  streamingContent,
  error,
  onBack,
  onSend,
  onStop,
  onSelect,
  gmail,
  drive,
  browserActions,
  computerActions,
  actionScreenshot,
  onAction,
  onBranch,
  onTogglePin,
  onEdit,
  onRetry,
  onRetryError,
  onDismissError,
  conversations,
  onSelectConv,
}: ChatRouteProps) {
  const { id } = useParams<{ id: string }>()

  // CRIT-9 (audit étape 6) — onSelect doit être appelé dans un useEffect,
  // pas directement pendant le render. Sinon React 18 warning "Cannot
  // update a component from inside the function body of a different
  // component" + risque de loop infinie. Le `null` early return reste
  // pendant la transition.
  useEffect(() => {
    if (id && (!activeConversation || activeConversation.id !== id)) {
      onSelect(id)
    }
  }, [id, activeConversation, onSelect])

  if (id && (!activeConversation || activeConversation.id !== id)) {
    return null
  }

  if (!activeConversation) {
    return (
      <div className="flex items-center justify-center h-full text-theme-muted text-sm">
        Conversation introuvable
      </div>
    )
  }

  return (
    <ConversationScreen
      // Force a remount on conversation switch so the share-to-Arty draft
      // (consumed in useState init) is re-applied when navigating directly
      // from /chat/A to /chat/B without leaving the route.
      key={activeConversation.id}
      conversation={activeConversation}
      isStreaming={isStreaming}
      streamingContent={streamingContent}
      error={error}
      onBack={onBack}
      onSend={onSend}
      onStop={onStop}
      gmail={gmail}
      drive={drive}
      browserActions={browserActions}
      computerActions={computerActions}
      actionScreenshot={actionScreenshot}
      onAction={onAction}
      onBranch={onBranch}
      onTogglePin={onTogglePin}
      onEdit={onEdit}
      onRetry={onRetry}
      onRetryError={onRetryError}
      onDismissError={onDismissError}
      conversations={conversations}
      onSelectConv={onSelectConv}
    />
  )
}

export default function App() {
  const auth = useAuth()
  const [deepLinkCode, setDeepLinkCode] = useState<string | null>(null)
  // M3 (audit frontend) — `auth` est un objet neuf à chaque render. L'avoir
  // dans les deps de l'effet processOAuth re-déclenchait l'effet pendant le
  // login (auth.login → re-render) → DEUXIÈME exchangeCode avec un code
  // OAuth single-use déjà consommé → erreur Google stockée alors que le
  // login avait réussi. Lecture via ref + garde sur le code déjà traité.
  const authRef = useRef(auth)
  authRef.current = auth
  const processedDeepLinkRef = useRef<string | null>(null)

  // Initialize AES-256 crypto at startup so later storage writes (Google
  // tokens, conversations) go through the encrypted path. When an
  // authenticated session is already present, derive the key from the
  // Anthropic API key stored under the active user scope; otherwise fall
  // back to a stable per-device salt (initCrypto still requires a
  // passphrase — here we use a predictable device marker that upgrades to
  // the user key as soon as login completes via useAuth).
  useEffect(() => {
    if (isCryptoReady()) return
    const keys = getJSON<{ anthropic?: string }>('api-keys')
    if (!keys?.anthropic) return
    initCrypto(keys.anthropic)
      .then(() => Promise.all([bootstrapGoogleStorage(), bootstrapConversationStorage()]))
      .catch(() => {
        // Non-fatal: useAuth will retry initCrypto once auth resolves.
      })
  }, [])

  // Listen for deep links (native OAuth callback)
  // CSRF state check intentionally NOT done here — `verifyOAuthState()` is
  // single-use and would consume the nonce before `OAuthCallback` (React
  // route) gets a chance to validate it on platforms where both fire. The
  // deeplink is only invokable through an Android Universal Link tied to
  // appfacade.pages.dev (assetlinks.json), so a remote attacker can't forge
  // a malicious callback URL through this path. State verification stays
  // centralized in `OAuthCallback.tsx` for the web/SPA path.
  useEffect(() => {
    let cancelled = false
    let remove: (() => void) | undefined
    async function setupDeepLinks() {
      try {
        const { App: CapApp } = await import('@capacitor/app')
        const handle = await CapApp.addListener('appUrlOpen', (event) => {
          const url = new URL(event.url)
          if (url.pathname === '/auth/callback') {
            const code = url.searchParams.get('code')
            if (code) setDeepLinkCode(code)
          }
        })
        // M3 (audit frontend) — cleanup du listener. Sans lui, StrictMode
        // (dev) et tout remount empilaient des listeners en double.
        if (cancelled) void handle.remove()
        else remove = () => { void handle.remove() }
      } catch {}
    }
    setupDeepLinks()
    return () => {
      cancelled = true
      remove?.()
    }
  }, [])

  // Apply saved theme on app boot + watch the clock for auto Ember/Nocturne switch.
  useEffect(() => {
    if (!auth.isAuthenticated) return
    let cleanup: (() => void) | undefined
    import('./services/themeService').then((m) => {
      cleanup = m.startThemeWatcher()
    })
    return () => { cleanup?.() }
  }, [auth.isAuthenticated])

  // Ask for push notification permission once after login (soft, non-blocking)
  useEffect(() => {
    if (!auth.isAuthenticated) return
    const askedKey = 'arty-notif-asked'
    if (localStorage.getItem(askedKey)) return
    const timer = setTimeout(async () => {
      try {
        const { requestPermission } = await import('./services/notificationService')
        await requestPermission()
        localStorage.setItem(askedKey, '1')
      } catch {}
    }, 5000)
    return () => clearTimeout(timer)
  }, [auth.isAuthenticated])

  // Process deep link OAuth code
  useEffect(() => {
    if (!deepLinkCode) return
    // Garde anti double-fire : un code OAuth Google est single-use.
    if (processedDeepLinkRef.current === deepLinkCode) return
    processedDeepLinkRef.current = deepLinkCode

    async function processOAuth(code: string) {
      try {
        const { exchangeCode, fetchGoogleUser } = await import('./services/googleAuth')
        const tokens = await exchangeCode(code)
        const user = await fetchGoogleUser(tokens.access_token)
        // Pose le splash post-login (vip|trial) AVANT de flipper l'auth.
        await initTrial(tokens.access_token)
        const { generateUserId, setActiveSession } = await import('./services/userSession')
        const userId = await generateUserId('google', user.email)
        // BUG 6 — purger les clés API en mémoire du compte précédent AVANT de
        // repointer le scopedStorage (sinon fenêtre de course : clés de l'ancien
        // compte encore en mémoire pendant que le storage pointe vers le nouveau).
        clearActiveKeys()
        setActiveSession({ userId, authMethod: 'google', displayName: user.name, email: user.email, avatar: user.picture, createdAt: Date.now() })
        const { getJSON } = await import('./services/scopedStorage')
        const existingKeys = getJSON<{ anthropic: string; gemini?: string; mistral?: string; openai?: string }>('api-keys')

        // Login with existing keys or server-provided
        await authRef.current.login('google', {
          displayName: user.name, email: user.email, avatar: user.picture,
          anthropicKey: existingKeys?.anthropic || 'server-provided',
          geminiKey: existingKeys?.gemini,
          mistralKey: existingKeys?.mistral,
          openaiKey: existingKeys?.openai,
          identifier: user.email,
        })
        setSplash(getOnboardingSplash())
      } catch (err) {
        // Stash the error so LoginScreen surfaces it (it drains
        // 'arty-login-error' on mount) — without this a failed deeplink
        // login left the user on the login screen with no explanation.
        console.error('Deep link OAuth error:', err)
        try {
          sessionStorage.setItem(
            'arty-login-error',
            err instanceof Error ? err.message : 'Échec de la connexion Google',
          )
        } catch { /* sessionStorage indisponible */ }
      }
      setDeepLinkCode(null)
    }

    processOAuth(deepLinkCode)
  }, [deepLinkCode])

  const [onboardingDone, setOnboardingDone] = useState(isOnboardingDone)
  const [choiceDone, setChoiceDone] = useState(isOnboardingChoiceDone)
  const [splash, setSplash] = useState(() => getOnboardingSplash())

  if (!auth.isAuthenticated) {
    // Show welcome slides before login (first time only)
    if (!onboardingDone) {
      return <WelcomeSlides onComplete={() => setOnboardingDone(true)} />
    }

    // Then show the welcome / Google / BYOK choice screen, also first time only.
    if (!choiceDone) {
      return (
        <OnboardingChoice
          onApiKeyLogin={async (anthropicKey) => {
            await auth.login('apikey', {
              displayName: 'Utilisateur',
              anthropicKey,
              identifier: anthropicKey,
            })
            // login flips auth.isAuthenticated → this branch unmounts; mark
            // the choice as done so a future logout doesn't replay it.
            markOnboardingChoiceDone()
            setChoiceDone(true)
          }}
          onNativeGoogleLogin={async (
            email,
            name,
            avatar,
            accessToken,
            refreshToken,
            expiresIn
          ) => {
            await auth.login('google', {
              displayName: name,
              email,
              avatar,
              anthropicKey: 'server-provided',
              identifier: email,
            })
            // After auth flips, scopedStorage is keyed to the user — store the
            // Google credentials. storeTokens/storeUser chiffrent au repos et
            // droppent la copie en clair une fois la crypto prête (RÈGLE 5) —
            // contrairement à setJSON qui laissait le refresh_token en clair.
            await storeUser({ email, name, picture: avatar })
            await storeTokens({
              access_token: accessToken,
              refresh_token: refreshToken,
              expires_at: Date.now() + expiresIn * 1000,
            })
            markOnboardingChoiceDone()
            setChoiceDone(true)
            setSplash(getOnboardingSplash())
          }}
          onGoToLogin={() => {
            markOnboardingChoiceDone()
            setChoiceDone(true)
          }}
        />
      )
    }

    return (
      <BrowserRouter>
        <Routes>
          <Route
            path="/auth/callback"
            element={<OAuthCallbackAuth auth={auth} onPostLogin={() => setSplash(getOnboardingSplash())} />}
          />
          <Route path="*" element={
            <LoginScreen
              onLogin={auth.login}
              knownSessions={auth.knownSessions}
              onSwitchAccount={auth.switchAccount}
            />
          } />
        </Routes>
        <Toaster />
      </BrowserRouter>
    )
  }

  // Authenticated. If we just came back from Google with a fresh trial /
  // VIP plan, show the matching splash before mounting the main app.
  if (splash === 'vip') {
    return (
      <VipSplash
        onDone={() => {
          clearOnboardingSplash()
          setSplash(null)
        }}
      />
    )
  }
  if (splash === 'trial') {
    return (
      <TrialIntro
        onDone={() => {
          clearOnboardingSplash()
          setSplash(null)
        }}
        onUpgrade={() => {
          // Push /upgrade into history before clearing the splash so
          // BrowserRouter picks it up on the next render.
          window.history.pushState({}, '', '/upgrade')
          clearOnboardingSplash()
          setSplash(null)
        }}
      />
    )
  }

  return (
    <BrowserRouter>
      {/* M8 (audit frontend) — boundary RACINE. La seule boundary existante
          entourait MessageList : un crash dans Sidebar, InputBar ou un screen
          lazy = écran blanc total sans message. */}
      <ErrorBoundary>
        <AppContent
          onLogout={auth.logout}
          userName={auth.currentUser?.displayName}
          authMethod={auth.currentUser?.authMethod}
          userEmail={auth.currentUser?.email}
        />
      </ErrorBoundary>
      <Toaster />
    </BrowserRouter>
  )
}

/** Handle OAuth callback when not yet authenticated */
function OAuthCallbackAuth({
  auth,
  onPostLogin,
}: {
  auth: ReturnType<typeof useAuth>
  onPostLogin?: () => void
}) {
  const navigate = useNavigate()

  const handleCallback = useCallback(async (code: string) => {
    try {
      const { exchangeCode, fetchGoogleUser } = await import('./services/googleAuth')
      const tokens = await exchangeCode(code)
      const user = await fetchGoogleUser(tokens.access_token)

      // Initialise (ou récupère) le statut trial AVANT de finaliser l'auth :
      // ça pose le splash post-login en localStorage avant que le state
      // React ne flippe et ne remonte le composant racine.
      await initTrial(tokens.access_token)

      // Check if this Google user already has API keys saved
      const { generateUserId, setActiveSession } = await import('./services/userSession')
      const userId = await generateUserId('google', user.email)
      // BUG 6 — purger les clés API en mémoire du compte précédent AVANT de
      // repointer le scopedStorage (fenêtre de course sinon).
      clearActiveKeys()
      // Temporarily set session to read scoped storage
      setActiveSession({ userId, authMethod: 'google', displayName: user.name, email: user.email, avatar: user.picture, createdAt: Date.now() })
      const { getJSON } = await import('./services/scopedStorage')
      const existingKeys = getJSON<{ anthropic: string; gemini?: string; mistral?: string; openai?: string }>('api-keys')

      // Use stored keys if available, otherwise login without keys
      // (server-side proxy provides API keys)
      await auth.login('google', {
        displayName: user.name,
        email: user.email,
        avatar: user.picture,
        anthropicKey: existingKeys?.anthropic || 'server-provided',
        geminiKey: existingKeys?.gemini || undefined,
        mistralKey: existingKeys?.mistral || undefined,
        openaiKey: existingKeys?.openai || undefined,
        identifier: user.email,
      })
      onPostLogin?.()
      navigate('/')
    } catch (err) {
      // LOW (audit étape 8) — au lieu d'absorber silencieusement et rediriger
      // (l'user ne sait pas pourquoi rien ne s'est passé), on stash l'erreur
      // dans sessionStorage. LoginScreen la lit + clear au mount pour
      // l'afficher dans le bandeau d'erreur (cf. handleApiKeyLogin).
      console.error('OAuth callback error:', err)
      try {
        const msg = err instanceof Error ? err.message : 'Échec de la connexion Google'
        sessionStorage.setItem('arty-login-error', msg)
      } catch { /* sessionStorage indisponible (mode privé), tant pis */ }
      navigate('/')
    }
  }, [auth, navigate, onPostLogin])

  return <OAuthCallback onCallback={handleCallback} />
}
