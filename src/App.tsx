import { useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { useConversation } from './hooks/useConversation'
import { HomeScreen } from './components/home/HomeScreen'
import { ConversationScreen } from './components/chat/ConversationScreen'
import { Sidebar } from './components/layout/Sidebar'

function AppContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const navigate = useNavigate()

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
  } = useConversation()

  const handleSendFromHome = useCallback(
    (text: string) => {
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
      selectConversation(id)
      navigate(`/chat/${id}`)
    },
    [selectConversation, navigate]
  )

  const handleBack = useCallback(() => {
    clearActive()
    navigate('/')
  }, [clearActive, navigate])

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
            />
          }
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
}: ChatRouteProps) {
  const { id } = useParams<{ id: string }>()

  // Sync route param with conversation state
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
