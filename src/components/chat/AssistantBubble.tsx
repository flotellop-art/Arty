import { memo, useCallback, useRef } from 'react'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'
import { Tag } from '../shared/editorial'
import { StarIcon } from '../shared/StarIcon'

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
    <div className="group/bubble relative mb-5 max-w-[94%]">
      <div className="flex items-center gap-2 mb-1.5">
        <StarIcon size={12} />
        <Tag>Arty</Tag>
        {pinned && <Tag accent>◈ épinglé</Tag>}
      </div>
      <div
        ref={bubbleRef}
        onClick={handleClick}
        className="font-sans text-[14px] leading-[1.6]"
        style={{
          color: 'var(--arty-ink)',
          paddingLeft: 20,
          borderLeft: pinned ? '2px solid var(--arty-accent)' : '2px solid var(--arty-line)',
        }}
      >
        <MarkdownRenderer content={content} />
      </div>
      {onTogglePin && (
        <button
          onClick={onTogglePin}
          className={`absolute top-0 right-0 p-1 rounded-md transition-all ${pinned ? 'opacity-80' : 'opacity-0 group-hover/bubble:opacity-100'}`}
          style={{ color: pinned ? 'var(--arty-accent)' : 'var(--arty-muted)' }}
          aria-label={pinned ? 'Désépingler' : 'Épingler'}
          title={pinned ? 'Désépingler' : 'Épingler ce message'}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1L8 4L11 5L8.5 7L9 11L6.5 9L4 11L4.5 7L2 5L5 4L6.5 1Z" stroke="currentColor" strokeWidth="1" fill="none"/></svg>
        </button>
      )}
    </div>
  )
})
