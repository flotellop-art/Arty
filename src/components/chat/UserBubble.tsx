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
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] w-full bg-bubble-user text-cream px-4 py-3 rounded-2xl rounded-tr-md text-sm leading-relaxed font-light">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={Math.min(8, Math.max(2, value.split('\n').length))}
            className="w-full bg-transparent border-none focus:outline-none resize-none text-cream placeholder-cream/50"
          />
          <div className="flex gap-2 mt-2 justify-end">
            <button
              onClick={handleCancel}
              className="px-2 py-1 rounded-md text-xs bg-white/10 hover:bg-white/20 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              className="px-2 py-1 rounded-md text-xs bg-accent hover:bg-accent/90 transition-colors"
            >
              ✓ Envoyer
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group/user relative flex justify-end mb-3">
      <div className={`relative max-w-[85%] bg-bubble-user text-cream px-4 py-3 rounded-2xl rounded-tr-md text-sm leading-relaxed font-light whitespace-pre-wrap ${
        pinned ? 'ring-1 ring-accent/40' : ''
      }`}>
        {content}
        {pinned && (
          <span className="absolute -top-2 -right-2 bg-accent text-white text-[10px] px-1.5 py-0.5 rounded-full">📌</span>
        )}
      </div>
      <div className="absolute bottom-1 left-[-4px] translate-x-[-100%] flex gap-1">
        {onEdit && (
          <button
            onClick={() => setEditing(true)}
            className="opacity-0 group-hover/user:opacity-100 p-1 rounded-md text-gray-400 hover:text-accent transition-all"
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
                ? 'text-accent opacity-80'
                : 'opacity-0 group-hover/user:opacity-100 text-gray-400 hover:text-accent'
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
