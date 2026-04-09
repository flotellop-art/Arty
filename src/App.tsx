import { useState, useCallback, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { useConversation } from './hooks/useConversation'
import { useGoogleAuth } from './hooks/useGoogleAuth'
import { useGmail } from './hooks/useGmail'
import { useDrive } from './hooks/useDrive'
import { useBrowser } from './hooks/useBrowser'
import { useComputer } from './hooks/useComputer'
import { buildContextualPrompt } from './constants/systemPrompt'
import { useMemory } from './hooks/useMemory'
import { createToolExecutor } from './services/toolExecutor'
import { HomeScreen } from './components/home/HomeScreen'
import { ConversationScreen } from './components/chat/ConversationScreen'
import { ReportPage } from './components/shared/ReportPage'
import { Sidebar } from './components/layout/Sidebar'
import { OAuthCallback } from './components/google/OAuthCallback'
import type { GmailMessage } from './types/google'

function AppContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [actionScreenshot, setActionScreenshot] = useState<string | null>(null)
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
    stopStreaming,
    setSystemPrompt,
    setToolHandler,
  } = conversation

  const googleAuth = useGoogleAuth()
  const gmail = useGmail()
  const drive = useDrive()
  const browserActions = useBrowser()
  const computerActions = useComputer()
  const memoryHook = useMemory()

  // Create tool executor and register it
  const toolExecutorRef = useRef(createToolExecutor(computerActions, gmail, drive, browserActions))

  useEffect(() => {
    toolExecutorRef.current = createToolExecutor(computerActions, gmail, drive, browserActions)
    setToolHandler((name: string, input: Record<string, unknown>) => {
      return toolExecutorRef.current(name, input).then((res) => {
        if (res.screenshot) {
          setActionScreenshot(res.screenshot)
        }
        return res
      })
    })
  }, [computerActions, gmail, drive, browserActions, setToolHandler])

  // Auto-fetch Gmail, Drive, and Memory when Google is connected
  useEffect(() => {
    if (googleAuth.isConnected) {
      gmail.fetchMessages()
      drive.fetchFiles()
      memoryHook.loadMemory()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleAuth.isConnected])

  // Update system prompt with Google context
  useEffect(() => {
    if (!googleAuth.isConnected) {
      setSystemPrompt(undefined)
      return
    }

    let gmailSummary: string | undefined
    if (gmail.messages.length > 0) {
      gmailSummary = `${gmail.messages.length} emails non lus :\n` +
        gmail.messages
          .slice(0, 5)
          .map((m: GmailMessage) => `- De: ${m.from} | Objet: ${m.subject}`)
          .join('\n')
    }

    let driveSummary: string | undefined
    if (drive.files.length > 0) {
      driveSummary = `Fichiers récents sur Drive :\n` +
        drive.files
          .slice(0, 5)
          .map((f) => `- ${f.name} (${f.mimeType})`)
          .join('\n')
    }

    const memorySummary = memoryHook.getPromptContext()
    const prompt = buildContextualPrompt({ gmailSummary, driveSummary, memorySummary })
    setSystemPrompt(prompt)
  }, [googleAuth.isConnected, gmail.messages, drive.files, memoryHook.getPromptContext, setSystemPrompt])

  // Handle action buttons clicked in reports
  const handleAction = useCallback(
    async (action: string, params: Record<string, string>) => {
      const executor = toolExecutorRef.current
      switch (action) {
        case 'send_email':
          await executor('send_email', params)
          break
        case 'save_drive':
          await executor('create_drive_file', { name: params.name || 'Document', content: params.content || '' })
          break
        case 'create_event':
          await executor('create_calendar_event', params)
          break
        case 'publish_wp':
          await executor('wp_create_post', { title: params.title || '', content: params.content || '', status: params.status || 'draft' })
          break
        case 'search_web':
          await executor('web_search', { query: params.query || '' })
          break
        case 'call': {
          // Open phone dialer
          window.open(`tel:${params.phone}`, '_self')
          break
        }
        case 'link': {
          window.open(params.url, '_blank')
          break
        }
        default:
          await executor(action, params)
      }
    },
    []
  )

  const handleSendFromHome = useCallback(
    (text: string) => {
      setActionScreenshot(null)
      const id = createConversation()
      sendMessage(text, id)
      navigate(`/chat/${id}`)
    },
    [createConversation, sendMessage, navigate]
  )

  const handleNewConversation = useCallback(() => {
    const id = createConversation()
    navigate(`/chat/${id}`)
  }, [createConversation, navigate])

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActionScreenshot(null)
      selectConversation(id)
      navigate(`/chat/${id}`)
    },
    [selectConversation, navigate]
  )

  const handleBack = useCallback(() => {
    setActionScreenshot(null)
    clearActive()
    navigate('/')
  }, [clearActive, navigate])

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
              onSend={sendMessage}
              onStop={stopStreaming}
              onSelect={selectConversation}
              gmail={gmail}
              drive={drive}
              browserActions={browserActions}
              computerActions={computerActions}
              actionScreenshot={actionScreenshot}
              onAction={handleAction}
            />
          }
        />
      </Routes>
    </div>
  )
}

interface ChatRouteProps {
  activeConversation: ReturnType<typeof useConversation>['activeConversation']
  isStreaming: boolean
  streamingContent: string
  error: string | null
  onBack: () => void
  onSend: (text: string) => void
  onStop: () => void
  onSelect: (id: string) => void
  gmail: ReturnType<typeof useGmail>
  drive: ReturnType<typeof useDrive>
  browserActions: ReturnType<typeof useBrowser>
  computerActions: ReturnType<typeof useComputer>
  actionScreenshot: string | null
  onAction?: (action: string, params: Record<string, string>) => void
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
    />
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}
