import { useState, useCallback, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { useConversation } from './hooks/useConversation'
import { useAppSetup } from './hooks/useAppSetup'
import { useAuth } from './hooks/useAuth'
import { QuestionModal } from './components/chat/QuestionModal'
import { HomeScreen } from './components/home/HomeScreen'
import { ConversationScreen } from './components/chat/ConversationScreen'
import { ReportPage } from './components/shared/ReportPage'
import { Sidebar } from './components/layout/Sidebar'
import { OAuthCallback } from './components/google/OAuthCallback'
import { LoginScreen } from './components/auth/LoginScreen'
import { WelcomeSlides, isOnboardingDone } from './components/onboarding/WelcomeSlides'
import type { FileAttachment } from './types'

function AppContent({ onLogout, userName }: { onLogout: () => void; userName?: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const navigate = useNavigate()

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
  } = conversation

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
    // Show welcome message on first-ever conversation
    const isFirstConv = conversations.length === 0
    const id = createConversation(isFirstConv)
    navigate(`/chat/${id}`)
  }, [createConversation, navigate, conversations.length])

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

  const handleOAuthCallback = useCallback(
    async (code: string) => {
      await googleAuth.handleCallback(code)
    },
    [googleAuth]
  )

  return (
    <div className="h-[100dvh] bg-cream font-sans font-light">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={deleteConversation}
        userName={userName}
        onLogout={onLogout}
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
            />
          }
        />
        <Route
          path="/auth/callback"
          element={<OAuthCallback onCallback={handleOAuthCallback} />}
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
}: ChatRouteProps) {
  const { id } = useParams<{ id: string }>()

  if (id && (!activeConversation || activeConversation.id !== id)) {
    onSelect(id)
    return null
  }

  if (!activeConversation) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
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
    />
  )
}

export default function App() {
  const auth = useAuth()
  const [deepLinkCode, setDeepLinkCode] = useState<string | null>(null)

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
        const existingKeys = getJSON<{ anthropic: string; gemini?: string; mistral?: string }>('api-keys')

        if (existingKeys?.anthropic) {
          await auth.login('google', {
            displayName: user.name, email: user.email, avatar: user.picture,
            anthropicKey: existingKeys.anthropic, geminiKey: existingKeys.gemini, mistralKey: existingKeys.mistral,
            identifier: user.email,
          })
        }
        // If no API keys yet, the LoginScreen will handle it
      } catch (err) {
        console.error('Deep link OAuth error:', err)
      }
      setDeepLinkCode(null)
    }

    processOAuth(deepLinkCode)
  }, [deepLinkCode, auth])

  const [onboardingDone, setOnboardingDone] = useState(isOnboardingDone)

  if (!auth.isAuthenticated) {
    // Show welcome slides before login (first time only)
    if (!onboardingDone) {
      return <WelcomeSlides onComplete={() => setOnboardingDone(true)} />
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
      <AppContent onLogout={auth.logout} userName={auth.currentUser?.displayName} />
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
      const existingKeys = getJSON<{ anthropic: string; gemini?: string; mistral?: string }>('api-keys')

      // Use stored keys, or fall back to environment variables
      const anthropicKey = existingKeys?.anthropic || import.meta.env.VITE_ANTHROPIC_API_KEY || ''
      const geminiKey = existingKeys?.gemini || import.meta.env.VITE_GEMINI_API_KEY || ''
      const mistralKey = existingKeys?.mistral || import.meta.env.VITE_MISTRAL_API_KEY || ''

      if (anthropicKey) {
        await auth.login('google', {
          displayName: user.name,
          email: user.email,
          avatar: user.picture,
          anthropicKey,
          geminiKey: geminiKey || undefined,
          mistralKey: mistralKey || undefined,
          identifier: user.email,
        })
        navigate('/')
      } else {
        // No API key at all — save pending auth so LoginScreen can pick it up
        sessionStorage.setItem('arty-pending-auth', JSON.stringify({
          method: 'google',
          displayName: user.name,
          email: user.email,
          avatar: user.picture,
        }))
        navigate('/')
      }
    } catch (err) {
      console.error('OAuth callback error:', err)
      navigate('/')
    }
  }, [auth, navigate])

  return <OAuthCallback onCallback={handleCallback} />
}
