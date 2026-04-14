import { memo } from 'react'
import { AssistantAvatar } from './AssistantAvatar'

export const TypingIndicator = memo(function TypingIndicator() {
  return (
    <div className="flex gap-2.5 mb-3">
      <AssistantAvatar />
      <div className="bg-white px-4 py-3 rounded-2xl rounded-tl-md shadow-sm flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-gray-400 typing-dot-1" />
        <span className="w-2 h-2 rounded-full bg-gray-400 typing-dot-2" />
        <span className="w-2 h-2 rounded-full bg-gray-400 typing-dot-3" />
      </div>
    </div>
  )
})
