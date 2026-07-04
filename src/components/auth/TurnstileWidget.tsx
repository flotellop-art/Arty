import { useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────
// Widget Cloudflare Turnstile (C2/F-10) — anti-bot sur l'envoi d'OTP email.
// Charge le script CF une seule fois, rend le widget en mode explicite, et
// remonte le token via `onToken`. Le token est SINGLE-USE (consommé par
// siteverify côté serveur) → le parent incrémente `resetSignal` après chaque
// envoi pour forcer un nouveau challenge (utile au « Renvoyer le code »).
// Dégradation : si le script échoue, `onError` est appelé (le parent peut
// décider de laisser passer si aucune secret n'est configurée).
// ─────────────────────────────────────────────────────────────

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
      appearance?: 'always' | 'execute' | 'interaction-only'
      theme?: 'auto' | 'light' | 'dark'
    },
  ) => string
  reset: (widgetId?: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    let settled = false
    // Garde-fou : une WebView restreinte peut ne renvoyer NI onload NI onerror
    // (script qui pend) → sans timeout, le parent resterait bloqué à vie.
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      scriptPromise = null
      reject(new Error('turnstile script timeout'))
    }, 10_000)
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    s.onload = () => finish(resolve)
    s.onerror = () => {
      scriptPromise = null // autoriser un retry au prochain montage
      finish(() => reject(new Error('turnstile script load failed')))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

interface TurnstileWidgetProps {
  siteKey: string
  onToken: (token: string) => void
  onError?: () => void
  /** Change de valeur → reset du widget (nouveau token single-use). */
  resetSignal?: number
}

export function TurnstileWidget({ siteKey, onToken, onError, resetSignal = 0 }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  // Callbacks en ref → l'effet de montage ne dépend que de siteKey (pas de
  // remount à chaque render du parent qui passe des closures inline).
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          appearance: 'interaction-only', // invisible sauf si un défi est requis
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => {
            onTokenRef.current('')
            onErrorRef.current?.()
          },
        })
      })
      .catch(() => onErrorRef.current?.())
    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          /* déjà retiré */
        }
        widgetIdRef.current = null
      }
    }
  }, [siteKey])

  // Reset explicite (token consommé) → nouveau challenge.
  useEffect(() => {
    if (resetSignal === 0) return
    if (widgetIdRef.current && window.turnstile) {
      onTokenRef.current('')
      try {
        window.turnstile.reset(widgetIdRef.current)
      } catch {
        /* widget non prêt */
      }
    }
  }, [resetSignal])

  return <div ref={containerRef} className="flex justify-center min-h-[1px]" />
}
