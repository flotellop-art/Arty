import { useState, useRef, useCallback, useEffect } from 'react'

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

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const wantListeningRef = useRef(false)
  const onTranscriptRef = useRef<((text: string) => void) | null>(null)

  const isSupported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const createRecognition = useCallback(() => {
    if (!isSupported) return null

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()

    // Use continuous mode — one single start() call, one single beep
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'fr-FR'

    recognition.onstart = () => {
      setIsListening(true)
      setError(null)
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result || !result[0]) continue

        if (result.isFinal) {
          // Send final text immediately to the callback
          const text = result[0].transcript.trim()
          if (text && onTranscriptRef.current) {
            onTranscriptRef.current(text)
          }
          setInterimTranscript('')
        } else {
          setInterimTranscript(result[0].transcript)
        }
      }
    }

    recognition.onerror = (event) => {
      const err = event.error
      if (err === 'aborted') return

      if (err === 'not-allowed') {
        setError('Micro refusé — autorise le micro dans les paramètres du navigateur')
        wantListeningRef.current = false
      } else if (err === 'no-speech') {
        // Normal — user paused, will auto-restart via onend
      } else if (err === 'network') {
        setError('Erreur réseau — vérifie ta connexion')
        wantListeningRef.current = false
      } else {
        setError(`Erreur micro: ${err}`)
        wantListeningRef.current = false
      }
    }

    recognition.onend = () => {
      wantListeningRef.current = false
      setIsListening(false)
      setInterimTranscript('')
    }

    return recognition
  }, [isSupported])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wantListeningRef.current = false
      if (recognitionRef.current) {
        recognitionRef.current.abort()
      }
    }
  }, [])

  const startListening = useCallback((onTranscript: (text: string) => void) => {
    if (!isSupported) {
      setError('Reconnaissance vocale non supportée sur ce navigateur')
      return
    }

    setError(null)
    wantListeningRef.current = true
    onTranscriptRef.current = onTranscript

    const recognition = createRecognition()
    if (!recognition) return

    // Stop any existing recognition
    if (recognitionRef.current) {
      recognitionRef.current.abort()
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch (e) {
      // Already started or other error
      setError('Impossible de démarrer le micro')
      wantListeningRef.current = false
    }
  }, [isSupported, createRecognition])

  const stopListening = useCallback(() => {
    wantListeningRef.current = false
    onTranscriptRef.current = null
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    setInterimTranscript('')
  }, [])

  return {
    isListening,
    interimTranscript,
    error,
    isSupported,
    startListening,
    stopListening,
  }
}
