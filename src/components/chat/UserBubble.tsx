import { memo, useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileAttachment } from '../../types'
import { getFile } from '../../services/secureFileStorage'

interface UserBubbleProps {
  content: string
  files?: FileAttachment[]
  pinned?: boolean
  onTogglePin?: () => void
  onEdit?: (newContent: string) => void
}

// Thumbnail d'un fichier attaché : preview image lazy-loadée depuis IndexedDB,
// ou icône PDF/document. Cleanup blob URL au démontage pour éviter les fuites
// mémoire (chaque createObjectURL doit être pairé avec un revokeObjectURL).
const FileThumbnail = memo(function FileThumbnail({ file }: { file: FileAttachment }) {
  const { t } = useTranslation()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const isImage = file.type.startsWith('image/')

  useEffect(() => {
    if (!isImage) return
    let cancelled = false
    let urlToRevoke: string | null = null

    getFile(file.id)
      .then((loaded) => {
        if (cancelled) return
        if (!loaded?.data) {
          setUnavailable(true)
          return
        }
        const byteString = atob(loaded.data)
        const arr = new Uint8Array(byteString.length)
        for (let i = 0; i < byteString.length; i++) arr[i] = byteString.charCodeAt(i)
        const blob = new Blob([arr], { type: loaded.type })
        urlToRevoke = URL.createObjectURL(blob)
        setPreviewUrl(urlToRevoke)
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true)
      })

    return () => {
      cancelled = true
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke)
    }
  }, [file.id, file.type, isImage])

  if (isImage) {
    if (unavailable) {
      return (
        <div className="w-[100px] h-[100px] rounded-md border border-theme-border bg-theme-surface flex items-center justify-center text-[10px] text-theme-muted text-center px-2">
          {t('chat.userBubble.imageUnavailable')}
        </div>
      )
    }
    if (!previewUrl) {
      return (
        <div className="w-[100px] h-[100px] rounded-md border border-theme-border bg-theme-surface animate-pulse" />
      )
    }
    return (
      <img
        src={previewUrl}
        alt={file.name}
        className="w-[100px] h-[100px] object-cover rounded-md border border-theme-border"
        title={file.name}
      />
    )
  }

  // Non-image (PDF, doc, autre)
  const icon = file.type === 'application/pdf' ? '📄' : '📎'
  return (
    <div className="px-2 py-1.5 rounded-md border border-theme-border bg-theme-surface flex items-center gap-1.5 text-xs text-theme-ink max-w-[200px]">
      <span>{icon}</span>
      <span className="truncate" title={file.name}>{file.name}</span>
    </div>
  )
})

export const UserBubble = memo(function UserBubble({ content, files, pinned, onTogglePin, onEdit }: UserBubbleProps) {
  const { t } = useTranslation()
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

  const hasFiles = files && files.length > 0

  if (editing) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[85%] w-full font-display italic text-base text-theme-ink leading-snug border-r-2 border-theme-accent pr-3 py-1 break-words">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={Math.min(8, Math.max(2, value.split('\n').length))}
            className="w-full bg-transparent border-none focus:outline-none resize-none text-theme-ink placeholder:text-theme-muted font-display italic text-base text-right"
          />
          <div className="flex gap-2 mt-2 justify-end">
            <button
              onClick={handleCancel}
              className="px-2.5 py-1 text-[11px] font-sans uppercase tracking-kicker text-theme-muted hover:text-theme-ink transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1 text-[11px] font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg hover:opacity-90 transition-opacity rounded-sm"
            >
              ✓ {t('chat.userBubble.send')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group/user relative flex flex-col items-end mb-4">
      {hasFiles && (
        <div className="flex flex-wrap gap-2 mb-1.5 justify-end max-w-[85%]">
          {files!.map((f) => (
            <FileThumbnail key={f.id} file={f} />
          ))}
        </div>
      )}
      <div className="relative w-full flex justify-end">
        {(content.trim() || !hasFiles) && (
          <div className={`relative max-w-[85%] font-display italic text-base text-theme-ink leading-snug text-right border-r-2 border-theme-accent pr-3 py-1 whitespace-pre-wrap break-words ${
            pinned ? 'border-r-[3px]' : ''
          }`}>
            « {content} »
            {pinned && (
              <span className="absolute -top-2 -right-3 text-theme-accent text-[10px]">📌</span>
            )}
          </div>
        )}
        <div className="absolute bottom-0 left-[-4px] translate-x-[-100%] flex gap-1">
          {/* Audit UX — `opacity-0 group-hover` seul = boutons invisibles sur
              tactile (pas de hover) ET au clavier. Pattern validé ailleurs
              (MessageList branche, AssistantBubble speak) : 50% permanent sur
              mobile, hover desktop, focus-visible pour le clavier. */}
          {onEdit && (
            <button
              onClick={() => setEditing(true)}
              className="opacity-50 md:opacity-0 md:group-hover/user:opacity-100 focus-visible:opacity-100 p-2 rounded-md text-theme-muted hover:text-theme-accent transition-all"
              aria-label={t('chat.userBubble.edit')}
              title={t('chat.userBubble.editTitle')}
            >
              ✏️
            </button>
          )}
          {onTogglePin && (
            <button
              onClick={onTogglePin}
              className={`p-2 rounded-md transition-all ${
                pinned
                  ? 'text-theme-accent opacity-80'
                  : 'opacity-50 md:opacity-0 md:group-hover/user:opacity-100 focus-visible:opacity-100 text-theme-muted hover:text-theme-accent'
              }`}
              aria-label={pinned ? t('chat.bubble.unpin') : t('chat.bubble.pin')}
            >
              📌
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
