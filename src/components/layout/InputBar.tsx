import { useState, useRef, useEffect, type KeyboardEvent } from 'react'

interface InputBarProps {
  onSend: (text: string) => void
  isStreaming: boolean
  onStop?: () => void
}

export function InputBar({ onSend, isStreaming, onStop }: InputBarProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [text])

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="px-4 pb-4 pt-2 bg-cream">
      <div className="flex items-end gap-2 bg-white rounded-2xl border border-gray-200 px-3 py-2 shadow-sm">
        {/* Plus button */}
        <button
          className="flex-shrink-0 p-1.5 rounded-full hover:bg-gray-100 transition-colors text-gray-400 mb-0.5"
          aria-label="Ajouter"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <line x1="9" y1="3" x2="9" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Discuter avec Arty..."
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-bubble-user placeholder-gray-400 focus:outline-none py-1.5 font-sans font-light leading-relaxed"
        />

        {/* Mic button */}
        <button
          className="flex-shrink-0 p-1.5 rounded-full hover:bg-gray-100 transition-colors text-gray-400 mb-0.5"
          aria-label="Micro"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="6.5" y="2" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4 9C4 11.76 6.24 14 9 14C11.76 14 14 11.76 14 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="9" y1="14" x2="9" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>

        {/* Send / Stop button */}
        {isStreaming ? (
          <button
            onClick={onStop}
            className="flex-shrink-0 w-8 h-8 rounded-full bg-bubble-user flex items-center justify-center hover:bg-gray-700 transition-colors mb-0.5"
            aria-label="Arrêter"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="2" width="8" height="8" rx="1" fill="#F5F0E8" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="flex-shrink-0 w-8 h-8 rounded-full bg-bubble-user flex items-center justify-center disabled:opacity-30 hover:bg-gray-700 transition-colors mb-0.5"
            aria-label="Envoyer"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 12V2M7 2L3 6M7 2L11 6"
                stroke="#F5F0E8"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
