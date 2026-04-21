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

  // Audio recording state (Feature 15 — hold-to-record voice messages)
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [isSwipeCancelling, setIsSwipeCancelling] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelRecordingRef = useRef(false)
  const wantRecordingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const pointerStartXRef = useRef(0)
  const pressStartRef = useRef(0)

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

  // Feature 15 — Whisper voice messages (hold-to-record, WhatsApp-style)
  // Flow: pointerDown → getUserMedia + MediaRecorder.start
  //        pointerMove (dx < -60px) → isSwipeCancelling = true
  //        pointerUp (cancel OR held < 500ms) → stop + discard
  //        pointerUp (normal) → stop + transcribe via OpenAI Whisper (BYOK)
  //        pointerCancel / unmount → stop + discard
  // Safety: max 60s auto-stop, stream torn down on every exit path, concurrent
  // Web-Speech listening is paused to avoid mic contention.

  const HOLD_MIN_MS = 500
  const HOLD_MAX_MS = 60_000
  const SWIPE_CANCEL_THRESHOLD_PX = 60

  const pickAudioMimeType = (): string => {
    if (typeof MediaRecorder === 'undefined') return ''
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
      'audio/ogg;codecs=opus',
    ]
    for (const mt of candidates) {
      if (MediaRecorder.isTypeSupported(mt)) return mt
    }
    return ''
  }

  const clearRecordingTimers = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current)
      maxDurationTimerRef.current = null
    }
  }, [])

  const hardResetRecording = useCallback(() => {
    clearRecordingTimers()
    const rec = mediaRecorderRef.current
    mediaRecorderRef.current = null
    // Signal onstop to discard — must be set BEFORE rec.stop() triggers the
    // async onstop callback. onstop consumes and resets the flag itself.
    cancelRecordingRef.current = true
    if (rec && rec.state !== 'inactive') {
      try { rec.stop() } catch {}
    }
    audioChunksRef.current = []
    wantRecordingRef.current = false
    pointerIdRef.current = null
    setIsRecordingAudio(false)
    setIsSwipeCancelling(false)
  }, [clearRecordingTimers])

  const startAudioRecording = useCallback(async () => {
    if (isRecordingAudio || mediaRecorderRef.current) return
    setAudioError(null)
    wantRecordingRef.current = true

    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      wantRecordingRef.current = false
      setAudioError(t('chat.input.voice.unsupported'))
      return
    }

    // Pause Web Speech API if it was listening — two getUserMedia consumers on
    // the same mic confuse Android SpeechRecognizer and iOS AVAudioSession.
    if (isListening) {
      try { stopListening() } catch {}
    }

    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      // If the user already released (stopAudioRecording cleared the flag),
      // don't clobber any tooShort / swipe-cancel message they already see.
      if (!wantRecordingRef.current) return
      wantRecordingRef.current = false
      const name = (err as { name?: string } | null)?.name
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' ||
          name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setAudioError(t('chat.input.voice.micDenied'))
      } else {
        setAudioError(t('chat.input.voice.unsupported'))
      }
      return
    }

    // Guard: pointerUp may have fired before getUserMedia resolved.
    if (!wantRecordingRef.current) {
      stream.getTracks().forEach((tr) => tr.stop())
      return
    }

    const mimeType = pickAudioMimeType()
    let recorder: MediaRecorder
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
    } catch (err) {
      // Constructor throws on unsupported mime — release the stream NOW or the
      // mic stays hot (the classic leak the previous audit flagged).
      console.warn('MediaRecorder constructor failed:', err)
      stream.getTracks().forEach((tr) => tr.stop())
      wantRecordingRef.current = false
      setAudioError(t('chat.input.voice.unsupported'))
      return
    }

    audioChunksRef.current = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }
    recorder.onerror = (e) => {
      console.warn('MediaRecorder error:', e)
      stream?.getTracks().forEach((tr) => tr.stop())
      hardResetRecording()
      setAudioError(t('chat.input.voice.unsupported'))
    }
    recorder.onstop = async () => {
      stream?.getTracks().forEach((tr) => tr.stop())
      clearRecordingTimers()
      const chunks = audioChunksRef.current
      audioChunksRef.current = []
      const wasCancelled = cancelRecordingRef.current
      cancelRecordingRef.current = false
      mediaRecorderRef.current = null
      setIsRecordingAudio(false)
      setIsSwipeCancelling(false)
      if (wasCancelled || chunks.length === 0) return

      const blob = new Blob(chunks, { type: mimeType || recorder.mimeType || 'audio/webm' })
      // Too small = near-empty chunk (<300ms of opus ≈ 0.5KB) → skip to avoid
      // wasting a Whisper request on silence.
      if (blob.size < 1024) return

      setIsTranscribing(true)
      try {
        const { transcribeAudio } = await import('../../services/whisperClient')
        const transcription = await transcribeAudio(blob)
        if (transcription) {
          setText((prev) => (prev ? prev + ' ' : '') + transcription)
        }
      } catch (err) {
        console.warn('Whisper transcription failed:', err)
        setAudioError(t('chat.input.voice.transcribeFailed'))
      } finally {
        setIsTranscribing(false)
      }
    }

    mediaRecorderRef.current = recorder
    try {
      recorder.start()
    } catch (err) {
      console.warn('MediaRecorder start failed:', err)
      stream.getTracks().forEach((tr) => tr.stop())
      hardResetRecording()
      setAudioError(t('chat.input.voice.unsupported'))
      return
    }
    setIsRecordingAudio(true)
    setRecordingDuration(0)
    recordTimerRef.current = setInterval(() => {
      setRecordingDuration((d) => d + 1)
    }, 1000)
    // Safety cap — auto-stop after HOLD_MAX_MS even if pointer is stuck.
    maxDurationTimerRef.current = setTimeout(() => {
      const r = mediaRecorderRef.current
      if (r && r.state === 'recording') {
        try { r.stop() } catch {}
      }
    }, HOLD_MAX_MS)
  }, [isRecordingAudio, isListening, stopListening, t, clearRecordingTimers, hardResetRecording])

  const stopAudioRecording = useCallback((cancel = false) => {
    wantRecordingRef.current = false
    const rec = mediaRecorderRef.current
    if (rec && rec.state === 'recording') {
      cancelRecordingRef.current = cancel
      try { rec.stop() } catch {}
    } else {
      // Nothing to stop (e.g., getUserMedia still pending, or already stopped).
      // Keep cancel flag set so the pending start aborts via wantRecordingRef.
      clearRecordingTimers()
      if (!rec) {
        setIsRecordingAudio(false)
        setIsSwipeCancelling(false)
      }
    }
  }, [clearRecordingTimers])

  // Pointer handlers wired to the mic button for the hold-to-record UX.
  const handleMicPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    // Prevent the browser's long-press context menu and stop focus stealing
    // from the textarea on desktop (pointer capture handles the rest).
    e.preventDefault()
    pointerIdRef.current = e.pointerId
    pointerStartXRef.current = e.clientX
    pressStartRef.current = Date.now()
    setIsSwipeCancelling(false)
    setAudioError(null)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    void startAudioRecording()
  }, [startAudioRecording])

  const handleMicPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    const dx = e.clientX - pointerStartXRef.current
    const cancelling = dx < -SWIPE_CANCEL_THRESHOLD_PX
    setIsSwipeCancelling((prev) => (prev === cancelling ? prev : cancelling))
  }, [])

  const handleMicPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    const heldMs = Date.now() - pressStartRef.current
    const cancelSwipe = isSwipeCancelling
    pointerIdRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    if (cancelSwipe) {
      stopAudioRecording(true)
      return
    }
    if (heldMs < HOLD_MIN_MS) {
      // Too-short press — user tapped rather than held. Discard audio and
      // show a hint. This also covers the case where they changed their mind.
      stopAudioRecording(true)
      setAudioError(t('chat.input.voice.tooShort'))
      return
    }
    stopAudioRecording(false)
  }, [isSwipeCancelling, stopAudioRecording, t])

  const handleMicPointerCancel = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    pointerIdRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    stopAudioRecording(true)
  }, [stopAudioRecording])

  // Safety: tear down the recorder + stream if the component unmounts while
  // recording. Without this the mic stays hot after navigating away.
  // hardResetRecording handles the cancel flag + flags + state itself.
  useEffect(() => {
    return () => { hardResetRecording() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <div className="relative px-4 pb-4 pt-2 bg-theme-bg" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}>
      {/* Slash command palette (Feature 2) */}
      {showSlashPalette && filteredCommands.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-theme-surface rounded-xl shadow-lg border border-theme-border overflow-hidden z-20 animate-fade-in">
          <div className="text-[10px] uppercase tracking-kicker font-semibold text-theme-muted px-3 py-2 border-b border-theme-border bg-theme-bg">
            Commandes
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.cmd}
                onClick={() => applySlashCommand(cmd)}
                onMouseEnter={() => setSlashSelectedIndex(i)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  i === slashSelectedIndex ? 'bg-theme-accent/10' : 'hover:bg-theme-ink/5'
                }`}
              >
                <span className="text-base">{cmd.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-theme-ink font-semibold">{cmd.cmd}</p>
                  <p className="text-xs text-theme-muted truncate">{cmd.label}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Calendar event suggestion pill (Feature 16) */}
      {calendarSuggestion && !showCalendarForm && (
        <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-theme-accent/10 border border-theme-accent/20 rounded-xl text-xs text-theme-ink">
          <span>📅</span>
          <span className="flex-1 truncate">
            Créer un événement : <span className="font-semibold">{calendarSuggestion.text}</span>
          </span>
          <button
            onClick={() => setShowCalendarForm(true)}
            className="px-2 py-0.5 rounded-md bg-theme-accent text-theme-bg text-[10px] font-semibold hover:opacity-90"
          >
            Créer
          </button>
          <button
            onClick={() => setCalendarSuggestion(null)}
            className="text-theme-muted hover:text-theme-ink"
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
              className="flex items-center gap-1.5 bg-theme-surface rounded-lg border border-theme-border px-2.5 py-1.5 text-xs text-theme-ink/70 flex-shrink-0"
            >
              <span>{file.type.startsWith('image/') ? '🖼️' : '📄'}</span>
              <span className="max-w-[120px] truncate">{file.name}</span>
              <button
                onClick={() => removeFile(i)}
                className="text-theme-muted hover:text-theme-accent ml-1"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mic / audio error message (covers speech recognition + Whisper) */}
      {(micError || audioError) && (
        <div className="text-xs text-red-500 mb-1 px-1">
          {micError || audioError}
        </div>
      )}

      {/* Interim transcript indicator (Web Speech API) */}
      {isListening && interimTranscript && (
        <div className="text-xs text-theme-muted italic mb-1 px-1 truncate">
          {interimTranscript}...
        </div>
      )}

      {/* Voice message recording indicator (Whisper hold-to-record) */}
      {isRecordingAudio && (
        <div
          className={`mb-1 px-2 py-1.5 rounded-lg text-xs flex items-center gap-2 transition-colors ${
            isSwipeCancelling
              ? 'bg-red-100 text-red-600 font-semibold'
              : 'bg-theme-ink/5 text-theme-muted'
          }`}
        >
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              isSwipeCancelling ? 'bg-red-600' : 'bg-red-500 animate-pulse'
            }`}
          />
          <span className="font-mono tabular-nums">
            {recordingDuration.toString().padStart(2, '0')}s
          </span>
          <span className="flex-1 truncate">
            {isSwipeCancelling
              ? t('chat.input.voice.releaseToCancel')
              : t('chat.input.voice.recording')}
          </span>
          {!isSwipeCancelling && (
            <span className="text-[10px] opacity-70 whitespace-nowrap">
              {t('chat.input.voice.swipeToCancel')}
            </span>
          )}
        </div>
      )}

      {/* Transcribing indicator (after release, while Whisper is responding) */}
      {isTranscribing && !isRecordingAudio && (
        <div className="text-xs text-theme-muted italic mb-1 px-1 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-theme-accent animate-pulse" />
          {t('chat.input.voice.transcribing')}
        </div>
      )}

      <div className="flex items-end gap-2 bg-theme-surface rounded-2xl border border-theme-border px-3 py-2 shadow-sm">
        {/* Plus button — file upload */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex-shrink-0 p-1.5 rounded-full hover:bg-theme-ink/5 transition-colors text-theme-muted mb-0.5"
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
            className="flex-shrink-0 p-1.5 rounded-full hover:bg-theme-ink/5 transition-colors text-theme-muted mb-0.5"
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
            className="flex-shrink-0 p-1.5 rounded-full hover:bg-theme-ink/5 transition-colors text-theme-muted mb-0.5"
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
              className="flex-shrink-0 p-1.5 rounded-full hover:bg-theme-ink/5 transition-colors text-theme-muted mb-0.5"
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
          className="flex-1 resize-none bg-transparent text-sm text-theme-ink placeholder:text-theme-muted/60 focus:outline-none py-1.5 font-sans font-light leading-relaxed"
        />

        {/* Whisper voice message (Feature 15) — hold to record, release to send,
            swipe left to cancel. BYOK OpenAI key required. */}
        {hasOpenAI && (
          <button
            type="button"
            onPointerDown={handleMicPointerDown}
            onPointerMove={handleMicPointerMove}
            onPointerUp={handleMicPointerUp}
            onPointerCancel={handleMicPointerCancel}
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
            className={`relative flex-shrink-0 p-1.5 rounded-full transition-colors mb-0.5 ${
              isSwipeCancelling
                ? 'bg-red-200 text-red-700'
                : isRecordingAudio
                ? 'bg-red-100 text-red-500 scale-110'
                : 'hover:bg-theme-ink/5 text-theme-muted'
            }`}
            aria-label={t('chat.input.aria.holdToRecord')}
            title={t('chat.input.aria.holdToRecord')}
            disabled={isTranscribing}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="5" fill="currentColor" />
            </svg>
          </button>
        )}

        {/* Mic button */}
        {isMicSupported && (
          <button
            onClick={handleMicClick}
            className={`relative flex-shrink-0 p-1.5 rounded-full transition-colors mb-0.5 ${
              isListening
                ? 'bg-red-100 text-red-500 hover:bg-red-200'
                : 'hover:bg-theme-ink/5 text-theme-muted'
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
            className="flex-shrink-0 w-8 h-8 rounded-full bg-theme-ink text-theme-bg flex items-center justify-center hover:opacity-90 transition-opacity mb-0.5"
            aria-label={t('chat.input.aria.stop')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() && files.length === 0}
            className="flex-shrink-0 w-8 h-8 rounded-full bg-theme-ink text-theme-bg flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition-opacity mb-0.5"
            aria-label={t('chat.input.aria.send')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 12V2M7 2L3 6M7 2L11 6"
                stroke="currentColor"
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
    <div className="mb-2 p-3 bg-theme-surface border border-theme-accent/30 rounded-xl shadow-sm">
      <p className="text-xs font-semibold text-theme-ink mb-2">📅 Nouvel événement</p>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Titre"
        className="w-full mb-2 px-2 py-1.5 text-xs border border-theme-border rounded-lg focus:outline-none focus:border-theme-accent bg-transparent text-theme-ink"
      />
      <input
        type="datetime-local"
        value={dateStr}
        onChange={(e) => setDateStr(e.target.value)}
        className="w-full mb-2 px-2 py-1.5 text-xs border border-theme-border rounded-lg focus:outline-none focus:border-theme-accent bg-transparent text-theme-ink"
      />
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-1.5 rounded-lg border border-theme-border text-xs text-theme-ink/70 hover:bg-theme-ink/5"
        >
          Annuler
        </button>
        <button
          onClick={() => onConfirm(title, new Date(dateStr))}
          className="flex-1 py-1.5 rounded-lg bg-theme-accent text-theme-bg text-xs font-semibold hover:opacity-90"
        >
          Ajouter au calendrier
        </button>
      </div>
    </div>
  )
}
