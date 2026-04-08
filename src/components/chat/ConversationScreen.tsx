import type { Conversation } from '../../types'
import { ChatTopBar } from './ChatTopBar'
import { MessageList } from './MessageList'
import { InputBar } from '../layout/InputBar'
import { ActionBanner } from '../google/ActionBanner'
import type { useGmail } from '../../hooks/useGmail'
import type { useDrive } from '../../hooks/useDrive'

interface ConversationScreenProps {
  conversation: Conversation
  isStreaming: boolean
  streamingContent: string
  error: string | null
  onBack: () => void
  onSend: (text: string) => void
  onStop: () => void
  gmail: ReturnType<typeof useGmail>
  drive: ReturnType<typeof useDrive>
}

export function ConversationScreen({
  conversation,
  isStreaming,
  streamingContent,
  error,
  onBack,
  onSend,
  onStop,
  gmail,
  drive,
}: ConversationScreenProps) {
  return (
    <div className="flex flex-col h-full">
      <ChatTopBar title={conversation.title} onBack={onBack} />

      <ActionBanner
        icon="📧"
        message="Lecture emails..."
        isVisible={gmail.isLoading}
      />
      <ActionBanner
        icon="📁"
        message="Accès Drive..."
        isVisible={drive.isLoading}
      />

      <MessageList
        messages={conversation.messages}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
      />

      {error && (
        <div className="mx-4 mb-2 px-4 py-2 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {error}
        </div>
      )}

      <InputBar onSend={onSend} isStreaming={isStreaming} onStop={onStop} />
    </div>
  )
}
