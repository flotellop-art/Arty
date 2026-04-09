import { useRef, useEffect } from 'react'
import type { Message } from '../../types'
import { UserBubble } from './UserBubble'
import { AssistantBubble } from './AssistantBubble'
import { TypingIndicator } from './TypingIndicator'

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
  onAction?: (action: string, params: Record<string, string>) => void
}

export function MessageList({ messages, isStreaming, streamingContent, onAction }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {messages.map((msg) => (
        msg.role === 'user' ? (
          <UserBubble key={msg.id} content={msg.content} />
        ) : (
          <AssistantBubble key={msg.id} content={msg.content} onAction={onAction} />
        )
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
}
