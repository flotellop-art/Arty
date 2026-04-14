import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileAttachment } from '../../types'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import { isNative } from '../../services/native/platform'
import { takePhoto, scanDocument } from '../../services/native/camera'
import { filterSlashCommands, type SlashCommand } from '../../constants/slashCommands'
import { detectDates } from '../../utils/dateDetector'
import { getValidAccessToken } from '../../services/googleAuth'
import { callGoogleApi } from '../../services/googleApiHelper'

interface InputBarProps {
  onSend: (text: string, files?: FileAttachment[]) => void
  isStreaming: boolean
  onStop?: () => void
  suggestion?: string | null
}

export function InputBar({ onSend, isStreaming, onStop }: InputBarProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<FileAttachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Slash command palette state
  const [showSlashPalette, setShowSlashPalette] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const filteredCommands = filterSlashCommands(text)

  // Calendar event suggestion (Feature 16)
  const [calendarSuggestion, setCalendarSuggestion] = useState<{ text: string; date: Date } | null>(null)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [showCalendarForm, setShowCalendarForm] = useState(false)

  // Audio recording state (Feature 15)
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const {
    isListening,
    interimTranscript,
    error: micError,
    isSupported: isMicSupported,
    startListening,
    stopListening,
  } = useSpeechRecognition()

  // Check Google connection once for the calendar suggestion pill
  useEffect(() => {
    let active = true
    getValidAccessToken().then((t) => { if (active) setGoogleConnected(!!t) }).catch(() => {})
    return () => { active = false }
  }, [])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [text])

  // Show slash palette when input starts with "/"
  useEffect(() => {
    if (text.startsWith('/') && !text.includes(' ') && !text.includes('\n')) {
      setShowSlashPalette(true)
      setSlashSelectedIndex(0)
    } else {
      setShowSlashPalette(false)
    }
  }, [text])

  // Detect dates in input for calendar suggestion pill
  useEffect(() => {
    if (!googleConnected || !text.trim()) {
      setCalendarSuggestion(null)
      return
    }
    const found = detectDates(text)
    if (found) {
      setCalendarSuggestion({ text: found.match, date: found.date })
    } else {
      setCalendarSuggestion(null)
    }
  }, [text, googleConnected])

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

  const applySlashCommand = useCallback((cmd: SlashCommand) => {
    setText(cmd.prompt)
    setShowSlashPalette(false)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashPalette && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSelectedIndex((i) => (i + 1) % filteredCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelectedIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSlashPalette(false)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const cmd = filteredCommands[slashSelectedIndex]
        if (cmd) applySlashCommand(cmd)
        return
      }
    }

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

  // Feature 14 — Web camera (mobile) via <input type="file" capture>
  const handleWebCamera = () => {
    cameraInputRef.current?.click()
  }

  const handleWebCameraChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(',')[1] || '')
      }
      reader.readAsDataURL(f)
    })
    setFiles((prev) => [...prev, {
      name: f.name || `photo_${Date.now()}.jpg`,
      type: f.type || 'image/jpeg',
      data: base64,
    }])
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  // Feature 15 — Whisper audio transcription (OpenAI)
  const startAudioRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        audioChunksRef.current = []
        try {
          const { transcribeAudio } = await import('../../services/whisperClient')
          const transcription = await transcribeAudio(blob)
          if (transcription) {
            setText((prev) => (prev ? prev + ' ' : '') + transcription)
          }
        } catch (err) {
          console.warn('Whisper transcription failed:', err)
        }
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecordingAudio(true)
      setRecordingDuration(0)
      recordTimerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1)
      }, 1000)
    } catch (err) {
      console.warn('Audio recording failed:', err)
    }
  }

  const stopAudioRecording = () => {
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') {
      rec.stop()
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    setIsRecordingAudio(false)
  }

  // Feature 16 — Create calendar event from detected date
  const handleCreateCalendarEvent = useCallback(async (title: string, date: Date) => {
    try {
      const startISO = date.toISOString().slice(0, 19)
      const endISO = new Date(date.getTime() + 60 * 60 * 1000).toISOString().slice(0, 19)
      await callGoogleApi('/api/calendar/action', {
        type: 'create',
        title,
        start: startISO,
        end: endISO,
      })
      setCalendarSuggestion(null)
      setShowCalendarForm(false)
    } catch (err) {
      console.warn('Create event failed:', err)
    }
  }, [])

  // Mobile detection for camera button (Feature 14)
  const hasCameraSupport = typeof navigator !== 'undefined' && !!navigator.mediaDevices
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  const showWebCamera = !isNative && hasCameraSupport && isMobile

  // Has OpenAI key (Feature 15)
  const [hasOpenAI, setHasOpenAI] = useState(false)
  useEffect(() => {
    import('../../services/activeApiKey').then((m) => {
      setHasOpenAI(m.hasOpenAIKey())
    })
  }, [])

  return (
    <div className="relative px-4 pb-4 pt-2 bg-cream" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}>
      {/* Slash command palette (Feature 2) */}
      {showSlashPalette && filteredCommands.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-20 animate-fade-in">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 px-3 py-2 border-b border-gray-100 bg-gray-50">
            Commandes
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.cmd}
                onClick={() => applySlashCommand(cmd)}
                onMouseEnter={() => setSlashSelectedIndex(i)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  i === slashSelectedIndex ? 'bg-accent/10' : 'hover:bg-gray-50'
                }`}
              >
                <span className="text-base">{cmd.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-bubble-user font-semibold">{cmd.cmd}</p>
                  <p className="text-xs text-gray-500 truncate">{cmd.label}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Calendar event suggestion pill (Feature 16) */}
      {calendarSuggestion && !showCalendarForm && (
        <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-accent/10 border border-accent/20 rounded-xl text-xs text-bubble-user">
          <span>📅</span>
          <span className="flex-1 truncate">
            Créer un événement : <span className="font-semibold">{calendarSuggestion.text}</span>
          </span>
          <button
            onClick={() => setShowCalendarForm(true)}
            className="px-2 py-0.5 rounded-md bg-accent text-white text-[10px] font-semibold hover:bg-accent/90"
          >
            Créer
          </button>
          <button
            onClick={() => setCalendarSuggestion(null)}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Ignorer"
          >
            ✕
          </button>
        </div>
      )}

      {showCalendarForm && calendarSuggestion && (
        <CalendarMiniForm
          detected={calendarSuggestion}
          context={text}
          onConfirm={handleCreateCalendarEvent}
          onCancel={() => setShowCalendarForm(false)}
        />
      )}

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

        {/* Web camera button — mobile web only (Feature 14) */}
        {showWebCamera && (
          <>
            <button
              onClick={handleWebCamera}
              title="Analyser une façade, un document, une photo de chantier"
              className="flex-shrink-0 p-1.5 rounded-full hover:bg-gray-100 transition-colors text-gray-400 mb-0.5"
              aria-label="Prendre une photo"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="2" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="9" cy="10" r="3" stroke="currentColor" strokeWidth="1.3" />
                <path d="M6 5L7 3H11L12 5" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </button>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleWebCameraChange}
              className="hidden"
            />
          </>
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

        {/* Whisper audio recording (Feature 15) — if OpenAI key is available */}
        {hasOpenAI && (
          <button
            onClick={isRecordingAudio ? stopAudioRecording : startAudioRecording}
            className={`relative flex-shrink-0 p-1.5 rounded-full transition-colors mb-0.5 ${
              isRecordingAudio
                ? 'bg-red-100 text-red-500 hover:bg-red-200'
                : 'hover:bg-gray-100 text-gray-400'
            }`}
            aria-label={isRecordingAudio ? 'Arrêter enregistrement' : 'Enregistrer audio (Whisper)'}
            title={isRecordingAudio ? `Enregistrement ${recordingDuration}s` : 'Enregistrer (Whisper)'}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="5" fill="currentColor" />
            </svg>
            {isRecordingAudio && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold px-1 rounded-full">
                {recordingDuration}s
              </span>
            )}
          </button>
        )}

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

// Mini-form for confirming a calendar event (Feature 16)
interface CalendarMiniFormProps {
  detected: { text: string; date: Date }
  context: string
  onConfirm: (title: string, date: Date) => void
  onCancel: () => void
}

function CalendarMiniForm({ detected, context, onConfirm, onCancel }: CalendarMiniFormProps) {
  const defaultTitle = context.trim().slice(0, 80) || `Événement ${detected.text}`
  const [title, setTitle] = useState(defaultTitle)
  const [dateStr, setDateStr] = useState(() => {
    const d = detected.date
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })

  return (
    <div className="mb-2 p-3 bg-white border border-accent/30 rounded-xl shadow-sm">
      <p className="text-xs font-semibold text-bubble-user mb-2">📅 Nouvel événement</p>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Titre"
        className="w-full mb-2 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-accent"
      />
      <input
        type="datetime-local"
        value={dateStr}
        onChange={(e) => setDateStr(e.target.value)}
        className="w-full mb-2 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-accent"
      />
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
        >
          Annuler
        </button>
        <button
          onClick={() => onConfirm(title, new Date(dateStr))}
          className="flex-1 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90"
        >
          Ajouter au calendrier
        </button>
      </div>
    </div>
  )
}
