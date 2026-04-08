import { useRef, useEffect } from 'react'
import type { Message } from '../../types'
import { UserBubble } from './UserBubble'
import { AssistantBubble } from './AssistantBubble'
import { TypingIndicator } from './TypingIndicator'

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
}

export function MessageList({ messages, isStreaming, streamingContent }: MessageListProps) {
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
          <AssistantBubble key={msg.id} content={msg.content} />
        )
      ))}

      {isStreaming && streamingContent && (
        <AssistantBubble content={streamingContent} />
      )}

      {isStreaming && !streamingContent && (
        <TypingIndicator />
      )}

      <div ref={bottomRef} />
    </div>
  )
}
