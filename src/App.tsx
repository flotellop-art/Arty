import { useState, useCallback, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { useConversation } from './hooks/useConversation'
import { useAppSetup } from './hooks/useAppSetup'
import { useAuth } from './hooks/useAuth'
import { initCrypto, isCryptoReady } from './services/crypto'
import { bootstrapGoogleStorage } from './services/googleAuth'
import { getJSON } from './services/scopedStorage'
import { QuestionModal } from './components/chat/QuestionModal'
import { MorningBrief } from './components/home/MorningBrief'
import { HomeScreen } from './components/home/HomeScreen'
import { shouldShowMorningBrief } from './services/morningBriefService'
import { ConversationScreen } from './components/chat/ConversationScreen'
import { ReportPage } from './components/shared/ReportPage'
import { Sidebar } from './components/layout/Sidebar'
import { OAuthCallback } from './components/google/OAuthCallback'
import { LoginScreen } from './components/auth/LoginScreen'
import { WelcomeSlides, isOnboardingDone } from './components/onboarding/WelcomeSlides'
import {
  OnboardingChoice,
  isOnboardingChoiceDone,
  markOnboardingChoiceDone,
} from './components/onboarding/OnboardingChoice'
import { ProfileSetupModal } from './components/onboarding/ProfileSetupModal'
import { getUserProfile } from './services/userProfile'
import { UpgradeScreen, type CurrentPlan } from './screens/upgrade'
import { CostsScreen } from './screens/costs'
import { checkBudgetAlert, formatCost } from './services/costTracker'
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
  } = conversation

  // Show morning brief once per day between 6h-11h
  useEffect(() => {
    const timer = setTimeout(() => {
      if (shouldShowMorningBrief()) setShowMorningBrief(true)
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

  const handleNewConversation = useCallback(() => {
    const isFirstConv = conversations.length === 0
    const id = createConversation(isFirstConv)
    navigate(`/chat/${id}`)
  }, [createConversation, navigate, conversations.length])

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
  useEffect(() => {
    const open = () => navigate('/upgrade')
    window.addEventListener('arty-open-upgrade', open)
    return () => window.removeEventListener('arty-open-upgrade', open)
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
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onNewEU={handleNewEUConversation}
        onDelete={deleteConversation}
        userName={profileName || userName}
        onLogout={onLogout}
        onImportConversation={(id) => {
          conversation.selectConversation(id)
          navigate(`/chat/${id}`)
        }}
      />

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
            <UpgradeScreen
              onBack={() => navigate('/')}
              currentPlan={currentPlan}
              email={userEmail}
            />
          }
        />
        <Route
          path="/costs"
          element={<CostsScreen onBack={() => navigate('/')} />}
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
              onSend={(text, files) => sendMessage(text, undefined, files)}
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
              conversations={conversations}
              onSelectConv={handleSelectConversation}
            />
          }
        />
      </Routes>

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
  conversations,
  onSelectConv,
}: ChatRouteProps) {
  const { id } = useParams<{ id: string }>()

  if (id && (!activeConversation || activeConversation.id !== id)) {
    onSelect(id)
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
      conversations={conversations}
      onSelectConv={onSelectConv}
    />
  )
}

export default function App() {
  const auth = useAuth()
  const [deepLinkCode, setDeepLinkCode] = useState<string | null>(null)

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
      .then(() => bootstrapGoogleStorage())
      .catch(() => {
        // Non-fatal: useAuth will retry initCrypto once auth resolves.
      })
  }, [])

  // Listen for deep links (native OAuth callback)
  useEffect(() => {
    async function setupDeepLinks() {
      try {
        const { App: CapApp } = await import('@capacitor/app')
        CapApp.addListener('appUrlOpen', (event) => {
          const url = new URL(event.url)
          if (url.pathname === '/auth/callback') {
            const code = url.searchParams.get('code')
            if (code) setDeepLinkCode(code)
          }
        })
      } catch {}
    }
    setupDeepLinks()
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

    async function processOAuth(code: string) {
      try {
        const { exchangeCode, fetchGoogleUser } = await import('./services/googleAuth')
        const tokens = await exchangeCode(code)
        const user = await fetchGoogleUser(tokens.access_token)
        const { generateUserId, setActiveSession } = await import('./services/userSession')
        const userId = await generateUserId('google', user.email)
        setActiveSession({ userId, authMethod: 'google', displayName: user.name, email: user.email, avatar: user.picture, createdAt: Date.now() })
        const { getJSON } = await import('./services/scopedStorage')
        const existingKeys = getJSON<{ anthropic: string; gemini?: string; mistral?: string; openai?: string }>('api-keys')

        // Login with existing keys or server-provided
        await auth.login('google', {
          displayName: user.name, email: user.email, avatar: user.picture,
          anthropicKey: existingKeys?.anthropic || 'server-provided',
          geminiKey: existingKeys?.gemini,
          mistralKey: existingKeys?.mistral,
          openaiKey: existingKeys?.openai,
          identifier: user.email,
        })
      } catch (err) {
        console.error('Deep link OAuth error:', err)
      }
      setDeepLinkCode(null)
    }

    processOAuth(deepLinkCode)
  }, [deepLinkCode, auth])

  const [onboardingDone, setOnboardingDone] = useState(isOnboardingDone)
  const [choiceDone, setChoiceDone] = useState(isOnboardingChoiceDone)

  if (!auth.isAuthenticated) {
    // Show welcome slides before login (first time only)
    if (!onboardingDone) {
      return <WelcomeSlides onComplete={() => setOnboardingDone(true)} />
    }

    // Then ask BYOK vs Subscription, also first time only.
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
          onSubscriptionStarted={() => setChoiceDone(true)}
        />
      )
    }

    return (
      <BrowserRouter>
        <Routes>
          <Route path="/auth/callback" element={<OAuthCallbackAuth auth={auth} />} />
          <Route path="*" element={
            <LoginScreen
              onLogin={auth.login}
              knownSessions={auth.knownSessions}
              onSwitchAccount={auth.switchAccount}
            />
          } />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <AppContent
        onLogout={auth.logout}
        userName={auth.currentUser?.displayName}
        authMethod={auth.currentUser?.authMethod}
        userEmail={auth.currentUser?.email}
      />
    </BrowserRouter>
  )
}

/** Handle OAuth callback when not yet authenticated */
function OAuthCallbackAuth({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const navigate = useNavigate()

  const handleCallback = useCallback(async (code: string) => {
    try {
      const { exchangeCode, fetchGoogleUser } = await import('./services/googleAuth')
      const tokens = await exchangeCode(code)
      const user = await fetchGoogleUser(tokens.access_token)

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
      navigate('/')
    } catch (err) {
      console.error('OAuth callback error:', err)
      navigate('/')
    }
  }, [auth, navigate])

  return <OAuthCallback onCallback={handleCallback} />
}
