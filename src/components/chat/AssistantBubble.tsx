import { memo, useCallback, useRef } from 'react'
import { AssistantAvatar } from './AssistantAvatar'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'

interface AssistantBubbleProps {
  content: string
  onAction?: (action: string, params: Record<string, string>) => void
  pinned?: boolean
  onTogglePin?: () => void
}

export const AssistantBubble = memo(function AssistantBubble({ content, onAction, pinned, onTogglePin }: AssistantBubbleProps) {
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
    <div className="group/bubble relative flex gap-2.5 mb-3">
      <AssistantAvatar />
      <div
        ref={bubbleRef}
        onClick={handleClick}
        className={`relative max-w-[92%] bg-white text-bubble-user px-4 py-3 rounded-2xl rounded-tl-md shadow-sm leading-relaxed ${
          pinned ? 'ring-1 ring-accent/40' : ''
        }`}
      >
        <MarkdownRenderer content={content} />
        {pinned && (
          <span className="absolute -top-2 -left-2 bg-accent text-white text-[10px] px-1.5 py-0.5 rounded-full">📌</span>
        )}
      </div>
      {onTogglePin && (
        <button
          onClick={onTogglePin}
          className={`absolute bottom-1 right-1 p-1 rounded-md transition-all ${
            pinned
              ? 'text-accent opacity-80'
              : 'opacity-0 group-hover/bubble:opacity-100 text-gray-300 hover:text-accent'
          }`}
          aria-label={pinned ? 'Désépingler' : 'Épingler'}
          title={pinned ? 'Désépingler' : 'Épingler ce message'}
        >
          📌
        </button>
      )}
    </div>
  )
})
