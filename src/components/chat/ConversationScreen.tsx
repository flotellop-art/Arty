import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation, FileAttachment } from '../../types'
import { ChatTopBar } from './ChatTopBar'
import { MessageList } from './MessageList'
import { InputBar } from '../layout/InputBar'
import { ActionBanner } from '../google/ActionBanner'
import { BrowserBanner } from '../google/BrowserBanner'
import { ConversationSummaryModal } from './ConversationSummaryModal'
import { ErrorBoundary } from '../shared/ErrorBoundary'
import { consumePendingDraft } from '../../services/shareTargetService'
import type { useGmail } from '../../hooks/useGmail'
import type { useDrive } from '../../hooks/useDrive'
import type { useBrowser } from '../../hooks/useBrowser'
import type { useComputer } from '../../hooks/useComputer'

interface ConversationScreenProps {
  conversation: Conversation
  isStreaming: boolean
  streamingContent: string
  error: string | null
  onBack: () => void
  onSend: (text: string, files?: FileAttachment[]) => void
  onStop: () => void
  onAction?: (action: string, params: Record<string, string>) => void
  onBranch?: (messageIndex: number) => void
  onTogglePin?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRetry?: (messageId: string) => void
  gmail: ReturnType<typeof useGmail>
  drive: ReturnType<typeof useDrive>
  browserActions: ReturnType<typeof useBrowser>
  computerActions: ReturnType<typeof useComputer>
  actionScreenshot: string | null
  conversations?: Conversation[]
  onSelectConv?: (id: string) => void
}

export function ConversationScreen({
  conversation,
  isStreaming,
  streamingContent,
  error,
  onBack,
  onSend,
  onStop,
  onAction,
  onBranch,
  onTogglePin,
  onEdit,
  onRetry,
  gmail,
  drive,
  browserActions,
  computerActions,
  actionScreenshot,
}: ConversationScreenProps) {
  const { t } = useTranslation()
  const [showSummary, setShowSummary] = useState(false)
  // Drain any pending share-to-Arty draft once on mount. Single-shot — a
  // remount or revisit must not replay the previous share.
  const [initialDraft] = useState(() => consumePendingDraft())
  return (
    <div className="flex flex-col h-full">
      <ChatTopBar
        title={conversation.title}
        onBack={onBack}
        usedModels={conversation.usedModels}
        euOnly={conversation.euOnly}
        conversation={conversation}
        onOpenSummary={() => setShowSummary(true)}
      />

      <ActionBanner icon="📧" message={t('chat.banners.gmailReading')} isVisible={gmail.isLoading} />
      <ActionBanner icon="📁" message={t('chat.banners.driveAccess')} isVisible={drive.isLoading} />
      <BrowserBanner action={browserActions.currentAction} />
      <BrowserBanner action={computerActions.currentAction} />

      <ErrorBoundary>
        <MessageList
          messages={conversation.messages}
          isStreaming={isStreaming}
          streamingContent={streamingContent}
          onAction={onAction}
          onBranch={onBranch}
          onTogglePin={onTogglePin}
          onEdit={onEdit}
          onRetry={onRetry}
        />
      </ErrorBoundary>

      {actionScreenshot && (
        <div className="mx-4 mb-2">
          <div className="bg-theme-surface rounded-xl border border-theme-border shadow-sm overflow-hidden">
            <div className="bg-theme-ink/[0.03] px-3 py-1.5 border-b border-theme-border text-xs text-theme-muted">
              {t('chat.banners.screenshot')}
            </div>
            <img
              src={actionScreenshot}
              alt={t('chat.banners.screenshotAlt')}
              className="w-full"
            />
          </div>
        </div>
      )}

      {(error || browserActions.error || computerActions.error) && (
        <div className="mx-4 mb-2 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-700 dark:text-red-400">
          {error || browserActions.error || computerActions.error}
        </div>
      )}

      <InputBar
        onSend={onSend}
        isStreaming={isStreaming}
        onStop={onStop}
        initialText={initialDraft?.text}
        initialFiles={initialDraft?.files}
        euOnly={conversation.euOnly}
      />

      {showSummary && (
        <ConversationSummaryModal
          conversation={conversation}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  )
}
