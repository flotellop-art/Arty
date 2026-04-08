import type { Conversation } from '../../types'
import { ChatTopBar } from './ChatTopBar'
import { MessageList } from './MessageList'
import { InputBar } from '../layout/InputBar'

interface ConversationScreenProps {
  conversation: Conversation
  isStreaming: boolean
  streamingContent: string
  error: string | null
  onBack: () => void
  onSend: (text: string) => void
  onStop: () => void
}

export function ConversationScreen({
  conversation,
  isStreaming,
  streamingContent,
  error,
  onBack,
  onSend,
  onStop,
}: ConversationScreenProps) {
  return (
    <div className="flex flex-col h-full">
      <ChatTopBar title={conversation.title} onBack={onBack} />

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
