import { AssistantAvatar } from './AssistantAvatar'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'

interface AssistantBubbleProps {
  content: string
}

export function AssistantBubble({ content }: AssistantBubbleProps) {
  return (
    <div className="flex gap-2.5 mb-3">
      <AssistantAvatar />
      <div className="max-w-[92%] bg-white text-bubble-user px-4 py-3 rounded-2xl rounded-tl-md shadow-sm leading-relaxed">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  )
}
