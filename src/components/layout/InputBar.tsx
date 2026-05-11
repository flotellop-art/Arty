import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileAttachment } from '../../types'
import { generateId } from '../../utils/generateId'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import { isNative } from '../../services/native/platform'
import { takePhoto, scanDocument } from '../../services/native/camera'
import { filterSlashCommands, type SlashCommand } from '../../constants/slashCommands'
import { detectDates } from '../../utils/dateDetector'
import { getValidAccessToken } from '../../services/googleAuth'
import { callGoogleApi } from '../../services/googleApiHelper'
import { enhancePrompt, canEnhancePrompt } from '../../services/promptEnhancer'
import { isPromptEnhancementEnabled } from '../../services/promptEnhancerSettings'
import { hasUrl } from '../../services/aiRouter'

interface InputBarProps {
  onSend: (text: string, files?: FileAttachment[]) => void
  isStreaming: boolean
  onStop?: () => void
  // Seed value for the textarea on mount. Used by the share-to-Arty flow
  // to pre-fill a suggested prompt. Only read once — later changes are
  // ignored so the user's edits aren't clobbered.
  initialText?: string
  // Seed value for attachments on mount. Same single-shot semantics as
  // initialText.
  initialFiles?: FileAttachment[]
  // Conversation flag — quand true, on est en mode EU-only (Mistral forcé,
  // données restent en Europe). Mistral n'a pas de tool web_fetch natif et
  // hallucine sur les URLs collées (citations inventées, sources [1][2][3]
  // fictives). On affiche alors un bandeau qui invite l'utilisateur à
  // coller le texte de l'article plutôt que l'URL.
  euOnly?: boolean
}

// V2 voice-first — tap = webkit speech, hold ≥ 600ms = Whisper recording.
const HOLD_THRESHOLD_MS = 600
const HOLD_MAX_MS = 60_000
const SWIPE_CANCEL_THRESHOLD_PX = 60

// Vignette d'aperçu d'un fichier en attente d'envoi. Pour les images, affiche
// la photo réelle via blob URL (le base64 est en RAM, pas encore persisté).
// Sans ça, l'utilisateur voit juste un emoji "🖼️" et a l'impression que la
// photo n'a pas été chargée.
function PendingFilePreview({ file, onRemove }: { file: FileAttachment; onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const isImage = file.type.startsWith('image/')

  useEffect(() => {
    if (!isImage || !file.data) return
    let urlToRevoke: string | null = null
    try {
      const byteString = atob(file.data)
      const arr = new Uint8Array(byteString.length)
      for (let i = 0; i < byteString.length; i++) arr[i] = byteString.charCodeAt(i)
      const blob = new Blob([arr], { type: file.type })
      urlToRevoke = URL.createObjectURL(blob)
      setPreviewUrl(urlToRevoke)
    } catch {
      // ignore, fallback to icon
    }
    return () => { if (urlToRevoke) URL.revokeObjectURL(urlToRevoke) }
  }, [file.data, file.type, isImage])

  if (isImage && previewUrl) {
    return (
      <div className="relative flex-shrink-0">
        <img
          src={previewUrl}
          alt={file.name}
          className="w-[64px] h-[64px] object-cover rounded-lg border border-theme-border"
          title={file.name}
        />
        <button
          onClick={onRemove}
          aria-label="Retirer"
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-theme-surface border border-theme-border text-theme-muted hover:text-theme-accent text-[10px] leading-none flex items-center justify-center shadow-sm"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 bg-theme-surface rounded-lg border border-theme-border px-2.5 py-1.5 text-xs text-theme-ink/70 flex-shrink-0">
      <span>{isImage ? '🖼️' : '📄'}</span>
      <span className="max-w-[120px] truncate">{file.name}</span>
      <button
        onClick={onRemove}
        className="text-theme-muted hover:text-theme-accent ml-1"
      >
        ✕
      </button>
    </div>
  )
}

export function InputBar({ onSend, isStreaming, onStop, initialText, initialFiles, euOnly }: InputBarProps) {
  const { t } = useTranslation()
  const [text, setText] = useState(() => initialText ?? '')
  const [files, setFiles] = useState<FileAttachment[]>(() => initialFiles ?? [])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Attach menu popup (replaces separate camera/scan/web-camera buttons).
  const [showAttachMenu, setShowAttachMenu] = useState(false)

  // Slash command palette state
  const [showSlashPalette, setShowSlashPalette] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const filteredCommands = filterSlashCommands(text)

  // Calendar event suggestion (Feature 16)
  const [calendarSuggestion, setCalendarSuggestion] = useState<{ text: string; date: Date } | null>(null)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [showCalendarForm, setShowCalendarForm] = useState(false)

  // Audio recording state — Whisper branch (long press).
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [isSwipeCancelling, setIsSwipeCancelling] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  // 0..1 during the 0–600ms hold window. Drives the progress ring SVG.
  const [holdProgress, setHoldProgress] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelRecordingRef = useRef(false)
  const wantRecordingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const pointerStartXRef = useRef(0)
  const pressStartRef = useRef(0)
  // Flip to true when the 600ms threshold is crossed — the visual switches to
  // "whisper" and the release path routes through transcription instead of
  // toggling webkit speech.
  const crossedThresholdRef = useRef(false)
  // Webkit listening state at pointerDown — so a short tap can intelligently
  // toggle (start if was off, stop if was on).
  const wasListeningAtDownRef = useRef(false)

  // Synced refs — MediaRecorder.onstop is async and captures closure values at
  // recorder creation. Reading these via refs lets the callback see the latest
  // draft/attachments at the moment the user releases the mic.
  const textRef = useRef('')
  const filesRef = useRef<FileAttachment[]>([])

  const {
    isListening,
    interimTranscript,
    error: micError,
    isSupported: isMicSupported,
    startListening,
    stopListening,
  } = useSpeechRecognition()

  // Check Google connection — re-evaluates on 'google-storage-ready' because
  // the first mount can fire before bootstrapGoogleStorage has decrypted tokens
  // on native (crypto is async). Without this the Whisper gate stays false
  // even after login finishes.
  useEffect(() => {
    let active = true
    const check = () => {
      getValidAccessToken().then((t) => { if (active) setGoogleConnected(!!t) }).catch(() => {})
    }
    check()
    window.addEventListener('google-storage-ready', check)
    return () => {
      active = false
      window.removeEventListener('google-storage-ready', check)
    }
  }, [])

  // Keep refs in sync with state for use inside MediaRecorder.onstop closure.
  useEffect(() => { textRef.current = text }, [text])
  useEffect(() => { filesRef.current = files }, [files])

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

  // Pure send function — takes explicit text/files rather than closing over
  // state, so the async MediaRecorder.onstop callback can call it with fresh
  // refs. Returns true on successful send, false if blocked (empty or streaming).
  const sendText = useCallback((textToSend: string, filesToSend: FileAttachment[]): boolean => {
    const trimmed = textToSend.trim()
    if ((!trimmed && filesToSend.length === 0) || isStreaming) return false
    if (isListening) stopListening()
    onSend(trimmed || t('chat.input.defaultFilePrompt'), filesToSend.length > 0 ? filesToSend : undefined)
    setText('')
    setFiles([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    return true
  }, [isStreaming, isListening, stopListening, onSend, t])

  const handleSend = () => { sendText(text, files) }

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
        id: generateId(),
        name: f.name,
        type: f.type || 'application/octet-stream',
        data: base64,
        size: f.size,
      })
    }

    setFiles((prev) => [...prev, ...newFiles])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleCamera = async () => {
    const photo = await takePhoto()
    if (photo) {
      setFiles((prev) => [...prev, {
        id: generateId(),
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
        id: generateId(),
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
      id: generateId(),
      name: f.name || `photo_${Date.now()}.jpg`,
      type: f.type || 'image/jpeg',
      data: base64,
      size: f.size,
    }])
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  // V2 voice button — tap = webkit speech toggle, hold ≥ 600ms = Whisper.
  // Flow:
  //   pointerDown: start 16ms interval tracking 0→1 hold progress,
  //                start MediaRecorder silently (captures audio from t=0 so
  //                nothing is lost when the hold crosses the threshold).
  //   progress === 1 (at 600ms): crossedThresholdRef = true, visual flips to
  //                "whisper" state, MediaRecorder keeps capturing.
  //   pointerMove (dx < -60px AND crossed): isSwipeCancelling = true.
  //   pointerUp:
  //     if swipe-cancelled → discard audio, no webkit toggle.
  //     if held < 600ms    → discard audio, toggle webkit listening.
  //     if held ≥ 600ms    → stop MediaRecorder → transcribe → auto-send.
  //   pointerCancel / unmount: discard everything.
  // Safety: max 60s auto-stop, stream torn down on every exit path.

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

  const clearHoldInterval = useCallback(() => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current)
      holdIntervalRef.current = null
    }
  }, [])

  const hardResetRecording = useCallback(() => {
    clearRecordingTimers()
    clearHoldInterval()
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
    crossedThresholdRef.current = false
    setIsRecordingAudio(false)
    setIsSwipeCancelling(false)
    setHoldProgress(0)
  }, [clearRecordingTimers, clearHoldInterval])

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
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          noiseSuppression: true,
          echoCancellation: true,
        },
      })
    } catch (err) {
      // If the user already released (stopAudioRecording cleared the flag),
      // don't clobber any tooShort / swipe-cancel message they already see.
      if (!wantRecordingRef.current) return
      wantRecordingRef.current = false
      const name = (err as { name?: string } | null)?.name
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' ||
          name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        // CRIT-10 (audit étape 8) — BUG 44 partiel : sur Capacitor natif il
        // n'y a pas de "paramètres du navigateur" visibles. Le message
        // doit pointer vers Paramètres Android → Apps → Arty → Autorisations.
        setAudioError(isNative ? t('chat.input.voice.micDeniedNative') : t('chat.input.voice.micDenied'))
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
        if (!transcription) return

        // V2 — Whisper always auto-sends (WhatsApp-style). If streaming blocks
        // sendText we fall back to the textarea so the transcription isn't lost.
        const draft = textRef.current.trim()
        const combined = draft ? draft + ' ' + transcription : transcription
        const sent = sendText(combined, filesRef.current)
        if (!sent) {
          setText((prev) => (prev ? prev + ' ' : '') + transcription)
        }
      } catch (err) {
        console.warn('Whisper transcription failed:', err)
        // Surface the real error from OpenAI / proxy (insufficient_quota,
        // model not found, email not whitelisted…) instead of the generic
        // "transcription échouée" so the user can act on it.
        const detail = err instanceof Error && err.message ? err.message : ''
        setAudioError(detail || t('chat.input.voice.transcribeFailed'))
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
  }, [isRecordingAudio, isListening, stopListening, t, clearRecordingTimers, hardResetRecording, sendText])

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

  // V2 pointer handlers — tap toggles webkit speech, hold ≥ 600ms records Whisper.
  const handleVoicePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    // Prevent the browser's long-press context menu and stop focus stealing.
    e.preventDefault()
    pointerIdRef.current = e.pointerId
    pointerStartXRef.current = e.clientX
    pressStartRef.current = Date.now()
    crossedThresholdRef.current = false
    wasListeningAtDownRef.current = isListening
    setIsSwipeCancelling(false)
    setAudioError(null)
    setHoldProgress(0)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}

    // Start MediaRecorder silently if Whisper is available — audio from t=0 is
    // preserved so the full utterance is captured once threshold is crossed.
    if (canUseWhisperRef.current) {
      void startAudioRecording()
    }

    // Drive the progress ring (0→1 over 600ms) + flip to "whisper" at t=threshold.
    const t0 = pressStartRef.current
    holdIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - t0
      const p = Math.min(elapsed / HOLD_THRESHOLD_MS, 1)
      setHoldProgress(p)
      if (p >= 1 && !crossedThresholdRef.current) {
        crossedThresholdRef.current = true
        clearHoldInterval()
      }
    }, 16)
  }, [isListening, startAudioRecording, clearHoldInterval])

  const handleVoicePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    // Swipe-cancel only applies once the threshold is crossed (whisper mode).
    if (!crossedThresholdRef.current) return
    const dx = e.clientX - pointerStartXRef.current
    const cancelling = dx < -SWIPE_CANCEL_THRESHOLD_PX
    setIsSwipeCancelling((prev) => (prev === cancelling ? prev : cancelling))
  }, [])

  const handleVoicePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    const heldMs = Date.now() - pressStartRef.current
    const cancelSwipe = isSwipeCancelling
    const crossed = crossedThresholdRef.current
    const wasListening = wasListeningAtDownRef.current
    pointerIdRef.current = null
    crossedThresholdRef.current = false
    clearHoldInterval()
    setHoldProgress(0)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}

    if (cancelSwipe) {
      // User slid left to abort the Whisper recording.
      stopAudioRecording(true)
      return
    }

    if (crossed && heldMs >= HOLD_THRESHOLD_MS) {
      // Long-press release → send Whisper transcription.
      stopAudioRecording(false)
      return
    }

    // Short tap — discard any audio buffered during the 0→600ms window and
    // toggle webkit speech recognition instead.
    stopAudioRecording(true)
    if (!isMicSupported) return
    if (wasListening) {
      try { stopListening() } catch {}
    } else {
      try { startListening(handleTranscript) } catch {}
    }
  }, [isSwipeCancelling, stopAudioRecording, clearHoldInterval, isMicSupported, startListening, stopListening, handleTranscript])

  const handleVoicePointerCancel = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    pointerIdRef.current = null
    crossedThresholdRef.current = false
    clearHoldInterval()
    setHoldProgress(0)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    stopAudioRecording(true)
  }, [stopAudioRecording, clearHoldInterval])

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

  // Has OpenAI key (Feature 15) — BYOK OR server proxy available (gated by
  // ALLOWED_EMAILS côté serveur). Pour les testeurs sans clé, `googleConnected`
  // suffit à révéler le bouton : le serveur rejette les non-whitelistés.
  const [hasOpenAI, setHasOpenAI] = useState(false)
  useEffect(() => {
    import('../../services/activeApiKey').then((m) => {
      setHasOpenAI(m.hasOpenAIKey())
    })
  }, [])
  const canUseWhisper = hasOpenAI || googleConnected
  // Ref'd for handleVoicePointerDown — avoids re-creating the callback whenever
  // the gate flips (e.g. when Google storage finally decrypts after mount).
  const canUseWhisperRef = useRef(canUseWhisper)
  useEffect(() => { canUseWhisperRef.current = canUseWhisper }, [canUseWhisper])

  // Prompt enhancement (1.0.14) — ✨ button reformulates the prompt via Haiku/Mistral
  const [enhanceEnabled, setEnhanceEnabled] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)
  useEffect(() => {
    setEnhanceEnabled(isPromptEnhancementEnabled() && canEnhancePrompt())
  }, [])

  const handleEnhance = async () => {
    const current = text.trim()
    if (!current || isEnhancing) return
    setIsEnhancing(true)
    setEnhanceError(null)
    try {
      const enhanced = await enhancePrompt(current)
      setText(enhanced)
    } catch (err) {
      setEnhanceError(err instanceof Error ? err.message : t('errors.promptEnhancementFailed'))
    } finally {
      setIsEnhancing(false)
    }
  }

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

      {/* Prompt enhancement error (1.0.14) */}
      {enhanceError && (
        <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          <span>⚠️</span>
          <span className="flex-1 truncate">{enhanceError}</span>
          <button
            onClick={() => setEnhanceError(null)}
            className="text-red-500 hover:text-red-700"
            aria-label="Fermer"
          >
            ✕
          </button>
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

      {/* URL hint banner — Mistral ne peut pas lire les URLs (pas de tool
          web_fetch natif). Affiché en mode EU-only quand une URL est
          détectée dans la draft. Les conversations non-EU sont auto-routées
          vers Claude (web_fetch) dans aiRouter.detectProvider(). */}
      {euOnly && hasUrl(text) && (
        <div className="mb-2 flex items-start gap-2 px-3 py-2 bg-theme-accent/10 border border-theme-accent/20 rounded-xl text-xs text-theme-ink">
          <span className="mt-0.5">💡</span>
          <span className="flex-1">
            Mistral ne peut pas ouvrir les liens (mode EU). Pour analyser le contenu, colle directement le texte de l'article ou de la vidéo ici.
          </span>
        </div>
      )}

      {/* File previews */}
      {files.length > 0 && (
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          {files.map((file, i) => (
            // MED (audit étape 8) — key stable basée sur (name + size + index).
            // Avant : key={i} sur une liste mutable (removeFile). Si l'user
            // supprime un fichier au milieu, React recycle le DOM node — le
            // blob URL du preview pointait vers le mauvais fichier.
            <PendingFilePreview
              key={`${file.name}-${file.size ?? 0}-${i}`}
              file={file}
              onRemove={() => removeFile(i)}
            />
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

      <div className="relative flex items-end gap-1.5 bg-theme-surface rounded-2xl border border-theme-border px-3 py-2 shadow-sm">
        {/* + menu — file upload + native camera/scan + web camera (mobile). */}
        <AttachMenu
          open={showAttachMenu}
          onOpenChange={setShowAttachMenu}
          onPickFile={() => fileInputRef.current?.click()}
          onPickCamera={isNative ? handleCamera : (showWebCamera ? handleWebCamera : undefined)}
          onPickScan={isNative ? handleScan : undefined}
          ariaLabel={t('chat.input.aria.attachMenu')}
          labels={{
            file: t('chat.input.menu.file'),
            photo: t('chat.input.menu.photo'),
            scan: t('chat.input.menu.scan'),
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.md,.json,.xml,.doc,.docx,.xls,.xlsx"
          multiple
          className="hidden"
        />
        {showWebCamera && (
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleWebCameraChange}
            className="hidden"
          />
        )}

        {/* Textarea or voice wave — voice modes replace the textarea. */}
        {(isListening || isRecordingAudio) ? (
          <div className="flex-1 flex items-center px-1 py-1.5 min-h-[36px]">
            <VoiceWave tone={isRecordingAudio ? 'danger' : 'accent'} />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.input.placeholder')}
            rows={1}
            disabled={isStreaming}
            className={`flex-1 resize-none bg-transparent text-sm text-theme-ink placeholder:text-theme-muted/60 focus:outline-none py-1.5 font-sans font-light leading-relaxed ${isStreaming ? 'opacity-50 italic' : ''}`}
          />
        )}

        {/* Prompt enhancement (1.0.14) — ✨ reformulates the prompt via Haiku/Mistral */}
        {enhanceEnabled && (
          <button
            onClick={handleEnhance}
            disabled={!text.trim() || isEnhancing}
            className={`relative flex-shrink-0 p-1.5 rounded-full transition-colors mb-0.5 ${
              isEnhancing
                ? 'bg-theme-accent/20 text-theme-accent'
                : 'hover:bg-theme-ink/5 text-theme-muted disabled:opacity-30'
            }`}
            aria-label={t('chat.input.aria.enhance')}
            title={isEnhancing ? t('chat.input.enhancing') : t('chat.input.enhanceTooltip')}
          >
            {isEnhancing ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="animate-spin">
                <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="10 30" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M9 2.5L10.2 6.3L14 7.5L10.2 8.7L9 12.5L7.8 8.7L4 7.5L7.8 6.3L9 2.5Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
                <path d="M13.5 12.5L14 14L15.5 14.5L14 15L13.5 16.5L13 15L11.5 14.5L13 14L13.5 12.5Z" fill="currentColor" />
              </svg>
            )}
          </button>
        )}

        {/* Whisper audio recording (Feature 15) — if OpenAI key is available */}
        {hasOpenAI && (
          <button
            onClick={isRecordingAudio ? () => stopAudioRecording() : startAudioRecording}
            className={`relative flex-shrink-0 p-1.5 rounded-full transition-colors mb-0.5 ${
              isRecordingAudio
                ? 'bg-red-100 text-red-500 hover:bg-red-200'
                : 'hover:bg-theme-ink/5 text-theme-muted'
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

        {/* Morphing CTA — Stop (streaming) / Send (text) / Voice (idle). */}
        {isStreaming ? (
          <button
            onClick={onStop}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-theme-ink text-theme-bg flex items-center justify-center hover:opacity-90 transition-opacity mb-0.5"
            aria-label={t('chat.input.aria.stop')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" />
            </svg>
          </button>
        ) : (text.trim() || files.length > 0) ? (
          <button
            onClick={handleSend}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-theme-accent text-theme-bg flex items-center justify-center hover:opacity-90 transition-opacity mb-0.5 shadow-sm"
            aria-label={t('chat.input.aria.send')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 12V2M7 2L3 6M7 2L11 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (canUseWhisper || isMicSupported) ? (
          <VoiceButton
            onPointerDown={handleVoicePointerDown}
            onPointerMove={handleVoicePointerMove}
            onPointerUp={handleVoicePointerUp}
            onPointerCancel={handleVoicePointerCancel}
            isListening={isListening}
            isRecordingAudio={isRecordingAudio}
            isSwipeCancelling={isSwipeCancelling}
            isTranscribing={isTranscribing}
            crossedThreshold={crossedThresholdRef.current}
            holdProgress={holdProgress}
            ariaLabel={t('chat.input.aria.holdToRecord')}
          />
        ) : null}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface AttachMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPickFile: () => void
  onPickCamera?: () => void
  onPickScan?: () => void
  ariaLabel: string
  labels: { file: string; photo: string; scan: string }
}

function AttachMenu({ open, onOpenChange, onPickFile, onPickCamera, onPickScan, ariaLabel, labels }: AttachMenuProps) {
  const hasMulti = !!(onPickCamera || onPickScan)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open, onOpenChange])

  const handlePrimaryClick = () => {
    if (!hasMulti) onPickFile()
    else onOpenChange(!open)
  }

  return (
    <div ref={containerRef} className="relative flex-shrink-0 mb-0.5">
      <button
        type="button"
        onClick={handlePrimaryClick}
        className="p-1.5 rounded-full hover:bg-theme-ink/5 transition-colors text-theme-muted"
        aria-label={hasMulti ? ariaLabel : labels.file}
        aria-expanded={hasMulti ? open : undefined}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <line x1="9" y1="3" x2="9" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {hasMulti && open && (
        <div className="absolute bottom-full left-0 mb-2 bg-theme-surface rounded-xl border border-theme-border shadow-lg overflow-hidden z-30 animate-fade-in min-w-[160px]">
          <MenuItem
            onClick={() => { onOpenChange(false); onPickFile() }}
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M13 5v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h4l4 4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            }
            label={labels.file}
          />
          {onPickCamera && (
            <MenuItem
              onClick={() => { onOpenChange(false); onPickCamera() }}
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="4" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="8" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M5 4l1-2h4l1 2" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
              }
              label={labels.photo}
            />
          )}
          {onPickScan && (
            <MenuItem
              onClick={() => { onOpenChange(false); onPickScan() }}
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                  <line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <line x1="5" y1="11" x2="9" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              }
              label={labels.scan}
            />
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs text-theme-ink hover:bg-theme-ink/5 transition-colors"
    >
      <span className="text-theme-muted">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

// VoiceWave — 9 animated bars used as textarea replacement while listening or
// recording. Colour tones track the mode (accent = webkit, danger = Whisper).
function VoiceWave({ tone, n = 9 }: { tone: 'accent' | 'danger'; n?: number }) {
  const colour = tone === 'danger' ? 'rgb(224 75 46)' : 'rgb(var(--theme-accent))'
  return (
    <div className="flex items-center gap-[3px] h-5" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          className="w-[3px] h-full rounded-sm origin-bottom"
          style={{
            background: colour,
            animation: `wave ${0.75 + i * 0.05}s ease-in-out ${i * 0.06}s infinite alternate`,
          }}
        />
      ))}
    </div>
  )
}

// Morphing voice CTA — idle / listening (webkit) / hold-progress / whisper.
interface VoiceButtonProps {
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => void
  isListening: boolean
  isRecordingAudio: boolean
  isSwipeCancelling: boolean
  isTranscribing: boolean
  crossedThreshold: boolean
  holdProgress: number
  ariaLabel: string
}

function VoiceButton({
  onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
  isListening, isRecordingAudio, isSwipeCancelling, isTranscribing,
  crossedThreshold, holdProgress, ariaLabel,
}: VoiceButtonProps) {
  // Size morph: 40px idle, 48px active (listening or whisper).
  const active = isListening || isRecordingAudio
  const size = active ? 48 : 40
  const showRing = holdProgress > 0 && holdProgress < 1 && !crossedThreshold
  const circumference = 2 * Math.PI * 18 // r=18

  let bgClass: string
  let pulseClass = ''
  if (isSwipeCancelling) {
    bgClass = 'bg-red-500 text-white'
  } else if (isRecordingAudio) {
    bgClass = 'bg-gradient-to-br from-red-500 to-red-700 text-white'
    pulseClass = 'animate-pulse-ring-danger'
  } else if (isListening) {
    bgClass = 'bg-gradient-to-br from-theme-accent to-orange-700 text-white'
    pulseClass = 'animate-pulse-ring-accent'
  } else {
    bgClass = 'bg-theme-accent/15 text-theme-muted hover:bg-theme-accent/25'
  }

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: size,
        height: size,
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        transition: 'width 0.25s cubic-bezier(0.34,1.56,0.64,1), height 0.25s cubic-bezier(0.34,1.56,0.64,1)',
      }}
      className={`relative flex-shrink-0 rounded-full flex items-center justify-center mb-0.5 ${bgClass} ${pulseClass}`}
      aria-label={ariaLabel}
      disabled={isTranscribing}
    >
      {/* Hold-progress ring — fills 0→1 during 0-600ms hold. */}
      {showRing && (
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{ transform: 'rotate(-90deg)' }}
          width={size}
          height={size}
          viewBox="0 0 40 40"
        >
          <circle
            cx="20"
            cy="20"
            r="18"
            fill="none"
            stroke="rgb(224 75 46)"
            strokeWidth="3"
            strokeDasharray={`${holdProgress * circumference} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
      )}
      {/* Icon: "W" during Whisper, mic otherwise. */}
      {isRecordingAudio ? (
        <span className="font-display italic font-semibold text-lg leading-none">W</span>
      ) : (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="6.5" y="2" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4 9C4 11.76 6.24 14 9 14C11.76 14 14 11.76 14 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="9" y1="14" x2="9" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
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
