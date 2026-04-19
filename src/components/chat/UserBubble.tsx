import { memo, useState, useRef, useEffect } from 'react'

interface UserBubbleProps {
  content: string
  pinned?: boolean
  onTogglePin?: () => void
  onEdit?: (newContent: string) => void
}

export const UserBubble = memo(function UserBubble({ content, pinned, onTogglePin, onEdit }: UserBubbleProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(value.length, value.length)
    }
  }, [editing, value.length])

  const handleSave = () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== content && onEdit) {
      onEdit(trimmed)
    }
    setEditing(false)
  }

  const handleCancel = () => {
    setValue(content)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  if (editing) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[85%] w-full font-display italic text-base text-theme-ink leading-snug border-r-2 border-theme-accent pr-3 py-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={Math.min(8, Math.max(2, value.split('\n').length))}
            className="w-full bg-transparent border-none focus:outline-none resize-none text-theme-ink placeholder:text-theme-muted/60 font-display italic text-base text-right"
          />
          <div className="flex gap-2 mt-2 justify-end">
            <button
              onClick={handleCancel}
              className="px-2.5 py-1 text-[11px] font-sans uppercase tracking-kicker text-theme-muted hover:text-theme-ink transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1 text-[11px] font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg hover:opacity-90 transition-opacity rounded-sm"
            >
              ✓ Envoyer
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group/user relative flex justify-end mb-4">
      <div className={`relative max-w-[85%] font-display italic text-base text-theme-ink leading-snug text-right border-r-2 border-theme-accent pr-3 py-1 whitespace-pre-wrap ${
        pinned ? 'border-r-[3px]' : ''
      }`}>
        « {content} »
        {pinned && (
          <span className="absolute -top-2 -right-3 text-theme-accent text-[10px]">📌</span>
        )}
      </div>
      <div className="absolute bottom-0 left-[-4px] translate-x-[-100%] flex gap-1">
        {onEdit && (
          <button
            onClick={() => setEditing(true)}
            className="opacity-0 group-hover/user:opacity-100 p-1 rounded-md text-theme-muted hover:text-theme-accent transition-all"
            aria-label="Modifier"
            title="Modifier et renvoyer"
          >
            ✏️
          </button>
        )}
        {onTogglePin && (
          <button
            onClick={onTogglePin}
            className={`p-1 rounded-md transition-all ${
              pinned
                ? 'text-theme-accent opacity-80'
                : 'opacity-0 group-hover/user:opacity-100 text-theme-muted hover:text-theme-accent'
            }`}
            aria-label={pinned ? 'Désépingler' : 'Épingler'}
          >
            📌
          </button>
        )}
      </div>
    </div>
  )
})
