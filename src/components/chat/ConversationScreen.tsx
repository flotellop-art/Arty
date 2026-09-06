import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatSendHandler, Conversation, Message } from '../../types'
import { ChatTopBar } from './ChatTopBar'
import { MessageList } from './MessageList'
import { InputBar } from '../layout/InputBar'
import { ActionBanner } from '../google/ActionBanner'
import { BrowserBanner } from '../google/BrowserBanner'
import { ConversationSummaryModal } from './ConversationSummaryModal'
import { ReportModal } from './ReportModal'
import { ContextCompressedBanner } from './ContextCompressedBanner'
import { ContextMeter } from './ContextMeter'
import { ErrorBoundary } from '../shared/ErrorBoundary'
import { consumePendingDraft } from '../../services/shareTargetService'
import { isDocumentConversation, hasProjectHistory } from '../../services/projects/chatPolicy'
import { hasOfficeHistory } from '../../services/documents/prepareOfficeMessages'
import { ProjectConversationPanel } from './ProjectConversationPanel'
import { OfficeExportModal } from './OfficeExportModal'
import { ConversationArchiveModal } from '../workspace/ConversationArchiveModal'
import { useCalendarDocumentCopy } from './useCalendarDocumentCopy'
import { CalendarDocumentCopyDialog } from './CalendarDocumentCopyDialog'
import type { Project } from '../../services/projects/types'
import type { useDrive } from '../../hooks/useDrive'
import type { useComputer } from '../../hooks/useComputer'

interface ConversationScreenProps {
  onCompare?: (conversationId: string, messageId: string) => void
  onOpenComparison?: (branchId: string) => void
  isConversationBusy?: (id: string) => boolean
  onProjectChange?: (project: Project | null) => Promise<boolean>
  conversation: Conversation
  isStreaming: boolean
  streamingContent: string
  streamingImages?: readonly string[]
  error: string | null
  errorRetryable?: boolean
  onBack: () => void
  onSend: ChatSendHandler
  onStop: () => void
  onAction?: (action: string, params: Record<string, string>) => void
  onBranch?: (messageIndex: number) => void
  onTogglePin?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRetry?: (messageId: string) => void
  // Bandeau d'erreur API (audit UX) : rejouer le dernier message user sans
  // le retaper, et fermer le bandeau qui ne disparaissait jamais.
  onRetryError?: () => void
  onDismissError?: () => void
  onNewConversation?: () => void
  drive: ReturnType<typeof useDrive>
  computerActions: ReturnType<typeof useComputer>
  actionScreenshot: string | null
  conversations?: Conversation[]
  onSelectConv?: (id: string) => void
}

export function ConversationScreen({
  onCompare, onOpenComparison,
  conversation,
  isConversationBusy,
  isStreaming,
  streamingContent,
  streamingImages,
  error,
  errorRetryable = true,
  onBack,
  onSend,
  onStop,
  onAction,
  onBranch,
  onTogglePin,
  onEdit,
  onRetry,
  onRetryError,
  onDismissError,
  onNewConversation,
  drive,
  computerActions,
  actionScreenshot,
  conversations,
  onSelectConv,
  onProjectChange,
}: ConversationScreenProps) {
  const { t } = useTranslation()
  const calendarCopy = useCalendarDocumentCopy(conversation.id, id => isStreaming || !isConversationBusy || isConversationBusy(id))
  const [showSummary, setShowSummary] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null)
  const [exportTarget, setExportTarget] = useState<{ conversationId: string; messageId?: string } | null>(null)
  useEffect(() => { setExportTarget(null) }, [conversation.id])
  // Message assistant ciblé par un signalement (policy Play Store
  // AI-Generated Content) — ouvre la ReportModal.
  const [reportTarget, setReportTarget] = useState<Message | null>(null)
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
        onExportOffice={() => setExportTarget({ conversationId: conversation.id })}
        onArchive={isConversationBusy ? () => setArchiveTarget(conversation.id) : undefined}
        conversations={conversations}
        onSelectConversation={onSelectConv}
      />

      <ActionBanner icon="📁" message={t('chat.banners.driveAccess')} isVisible={drive.isLoading} />
      {onProjectChange && <ProjectConversationPanel key={conversation.id} conversation={conversation} busy={isStreaming} onChange={onProjectChange} />}
      <BrowserBanner action={computerActions.currentAction} />

      <ErrorBoundary>
        {conversation.comparison && onOpenComparison && <button className="min-h-11 border border-theme-border mx-4 px-3" onClick={() => onOpenComparison(conversation.id)}>{t('compare.context.reopen')}</button>}
        <MessageList
          onCompare={onCompare ? messageId => onCompare(conversation.id, messageId) : undefined}
          messages={conversation.messages}
          isStreaming={isStreaming}
          streamingContent={streamingContent}
          streamingImages={streamingImages}
          conversationId={conversation.id}
          onAction={isDocumentConversation(conversation) ? undefined : onAction}
          onCalendarCopy={isDocumentConversation(conversation) && isConversationBusy ? calendarCopy.open : undefined}
          onBranch={onBranch}
          onTogglePin={onTogglePin}
          onEdit={onEdit}
          onRetry={onRetry}
          onExport={(messageId) => setExportTarget({ conversationId: conversation.id, messageId })}
          onReport={(messageId) => {
            const msg = conversation.messages.find((m) => m.id === messageId)
            if (msg) setReportTarget(msg)
          }}
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

      {(error || computerActions.error) && (
        <div
          role="alert"
          className="mx-4 mb-2 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-700 dark:text-red-400 flex items-center gap-2"
        >
          <span className="flex-1 min-w-0 break-words">
            {error || computerActions.error}
          </span>
          {error && onRetryError && !isStreaming && errorRetryable && (
            <button
              onClick={onRetryError}
              className="flex-shrink-0 px-2.5 py-1 rounded-md border border-red-500/40 font-medium hover:bg-red-500/10 transition-colors"
            >
              {t('common.retry')}
            </button>
          )}
          {error && onDismissError && (
            <button
              onClick={onDismissError}
              className="flex-shrink-0 p-1.5 rounded-md hover:bg-red-500/10 transition-colors"
              aria-label={t('common.close')}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      )}

      {!isDocumentConversation(conversation) && <ContextMeter messages={conversation.messages} onNewConversation={onNewConversation} />}

      {!isDocumentConversation(conversation) && <ContextCompressedBanner onNewConversation={onNewConversation} />}

      <InputBar
        onSend={onSend}
        isStreaming={isStreaming}
        onStop={onStop}
        initialText={initialDraft?.text}
        initialFiles={initialDraft?.files}
        euOnly={conversation.euOnly}
        hasPrivateHistory={!!conversation.hasGoogleData}
        hasOfficeHistory={hasOfficeHistory(conversation.messages)}
        hasProjectContext={hasProjectHistory(conversation)}
        draftKey={`conversation:${conversation.id}`}
      />

      {showSummary && (
        <ConversationSummaryModal
          conversation={conversation}
          onClose={() => setShowSummary(false)}
        />
      )}

      {exportTarget?.conversationId === conversation.id && <OfficeExportModal conversation={conversation} messageId={exportTarget.messageId} onClose={() => setExportTarget(null)} />}
      {calendarCopy.opening && <CalendarDocumentCopyDialog key={calendarCopy.opening.key} opening={calendarCopy.opening} onClose={calendarCopy.close} />}
      {archiveTarget === conversation.id && isConversationBusy && <ConversationArchiveModal key={conversation.id} conversation={conversation} isBusy={isConversationBusy} onClose={() => setArchiveTarget(null)} />}
      <ReportModal
        conversation={conversation}
        message={reportTarget}
        onClose={() => setReportTarget(null)}
      />
    </div>
  )
}
