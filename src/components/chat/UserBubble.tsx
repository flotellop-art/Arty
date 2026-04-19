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
    if (trimmed && trimmed !== content && onEdit) onEdit(trimmed)
    setEditing(false)
  }

  const handleCancel = () => {
    setValue(content)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave() }
    else if (e.key === 'Escape') { e.preventDefault(); handleCancel() }
  }

  if (editing) {
    return (
      <div className="flex justify-end mb-4">
        <div
          className="max-w-[85%] w-full px-4 py-3 font-serif italic text-[15px] leading-[1.4]"
          style={{
            color: 'var(--arty-ink)',
            backgroundColor: 'var(--arty-card)',
            borderRight: '2px solid var(--arty-accent)',
            borderRadius: 2,
          }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={Math.min(8, Math.max(2, value.split('\n').length))}
            className="w-full bg-transparent border-none focus:outline-none resize-none"
            style={{ color: 'var(--arty-ink)', fontStyle: 'italic' }}
          />
          <div className="flex gap-2 mt-2 justify-end not-italic">
            <button
              onClick={handleCancel}
              className="px-2 py-1 rounded-sm text-xs font-sans"
              style={{ border: '1px solid var(--arty-line)', color: 'var(--arty-ink)' }}
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              className="px-2 py-1 rounded-sm text-xs font-serif italic"
              style={{ backgroundColor: 'var(--arty-accent)', color: 'var(--arty-bg)' }}
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
      <div
        className="relative max-w-[85%] font-serif italic text-[16px] leading-[1.35] pr-3 text-right whitespace-pre-wrap"
        style={{
          color: 'var(--arty-ink)',
          borderRight: `2px solid ${pinned ? 'var(--arty-accent)' : 'var(--arty-accent)'}`,
          paddingRight: 12,
        }}
      >
        « {content} »
        {pinned && (
          <span
            className="absolute -top-1 -right-2 text-[9px] px-1.5 py-0.5 font-sans uppercase tracking-widest"
            style={{ backgroundColor: 'var(--arty-accent)', color: 'var(--arty-bg)', borderRadius: 2 }}
          >
            pin
          </span>
        )}
      </div>
      <div className="absolute bottom-0 left-[-4px] translate-x-[-100%] flex gap-1 not-italic">
        {onEdit && (
          <button
            onClick={() => setEditing(true)}
            className="opacity-0 group-hover/user:opacity-100 p-1 rounded-md transition-all"
            style={{ color: 'var(--arty-muted)' }}
            aria-label="Modifier"
            title="Modifier et renvoyer"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M8 2L11 5L4 12H1V9L8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
          </button>
        )}
        {onTogglePin && (
          <button
            onClick={onTogglePin}
            className={`p-1 rounded-md transition-all ${pinned ? 'opacity-80' : 'opacity-0 group-hover/user:opacity-100'}`}
            style={{ color: pinned ? 'var(--arty-accent)' : 'var(--arty-muted)' }}
            aria-label={pinned ? 'Désépingler' : 'Épingler'}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1L8 4L11 5L8.5 7L9 11L6.5 9L4 11L4.5 7L2 5L5 4L6.5 1Z" stroke="currentColor" strokeWidth="1" fill="none"/></svg>
          </button>
        )}
      </div>
    </div>
  )
})
