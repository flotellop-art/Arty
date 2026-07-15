import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useConversation } from './hooks/useConversation'
import { useAppSetup } from './hooks/useAppSetup'
import { useAuth } from './hooks/useAuth'
import { initCrypto, isCryptoReady } from './services/crypto'
import { bootstrapGoogleStorage } from './services/googleAuth'
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
import { ApiKeysModal } from './components/settings/ApiKeysModal'
import { CapReachedModal } from './components/chat/CapReachedModal'
import { OAuthCallback } from './components/google/OAuthCallback'
import { LoginScreen } from './components/auth/LoginScreen'
import { SharedConversationView } from './components/share/SharedConversationView'
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
  initEmailTrialSplash,
} from './services/trialClient'
import { setTrialToken } from './services/emailTrialClient'
import { canPurchase } from './services/checkout'
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
// Landing marketing (item 16 roadmap v2) — vue uniquement par les
// primo-visiteurs web ; les utilisateurs connectés ne la téléchargent jamais.
const LandingScreen = lazy(() => import('./screens/landing').then((m) => ({ default: m.LandingScreen })))

// Fallback pendant le chargement des chunks lazy — petit splash neutre,
// disparaît dès que le chunk arrive (<200ms en pratique sur 4G).
function LazyFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center h-full text-theme-muted text-sm">
      {t('common.loading')}
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
import type { ChatSendHandler } from './types'

function AppContent({
  onLogout,
  userName,
  authMethod,
  userEmail,
}: {
  onLogout: () => void
  userName?: string
  authMethod?: 'google' | 'email' | 'apikey' | 'demo'
  userEmail?: string
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // PR D — propriétaire unique de l'ApiKeysModal (Sidebar + écran Upgrade).
  const [showApiKeys, setShowApiKeys] = useState(false)
  const [showMorningBrief, setShowMorningBrief] = useState(false)
  const [showProfileSetup, setShowProfileSetup] = useState(() => getUserProfile() === null)
  const [profileName, setProfileName] = useState<string | null>(() => getUserProfile()?.name || null)
  const [budgetAlert, setBudgetAlert] = useState<{ spent: number; limit: number } | null>(() => {
    const res = checkBudgetAlert()
    return res?.triggered ? { spent: res.spent, limit: res.limit } : null
  })
  const [shareError, setShareError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { t } = useTranslation()

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
    setConversationTags,
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
    drive,
    computerActions,
    actionScreenshot,
    setActionScreenshot,
    questionModal,
    handleAction,
  } = useAppSetup(conversation)

  const handleSendFromHome: ChatSendHandler = useCallback(
    (text, files, options) => {
      setActionScreenshot(null)
      const isFirstConv = conversations.length === 0
      const id = createConversation(isFirstConv)
      // Storage pas prêt (ou déchiffrement en échec) : l'erreur visible est
      // déjà posée par createConversation — on reste sur la Home au lieu de
      // naviguer vers une conversation fantôme (écran vide).
      if (!id) return
      if (files?.length) {
        navigate(`/chat/${id}`)
        setTimeout(() => sendMessage(text, id, files, options), 100)
      } else {
        sendMessage(text, id, undefined, options)
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
    isGoogleConnected: googleAuth.isConnected,
    userName: profileName || userName,
    onSend: handleSendFromHome,
  })

  const handleNewConversation = useCallback(() => {
    const isFirstConv = conversations.length === 0
    const id = createConversation(isFirstConv)
    if (!id) return
    navigate(`/chat/${id}`)
  }, [createConversation, navigate, conversations.length])

  // Share-to-Arty: handles a payload coming from the Android Share menu.
  // Creates a fresh conversation, hands the draft off to ConversationScreen
  // via the in-memory pending draft, and never auto-sends — the user must
  // confirm or edit the suggested prompt first.
  const handleSharedContent = useCallback(
    (payload: SharePayload) => {
      if (payload.error === 'file_too_large') {
        setShareError(t('app.shareError.fileTooLarge'))
        return
      }
      const draft = buildDraftFromShare(payload)
      if (!draft) return
      setActionScreenshot(null)
      setPendingDraft(draft)
      const isFirstConv = conversations.length === 0
      const id = createConversation(isFirstConv)
      if (!id) return
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
    if (!id) return
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
  // PR D — entrées de navigation directes de la Sidebar. useCallback stables
  // obligatoires : Sidebar est memo, un littéral inline casserait le memo à
  // chaque frame de streaming (audit PR D, R4).
  const handleOpenCosts = useCallback(() => navigate('/costs'), [navigate])
  const handleOpenCompare = useCallback(() => navigate('/compare'), [navigate])
  const handleOpenApiKeys = useCallback(() => setShowApiKeys(true), [])
  const handleSendInChat: ChatSendHandler = useCallback(
    (text, files, options) => sendMessage(text, undefined, files, options),
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

  // PR D — fix bug orphelin : upgrade.tsx dispatche 'arty-open-api-keys'
  // (bouton « Configurer mes clés API ») mais aucun listener n'existait.
  // L'ApiKeysModal est désormais possédée ici (un seul propriétaire — la
  // rendre dans la Sidebar la plaçait dans le containing block du drawer
  // transformé, fixed cassé drawer fermé).
  useEffect(() => {
    const open = () => setShowApiKeys(true)
    window.addEventListener('arty-open-api-keys', open)
    return () => window.removeEventListener('arty-open-api-keys', open)
  }, [])

  useEffect(() => {
    if (!error) return
    if (error.includes('no_active_subscription')) {
      navigate('/upgrade')
    }
    // `premium_cap_reached` ne passe plus par ici : useConversation dispatche
    // `arty-cap-reached` → CapReachedModal propose un choix explicite (P0.7),
    // au lieu de l'ancien redirect muet qui éjectait l'utilisateur du fil.
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
            {t('app.budgetAlert.message', { spent: formatCost(budgetAlert.spent), limit: formatCost(budgetAlert.limit) })}
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                setBudgetAlert(null)
                navigate('/costs')
              }}
              className="font-display italic text-xs underline"
            >
              {t('app.budgetAlert.view')}
            </button>
            <button
              onClick={() => setBudgetAlert(null)}
              className="font-display italic text-xs"
              aria-label={t('app.budgetAlert.closeAria')}
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
        onSetTags={setConversationTags}
        userName={profileName || userName}
        onLogout={onLogout}
        onImportConversation={handleImportConversation}
        onOpenTemplates={handleOpenTemplates}
        onOpenCosts={handleOpenCosts}
        onOpenCompare={handleOpenCompare}
        onOpenApiKeys={handleOpenApiKeys}
      />

      <ApiKeysModal open={showApiKeys} onClose={() => setShowApiKeys(false)} />
      {/* P0.7 — modale de choix au cap premium atteint (event arty-cap-reached). */}
      <CapReachedModal />

      {/* PR E — desktop ≥1024px : la sidebar persistante (fixed, toujours
          visible) occupe lg:w-72 à gauche ; on décale le contenu d'autant.
          Aucune restructuration flex de la racine → mobile inchangé. */}
      <main className="h-full lg:pl-72">
      <Routes>
        <Route
          path="/"
          element={
            <HomeScreen
              onMenuToggle={() => setSidebarOpen((o) => !o)}
              onSend={handleSendFromHome}
              isStreaming={isStreaming}
              onStop={stopStreaming}
              googleAuth={googleAuth}
              drive={drive}
              userName={profileName || userName}
              proactiveBrief={proactiveBrief.brief}
              briefLoading={proactiveBrief.loading}
              onDismissBrief={proactiveBrief.dismiss}
              onBriefAction={proactiveBrief.runAction}
              conversations={conversations}
              onSelectConv={handleSelectConversation}
              error={error}
              onDismissError={clearError}
            />
          }
        />
        <Route
          path="/auth/callback"
          element={<OAuthCallback onCallback={handleOAuthCallback} />}
        />
        {/* P1.5 — un utilisateur connecté peut aussi ouvrir un lien de partage. */}
        <Route path="/share/:id" element={<SharedConversationView />} />
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
              drive={drive}
              computerActions={computerActions}
              actionScreenshot={actionScreenshot}
              onAction={handleAction}
              onBranch={handleBranch}
              onTogglePin={handleTogglePin}
              onEdit={editAndResend}
              onRetry={retryMessage}
              onRetryError={retryLastUserMessage}
              onDismissError={clearError}
              onNewConversation={handleNewConversation}
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
  // P0.10 — textes via i18n (étaient hardcodés FR → bannière cassée en EN).
  const { t } = useTranslation()
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
          {t('trial.banner.ended')}
        </p>
        {/* Play Store — pas de CTA vers la page d'achat sur natif. */}
        {canPurchase && (
          <button
            onClick={onUpgrade}
            className="font-display italic text-xs underline shrink-0"
          >
            {t('trial.banner.seePlans')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      className="sticky top-0 z-[55] bg-theme-accent/15 text-theme-ink px-4 py-1.5 flex items-center justify-between gap-3"
      style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top, 0.375rem))' }}
    >
      <p className="font-display italic text-xs">
        {t('trial.banner.remaining', { count: remaining })}
      </p>
      {canPurchase && (
        <button
          onClick={onUpgrade}
          className="font-display italic text-xs underline shrink-0"
        >
          {t('trial.banner.upgradeCta')}
        </button>
      )}
    </div>
  )
}

interface ChatRouteProps {
  activeConversation: ReturnType<typeof useConversation>['activeConversation']
  isStreaming: boolean
  streamingContent: string
  error: string | null
  onBack: () => void
  onSend: ChatSendHandler
  onStop: () => void
  onSelect: (id: string) => void
  drive: ReturnType<typeof import('./hooks/useDrive').useDrive>
  computerActions: ReturnType<typeof import('./hooks/useComputer').useComputer>
  actionScreenshot: string | null
  onAction?: (action: string, params: Record<string, string>) => void
  onBranch?: (messageIndex: number) => void
  onTogglePin?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRetry?: (messageId: string) => void
  onRetryError?: () => void
  onDismissError?: () => void
  onNewConversation?: () => void
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
  drive,
  computerActions,
  actionScreenshot,
  onAction,
  onBranch,
  onTogglePin,
  onEdit,
  onRetry,
  onRetryError,
  onDismissError,
  onNewConversation,
  conversations,
  onSelectConv,
}: ChatRouteProps) {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const matchesRoute = !id || (!!activeConversation && activeConversation.id === id)
  // Écran vide permanent (juillet 2026) : quand la conversation demandée
  // n'existe pas (storage chiffré pas prêt, id fantôme), l'ancien
  // `return null` restait affiché POUR TOUJOURS — la branche "introuvable"
  // était du code mort car `id` est toujours défini sur /chat/:id. On borne
  // l'attente : au-delà de 4 s sans match, on affiche un état "introuvable"
  // actionnable au lieu d'un écran vide.
  const [lookupTimedOut, setLookupTimedOut] = useState(false)
  useEffect(() => {
    if (matchesRoute) return
    setLookupTimedOut(false)
    const timer = setTimeout(() => setLookupTimedOut(true), 4000)
    return () => clearTimeout(timer)
  }, [id, matchesRoute])

  // CRIT-9 (audit étape 6) — onSelect doit être appelé dans un useEffect,
  // pas directement pendant le render. Sinon React 18 warning "Cannot
  // update a component from inside the function body of a different
  // component" + risque de loop infinie.
  useEffect(() => {
    if (id && (!activeConversation || activeConversation.id !== id)) {
      onSelect(id)
    }
  }, [id, activeConversation, onSelect])

  if (!matchesRoute || !activeConversation) {
    if (!lookupTimedOut) {
      // Transition courte attendue : sélection en cours ou déchiffrement du
      // storage qui se termine. État VISIBLE, jamais un écran vide.
      return (
        <div className="flex items-center justify-center h-full text-theme-muted text-sm">
          {t('common.loading')}
        </div>
      )
    }
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
        <p className="text-theme-ink font-medium">{t('chat.notFound.title')}</p>
        <p className="text-theme-muted text-sm">{t('chat.notFound.body')}</p>
        <button
          onClick={() => navigate('/')}
          className="mt-2 px-4 py-2 rounded-xl border border-theme-border bg-theme-surface text-sm font-medium text-theme-ink hover:border-theme-accent transition-colors"
        >
          {t('chat.notFound.backHome')}
        </button>
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
      drive={drive}
      computerActions={computerActions}
      actionScreenshot={actionScreenshot}
      onAction={onAction}
      onBranch={onBranch}
      onTogglePin={onTogglePin}
      onEdit={onEdit}
      onRetry={onRetry}
      onRetryError={onRetryError}
      onDismissError={onDismissError}
      onNewConversation={onNewConversation}
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
        const handle = await CapApp.addListener('appUrlOpen', () => {
          // M-1 (audit OAuth) : le `code` OAuth d'un deeplink N'EST PLUS échangé
          // ici. Ce chemin était NON-NOMINAL (le login natif passe par le plugin
          // Java GoogleSignInNative, jamais par un redirect /auth/callback) et il
          // échangeait un `code` arbitraire SANS vérifier le state CSRF → un lien
          // forgé `tryarty.com/auth/callback?code=…` pouvait connecter la victime
          // au compte de l'attaquant (login-CSRF). La vérif du state reste
          // centralisée dans OAuthCallback.tsx (chemin web). Le listener est
          // conservé (futur usage deeplink éventuel) mais n'échange aucun code.
          // NB : l'effet `processOAuth` ci-dessous devient inatteignable
          // (deepLinkCode jamais positionné) — nettoyage du dead code en suivi.
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
        const { exchangeCode, fetchGoogleUser, storeMailboxFreeGrant, storeUser } = await import('./services/googleAuth')
        const tokens = await exchangeCode(code, undefined, false)
        const user = await fetchGoogleUser(tokens.access_token)
        // Pose le splash post-login (vip|trial) AVANT de flipper l'auth.
        await initTrial(tokens.access_token)
        const { generateUserId, setActiveSession } = await import('./services/userSession')
        const userId = await generateUserId('google', user.email)
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
        await storeMailboxFreeGrant(tokens)
        await storeUser(user)
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

  const [choiceDone, setChoiceDone] = useState(isOnboardingChoiceDone)
  const [splash, setSplash] = useState(() => getOnboardingSplash())

  if (!auth.isAuthenticated) {
    // Le routeur englobe TOUTE la zone non authentifiée. Avant, la branche
    // !choiceDone rendait OnboardingChoice sans routeur : un primo-visiteur
    // qui ouvrait /share/:id ou /auth/callback tombait sur l'écran de choix
    // au lieu de la page attendue. La décision landing / choix d'onboarding /
    // login vit dans LoggedOutHome.
    return (
      <BrowserRouter>
        <Routes>
          <Route
            path="/auth/callback"
            element={<OAuthCallbackAuth auth={auth} onPostLogin={() => setSplash(getOnboardingSplash())} />}
          />
          {/* P1.5 — partage public lisible SANS compte (canal d'acquisition),
              y compris pour un primo-visiteur qui n'a pas fait l'onboarding. */}
          <Route path="/share/:id" element={<SharedConversationView />} />
          {/* Cible explicite du « Se connecter » de la landing. */}
          <Route
            path="/login"
            element={
              <LoginScreen
                onLogin={auth.login}
                knownSessions={auth.knownSessions}
                onSwitchAccount={auth.switchAccount}
              />
            }
          />
          <Route
            path="*"
            element={
              <LoggedOutHome
                auth={auth}
                choiceDone={choiceDone}
                setChoiceDone={setChoiceDone}
                setSplash={setSplash}
              />
            }
          />
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
      {/* Bannière mode démo preview — pill discrète, non bloquante
          (pointer-events-none), pour ne jamais masquer le design relu.
          Détecté via authMethod (pas d'import du module démo → reste hors
          du bundle de prod). */}
      {auth.currentUser?.authMethod === 'demo' && (
        <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[70] pointer-events-none">
          <span className="px-3 py-1 rounded-full bg-theme-ink/85 text-theme-bg text-[11px] font-sans font-medium shadow-lg">
            🔍 Mode aperçu · données d'exemple
          </span>
        </div>
      )}
      <Toaster />
    </BrowserRouter>
  )
}

/**
 * Zone non authentifiée hors routes profondes (/auth/callback, /share, /login).
 *
 * Ordre de décision :
 *  1. Primo-visiteur web (onboarding jamais fait, aucune session connue,
 *     pas Capacitor natif) → landing marketing (item 16 roadmap v2).
 *     « Essayer gratuitement » révèle l'écran de choix SANS marquer
 *     l'onboarding comme fait : un refresh ré-affiche la landing, pas le
 *     login. Les trois gardes sont des lectures synchrones (localStorage) —
 *     aucun flash de landing pour un utilisateur connu.
 *  2. Onboarding pas encore fait → OnboardingChoice (P2.2 — l'écran de choix
 *     porte la preuve de valeur + le CTA d'essai).
 *  3. Sinon → LoginScreen.
 *
 * Preview Cloudflare : le mode démo (__DEMO_ALLOWED__) pose une session
 * avant le render → la landing est contournée ; utiliser `?login` pour la
 * revoir (previewDemo.ts).
 */
function LoggedOutHome({
  auth,
  choiceDone,
  setChoiceDone,
  setSplash,
}: {
  auth: ReturnType<typeof useAuth>
  choiceDone: boolean
  setChoiceDone: (done: boolean) => void
  setSplash: (splash: ReturnType<typeof getOnboardingSplash>) => void
}) {
  const navigate = useNavigate()
  const [entered, setEntered] = useState(false)

  if (!choiceDone) {
    const showLanding =
      !entered && !Capacitor.isNativePlatform() && auth.knownSessions.length === 0
    if (showLanding) {
      return (
        // Fallback vide aux couleurs du thème : pas de texte « Chargement… »
        // en première impression marketing (le chunk arrive en <200ms).
        <Suspense fallback={<div className="min-h-screen bg-theme-bg" />}>
          <LandingScreen onStart={() => setEntered(true)} onLogin={() => navigate('/login')} />
        </Suspense>
      )
    }
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
          // After auth flips, scopedStorage is keyed to the user — store
          // the Google credentials through storeTokens/storeUser so they
          // take the encrypted-at-rest path (D22/P0-a-bis — the previous
          // raw setJSON bypassed it). First native login: the refresh
          // token is freshly minted (requestServerAuthCode forces it,
          // BUG 51), so no merge-with-existing is needed here.
          const { storeMailboxFreeGrant, storeUser } = await import('./services/googleAuth')
          await storeUser({ email, name, picture: avatar })
          await storeMailboxFreeGrant({
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
        onEmailTrialLogin={async (email, token) => {
          // Crée la session AVANT de stocker le jeton (scopedStorage a besoin
          // du préfixe userId actif). Pas de clé BYOK → 'server-provided'
          // (même posture que Google sans BYOK, BUG 25). Identifiant namespacé
          // `emailtrial:` pour ne JAMAIS collisionner avec le compte local
          // email+password ni le compte Google du même email.
          await auth.login('email', {
            displayName: email,
            email,
            anthropicKey: 'server-provided',
            identifier: `emailtrial:${email}`,
          })
          setTrialToken(token)
          initEmailTrialSplash(30)
          markOnboardingChoiceDone()
          setChoiceDone(true)
          setSplash(getOnboardingSplash())
        }}
      />
    )
  }

  return (
    <LoginScreen
      onLogin={auth.login}
      knownSessions={auth.knownSessions}
      onSwitchAccount={auth.switchAccount}
    />
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
      const { exchangeCode, fetchGoogleUser, storeMailboxFreeGrant, storeUser } = await import('./services/googleAuth')
      const tokens = await exchangeCode(code, undefined, false)
      const user = await fetchGoogleUser(tokens.access_token)

      // Initialise (ou récupère) le statut trial AVANT de finaliser l'auth :
      // ça pose le splash post-login en localStorage avant que le state
      // React ne flippe et ne remonte le composant racine.
      await initTrial(tokens.access_token)

      // Check if this Google user already has API keys saved
      const { generateUserId, setActiveSession } = await import('./services/userSession')
      const userId = await generateUserId('google', user.email)
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
      await storeMailboxFreeGrant(tokens)
      await storeUser(user)
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
