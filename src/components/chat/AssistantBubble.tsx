import { memo, useCallback, useRef } from 'react'
import { AssistantAvatar } from './AssistantAvatar'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'

interface AssistantBubbleProps {
  content: string
  onAction?: (action: string, params: Record<string, string>) => void
}

export const AssistantBubble = memo(function AssistantBubble({ content, onAction }: AssistantBubbleProps) {
  const bubbleRef = useRef<HTMLDivElement>(null)

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const btn = target.closest('[data-action]') as HTMLElement
    if (!btn || !onAction) return

    e.preventDefault()
    const action = btn.dataset.action || ''
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(btn.dataset)) {
      if (key !== 'action') params[key] = value || ''
    }

    // Visual feedback
    if (action === 'reply') {
      btn.style.opacity = '0.5'
      btn.style.pointerEvents = 'none'
    } else {
      btn.style.opacity = '0.6'
      btn.textContent = '⏳ En cours...'
      setTimeout(() => {
        btn.style.opacity = '1'
        btn.textContent = '✅ Fait !'
      }, 2000)
    }

    onAction(action, params)
  }, [onAction])

  return (
    <div className="flex gap-2.5 mb-3">
      <AssistantAvatar />
      <div
        ref={bubbleRef}
        onClick={handleClick}
        className="max-w-[92%] bg-white text-bubble-user px-4 py-3 rounded-2xl rounded-tl-md shadow-sm leading-relaxed"
      >
        <MarkdownRenderer content={content} />
      </div>
    </div>
  )
})
