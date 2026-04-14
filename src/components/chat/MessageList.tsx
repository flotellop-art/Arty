import { memo, useRef, useEffect, useCallback } from 'react'
import type { Message } from '../../types'
import { UserBubble } from './UserBubble'
import { AssistantBubble } from './AssistantBubble'
import { TypingIndicator } from './TypingIndicator'

interface MessageItemProps {
  msg: Message
  index: number
  onAction?: (action: string, params: Record<string, string>) => void
  onBranch?: (messageIndex: number) => void
}

const MessageItem = memo(function MessageItem({ msg, index, onAction, onBranch }: MessageItemProps) {
  const handleBranch = useCallback(() => onBranch?.(index), [onBranch, index])

  return (
    <div className="group relative">
      {msg.role === 'user' ? (
        <UserBubble content={msg.content} />
      ) : (
        <AssistantBubble content={msg.content} onAction={onAction} />
      )}
      {onBranch && index > 0 && (
        <button
          onClick={handleBranch}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-md bg-white/80 border border-gray-200 text-gray-400 hover:text-accent hover:border-accent transition-all text-xs"
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
}

export const MessageList = memo(function MessageList({ messages, isStreaming, streamingContent, onAction, onBranch }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {messages.map((msg, index) => (
        <MessageItem
          key={msg.id}
          msg={msg}
          index={index}
          onAction={onAction}
          onBranch={onBranch}
        />
      ))}

      {isStreaming && streamingContent && (
        <AssistantBubble content={streamingContent} onAction={onAction} />
      )}

      {isStreaming && !streamingContent && (
        <TypingIndicator />
      )}

      <div ref={bottomRef} />
    </div>
  )
})
