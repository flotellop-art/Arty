import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileAttachment } from '../../types'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import { isNative } from '../../services/native/platform'
import { takePhoto, scanDocument } from '../../services/native/camera'

interface InputBarProps {
  onSend: (text: string, files?: FileAttachment[]) => void
  isStreaming: boolean
  onStop?: () => void
}

export function InputBar({ onSend, isStreaming, onStop }: InputBarProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<FileAttachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    isListening,
    interimTranscript,
    error: micError,
    isSupported: isMicSupported,
    startListening,
    stopListening,
  } = useSpeechRecognition()

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [text])

  // Callback for speech recognition
  const handleTranscript = useCallback((spokenText: string) => {
    setText((prev) => {
      if (!prev) return spokenText
      return prev + (prev.endsWith(' ') ? '' : ' ') + spokenText
    })
  }, [])

  const handleSend = () => {
    const trimmed = text.trim()
    if ((!trimmed && files.length === 0) || isStreaming) return
    if (isListening) stopListening()
    onSend(trimmed || t('chat.input.defaultFilePrompt'), files.length > 0 ? files : undefined)
    setText('')
    setFiles([])
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files
    if (!selectedFiles) return

    const newFiles: FileAttachment[] = []
    for (let i = 0; i < selectedFiles.length; i++) {
      const f = selectedFiles.item(i)
      if (!f) continue
      if (f.size > 10 * 1024 * 1024) continue

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(',')[1] || '')
        }
        reader.readAsDataURL(f)
      })

      newFiles.push({
        name: f.name,
        type: f.type || 'application/octet-stream',
        data: base64,
      })
    }

    setFiles((prev) => [...prev, ...newFiles])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleMicClick = () => {
    if (isListening) {
      stopListening()
    } else {
      startListening(handleTranscript)
    }
  }

  const handleCamera = async () => {
    const photo = await takePhoto()
    if (photo) {
      setFiles((prev) => [...prev, {
        name: `photo_${Date.now()}.${photo.mimeType.split('/')[1] || 'jpeg'}`,
        type: photo.mimeType,
        data: photo.base64,
      }])
    }
  }

  const handleScan = async () => {
    const doc = await scanDocument()
    if (doc) {
      setFiles((prev) => [...prev, {
        name: `scan_${Date.now()}.${doc.mimeType.split('/')[1] || 'jpeg'}`,
        type: doc.mimeType,
        data: doc.base64,
      }])
    }
  }

  return (
    <div className="px-4 pb-4 pt-2 bg-cream" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}>
      {/* File previews */}
      {files.length > 0 && (
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 bg-white rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 flex-shrink-0"
            >
              <span>{file.type.startsWith('image/') ? '🖼️' : '📄'}</span>
              <span className="max-w-[120px] truncate">{file.name}</span>
              <button
                onClick={() => removeFile(i)}
                className="text-gray-400 hover:text-red-500 ml-1"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mic error message */}
      {micError && (
        <div className="text-xs text-red-500 mb-1 px-1">
          {micError}
        </div>
      )}

      {/* Interim transcript indicator */}
      {isListening && interimTranscript && (
        <div className="text-xs text-gray-400 italic mb-1 px-1 truncate">
          {interimTranscript}...
        </div>
      )}

      <div className="flex items-end gap-2 bg-white rounded-2xl border border-gray-200 px-3 py-2 shadow-sm">
        {/* Plus button — file upload */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex-shrink-0 p-1.5 rounded-full hover:bg-gray-100 transition-colors text-gray-400 mb-0.5"
          aria-label={t('chat.input.aria.attach')}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <line x1="9" y1="3" x2="9" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.md,.json,.xml,.doc,.docx,.xls,.xlsx"
          multiple
          className="hidden"
        />

        {/* Camera button — native only */}
        {isNative && (
          <button
            onClick={handleCamera}
            className="flex-shrink-0 p-1.5 rounded-full hover:bg-gray-100 transition-colors text-gray-400 mb-0.5"
            aria-label={t('chat.input.aria.camera')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="2" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="9" cy="10" r="3" stroke="currentColor" strokeWidth="1.3" />
              <path d="M6 5L7 3H11L12 5" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        )}

        {/* Scan button — native only */}
        {isNative && (
          <button
            onClick={handleScan}
            className="flex-shrink-0 p-1.5 rounded-full hover:bg-gray-100 transition-colors text-gray-400 mb-0.5"
            aria-label={t('chat.input.aria.scan')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="3" y="2" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <line x1="6" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="6" y1="9" x2="12" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="6" y1="12" x2="10" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? t('chat.input.listening') : t('chat.input.placeholder')}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-bubble-user placeholder-gray-400 focus:outline-none py-1.5 font-sans font-light leading-relaxed"
        />

        {/* Mic button */}
        {isMicSupported && (
          <button
            onClick={handleMicClick}
            className={`relative flex-shrink-0 p-1.5 rounded-full transition-colors mb-0.5 ${
              isListening
                ? 'bg-red-100 text-red-500 hover:bg-red-200'
                : 'hover:bg-gray-100 text-gray-400'
            }`}
            aria-label={isListening ? t('chat.input.aria.micStop') : t('chat.input.aria.micStart')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="6.5" y="2" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4 9C4 11.76 6.24 14 9 14C11.76 14 14 11.76 14 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="9" y1="14" x2="9" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            {isListening && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
            )}
          </button>
        )}

        {/* Send / Stop button */}
        {isStreaming ? (
          <button
            onClick={onStop}
            className="flex-shrink-0 w-8 h-8 rounded-full bg-bubble-user flex items-center justify-center hover:bg-gray-700 transition-colors mb-0.5"
            aria-label={t('chat.input.aria.stop')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="2" width="8" height="8" rx="1" fill="#F5F0E8" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() && files.length === 0}
            className="flex-shrink-0 w-8 h-8 rounded-full bg-bubble-user flex items-center justify-center disabled:opacity-30 hover:bg-gray-700 transition-colors mb-0.5"
            aria-label={t('chat.input.aria.send')}
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
