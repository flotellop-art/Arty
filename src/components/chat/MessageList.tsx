import { memo, useRef, useEffect, useCallback, useState } from 'react'
import type { Message } from '../../types'
import { UserBubble } from './UserBubble'
import { AssistantBubble } from './AssistantBubble'
import { TypingIndicator } from './TypingIndicator'
import { StreamingIndicator } from './StreamingIndicator'

interface MessageItemProps {
  msg: Message
  index: number
  onAction?: (action: string, params: Record<string, string>) => void
  onBranch?: (messageIndex: number) => void
  onTogglePin?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRetry?: (messageId: string) => void
  isLastUserMessage?: boolean
}

const MessageItem = memo(function MessageItem({ msg, index, onAction, onBranch, onTogglePin, onEdit, onRetry, isLastUserMessage }: MessageItemProps) {
  const handleBranch = useCallback(() => onBranch?.(index), [onBranch, index])
  const handleTogglePin = useCallback(() => onTogglePin?.(msg.id), [onTogglePin, msg.id])
  const handleEdit = useCallback((newContent: string) => onEdit?.(msg.id, newContent), [onEdit, msg.id])
  const handleRetry = useCallback(() => onRetry?.(msg.id), [onRetry, msg.id])

  return (
    <div className="group relative">
      {msg.role === 'user' ? (
        <UserBubble
          content={msg.content}
          files={msg.files}
          pinned={msg.pinned}
          onTogglePin={onTogglePin ? handleTogglePin : undefined}
          onEdit={onEdit && isLastUserMessage ? handleEdit : undefined}
        />
      ) : (
        <AssistantBubble
          content={msg.content}
          onAction={onAction}
          pinned={msg.pinned}
          onTogglePin={onTogglePin ? handleTogglePin : undefined}
          interrupted={msg.interrupted}
          onRetry={onRetry ? handleRetry : undefined}
        />
      )}
      {onBranch && index > 0 && (
        <button
          onClick={handleBranch}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-md bg-theme-surface/80 border border-theme-border text-theme-muted/70 hover:text-theme-accent hover:border-theme-accent transition-all text-xs"
          title="Créer une branche depuis ce message"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 2V8M3 8C3 9.1 3.9 10 5 10H8M11 12V6M11 6C11 4.9 10.1 4 9 4H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="3" cy="2" r="1.5" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="11" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      )}
    </div>
  )
})

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
  onAction?: (action: string, params: Record<string, string>) => void
  onBranch?: (messageIndex: number) => void
  onTogglePin?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRetry?: (messageId: string) => void
}

// Seuil en pixels pour considérer que l'utilisateur est "en bas". Si la
// distance entre scrollTop et le fond dépasse ce seuil, on ne suit plus le
// flux automatiquement (l'utilisateur a scrollé pour relire). Un bouton
// "↓ Descendre" apparaît tant qu'il y a du nouveau contenu.
const STICK_TO_BOTTOM_THRESHOLD = 120

export const MessageList = memo(function MessageList({ messages, isStreaming, streamingContent, onAction, onBranch, onTogglePin, onEdit, onRetry }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const prevMessagesCount = useRef(messages.length)

  const isAtBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return true
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    return distance <= STICK_TO_BOTTOM_THRESHOLD
  }, [])

  const handleScroll = useCallback(() => {
    setUserScrolledUp(!isAtBottom())
  }, [isAtBottom])

  // Nouveau message (typiquement le user qui envoie) : on revient toujours
  // en bas, peu importe l'état du scroll. Comportement attendu de tout
  // chat : le tour qu'on vient d'envoyer doit être visible.
  useEffect(() => {
    const isNewMessage = messages.length > prevMessagesCount.current
    prevMessagesCount.current = messages.length
    if (isNewMessage) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      setUserScrolledUp(false)
    }
  }, [messages.length])

  // Pendant le streaming : on ne suit que si l'utilisateur est resté en
  // bas. S'il a scrollé pour relire, on respecte sa position.
  useEffect(() => {
    if (!streamingContent) return
    if (!userScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [streamingContent, userScrolledUp])

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setUserScrolledUp(false)
  }, [])

  // Find the index of the last user message (for edit button)
  const lastUserIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') return i
    }
    return -1
  })()

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto px-4 py-4">
        {messages.map((msg, index) => (
          <MessageItem
            key={msg.id}
            msg={msg}
            index={index}
            onAction={onAction}
            onBranch={onBranch}
            onTogglePin={onTogglePin}
            onEdit={onEdit}
            onRetry={onRetry}
            isLastUserMessage={index === lastUserIndex && !isStreaming}
          />
        ))}

        {isStreaming && streamingContent && (
          <>
            <AssistantBubble content={streamingContent} onAction={onAction} />
            <StreamingIndicator />
          </>
        )}

        {isStreaming && !streamingContent && (
          <TypingIndicator />
        )}

        <div ref={bottomRef} />
      </div>

      {isStreaming && userScrolledUp && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-theme-accent text-theme-bg text-xs font-sans uppercase tracking-kicker shadow-lg hover:opacity-90 transition-opacity flex items-center gap-1.5 z-10"
          aria-label="Descendre"
        >
          <span>↓</span>
          <span>Descendre</span>
        </button>
      )}
    </div>
  )
})
