import { useState, useRef, useCallback, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import i18n from '../i18n'

// Web Speech API types
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionResultList {
  length: number
  [index: number]: SpeechRecognitionResult | undefined
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternative | undefined
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives?: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance
    webkitSpeechRecognition: new () => SpeechRecognitionInstance
  }
}

// ─── Platform detection ───
const isIOS = typeof navigator !== 'undefined' &&
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream
const isSafari = typeof navigator !== 'undefined' &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
// iOS/Safari doesn't reliably support continuous mode
const useSingleShot = isIOS || isSafari

// ─── Language mapping from i18n ───
function getSpeechLang(): string {
  const lng = (i18n.resolvedLanguage || i18n.language || 'fr').slice(0, 2)
  switch (lng) {
    case 'fr': return 'fr-FR'
    case 'en': return 'en-US'
    case 'es': return 'es-ES'
    case 'de': return 'de-DE'
    case 'it': return 'it-IT'
    case 'pt': return 'pt-PT'
    default: return 'fr-FR'
  }
}

// Confidence threshold: ignore noisy interim results below this
const MIN_CONFIDENCE = 0.5
// Keep-alive ping — restart recognition every 8s to prevent unexpected stops
const KEEP_ALIVE_MS = 8000
// Max automatic retries on unexpected errors
const MAX_RETRIES = 3

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const wantListeningRef = useRef(false)
  const onTranscriptRef = useRef<((text: string) => void) | null>(null)
  const processedCountRef = useRef(0)
  const retryCountRef = useRef(0)
  const keepAliveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFinalTextRef = useRef<string>('')

  const isSupported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  // ─── Helpers ───
  const clearKeepAlive = useCallback(() => {
    if (keepAliveTimerRef.current) {
      clearTimeout(keepAliveTimerRef.current)
      keepAliveTimerRef.current = null
    }
  }, [])

  // Forward declaration workaround — keepAlive / restart need createRecognition
  const createRecognitionRef = useRef<(() => SpeechRecognitionInstance | null) | null>(null)

  const scheduleKeepAlive = useCallback(() => {
    clearKeepAlive()
    if (useSingleShot) return // iOS/Safari: no keep-alive (single-shot mode)
    keepAliveTimerRef.current = setTimeout(() => {
      // Force a restart to keep recognition alive in continuous mode
      const rec = recognitionRef.current
      if (rec && wantListeningRef.current) {
        try {
          rec.stop() // onend will restart it
        } catch {
          // Already stopped
        }
      }
    }, KEEP_ALIVE_MS)
  }, [clearKeepAlive])

  const createRecognition = useCallback((): SpeechRecognitionInstance | null => {
    if (!isSupported) return null

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()

    // iOS/Safari: single-shot (continuous=false); everywhere else: continuous
    recognition.continuous = !useSingleShot
    recognition.interimResults = true
    recognition.lang = getSpeechLang()
    if ('maxAlternatives' in recognition) {
      recognition.maxAlternatives = 1
    }

    recognition.onstart = () => {
      setIsListening(true)
      setError(null)
      processedCountRef.current = 0
      scheduleKeepAlive()
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let latestInterim = ''

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result || !result[0]) continue

        const alt = result[0]
        const confidence = alt.confidence ?? 1

        if (result.isFinal) {
          // Only send finals we haven't sent yet (dedup protection)
          if (i >= processedCountRef.current) {
            const text = alt.transcript.trim()
            // Skip exact duplicate of the previous final (double-dispatch bug)
            if (text && text !== lastFinalTextRef.current && onTranscriptRef.current) {
              lastFinalTextRef.current = text
              onTranscriptRef.current(text)
            }
            processedCountRef.current = i + 1
          }
        } else {
          // Noise gate: ignore low-confidence interim results
          if (confidence === 0 || confidence >= MIN_CONFIDENCE) {
            latestInterim = alt.transcript
          }
        }
      }

      setInterimTranscript(latestInterim)

      // Reset keep-alive timer — fresh activity detected
      scheduleKeepAlive()

      // iOS/Safari single-shot: when we get a final, the recognition stops —
      // we rely on onend to re-trigger if wantListeningRef is still true
    }

    recognition.onerror = (event) => {
      const err = event.error
      if (err === 'aborted') return

      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setError(
          Capacitor.isNativePlatform()
            ? 'Micro refusé — Paramètres Android → Apps → Arty → Autorisations → Micro'
            : 'Micro refusé — autorise le micro dans les paramètres du navigateur'
        )
        wantListeningRef.current = false
        retryCountRef.current = 0
      } else if (err === 'no-speech') {
        // Normal — user paused; onend will auto-restart
      } else if (err === 'audio-capture') {
        setError('Aucun micro détecté — vérifie ton matériel')
        wantListeningRef.current = false
        retryCountRef.current = 0
      } else if (err === 'network') {
        // Retry with exponential backoff
        if (retryCountRef.current >= MAX_RETRIES) {
          setError('Erreur réseau — vérifie ta connexion')
          wantListeningRef.current = false
          retryCountRef.current = 0
        }
        // Otherwise onend will handle the retry
      } else {
        if (retryCountRef.current >= MAX_RETRIES) {
          setError(`Erreur micro: ${err}`)
          wantListeningRef.current = false
          retryCountRef.current = 0
        }
      }
    }

    recognition.onend = () => {
      clearKeepAlive()
      setInterimTranscript('')

      // If the user still wants to listen, auto-restart (handles unexpected stops)
      if (wantListeningRef.current) {
        if (retryCountRef.current >= MAX_RETRIES) {
          wantListeningRef.current = false
          setIsListening(false)
          retryCountRef.current = 0
          return
        }

        retryCountRef.current++

        // Exponential backoff: 100ms, 200ms, 400ms (fast because single-shot needs fast re-trigger)
        const backoff = Math.min(100 * Math.pow(2, retryCountRef.current - 1), 1000)

        setTimeout(() => {
          if (!wantListeningRef.current) {
            setIsListening(false)
            return
          }

          // Build a fresh recognition instance — reusing a stopped one is unreliable
          const factory = createRecognitionRef.current
          if (!factory) {
            setIsListening(false)
            return
          }
          const next = factory()
          if (!next) {
            setIsListening(false)
            return
          }
          recognitionRef.current = next
          try {
            next.start()
            // Successful restart — reset retry count after a short delay
            setTimeout(() => { retryCountRef.current = 0 }, 1000)
          } catch {
            // Start failed — another restart attempt will be scheduled via onend
          }
        }, backoff)
      } else {
        setIsListening(false)
        retryCountRef.current = 0
      }
    }

    return recognition
  }, [isSupported, clearKeepAlive, scheduleKeepAlive])

  // Keep the ref in sync so onend can call the latest factory
  useEffect(() => {
    createRecognitionRef.current = createRecognition
  }, [createRecognition])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wantListeningRef.current = false
      clearKeepAlive()
      if (recognitionRef.current) {
        try { recognitionRef.current.abort() } catch {}
      }
    }
  }, [clearKeepAlive])

  const startListening = useCallback((onTranscript: (text: string) => void) => {
    if (!isSupported) {
      setError('Reconnaissance vocale non supportée sur ce navigateur. Utilisez Chrome ou Edge.')
      return
    }

    setError(null)
    wantListeningRef.current = true
    onTranscriptRef.current = onTranscript
    retryCountRef.current = 0
    lastFinalTextRef.current = ''

    // Stop any existing recognition cleanly
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch {}
    }

    const recognition = createRecognition()
    if (!recognition) return

    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch {
      // Already started or blocked — report error
      setError('Impossible de démarrer le micro')
      wantListeningRef.current = false
    }
  }, [isSupported, createRecognition])

  const stopListening = useCallback(() => {
    wantListeningRef.current = false
    onTranscriptRef.current = null
    clearKeepAlive()
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
    setInterimTranscript('')
  }, [clearKeepAlive])

  return {
    isListening,
    interimTranscript,
    error,
    isSupported,
    startListening,
    stopListening,
  }
}
