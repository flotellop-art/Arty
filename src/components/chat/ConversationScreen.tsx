import type { Conversation } from '../../types'
import { ChatTopBar } from './ChatTopBar'
import { MessageList } from './MessageList'
import { InputBar } from '../layout/InputBar'
import { ActionBanner } from '../google/ActionBanner'
import { BrowserBanner } from '../google/BrowserBanner'
import type { useGmail } from '../../hooks/useGmail'
import type { useDrive } from '../../hooks/useDrive'
import type { useBrowser } from '../../hooks/useBrowser'

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
  browserActions: ReturnType<typeof useBrowser>
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
  browserActions,
}: ConversationScreenProps) {
  return (
    <div className="flex flex-col h-full">
      <ChatTopBar title={conversation.title} onBack={onBack} />

      <ActionBanner icon="📧" message="Lecture emails..." isVisible={gmail.isLoading} />
      <ActionBanner icon="📁" message="Accès Drive..." isVisible={drive.isLoading} />
      <BrowserBanner action={browserActions.currentAction} />

      <MessageList
        messages={conversation.messages}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
      />

      {(error || browserActions.error) && (
        <div className="mx-4 mb-2 px-4 py-2 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {error || browserActions.error}
        </div>
      )}

      <InputBar onSend={onSend} isStreaming={isStreaming} onStop={onStop} />
    </div>
  )
}
