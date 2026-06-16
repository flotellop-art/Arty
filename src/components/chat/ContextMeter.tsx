import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '../../types'
import {
  estimateMessagesTokens,
  COMPRESSION_THRESHOLD,
  CONTEXT_COMPRESSED_EVENT,
} from '../../services/conversationCompressor'

// Seuils d'affichage, en fraction du point d'auto-résumé (COMPRESSION_THRESHOLD).
// Sous WARN : rien (zéro bruit sur les conversations normales).
const CONTEXT_WARN = 0.6 // barre ambre — simple prise de conscience, pas de CTA
const CONTEXT_HIGH = 0.8 // barre rouge + invite à repartir AVANT l'auto-résumé (lossy)

export type ContextBand = 'hidden' | 'warn' | 'high'

/** Mappe un ratio de remplissage [0..1] vers une bande d'affichage. Pur = testable. */
export function contextBand(ratio: number): ContextBand {
  if (ratio >= CONTEXT_HIGH) return 'high'
  if (ratio >= CONTEXT_WARN) return 'warn'
  return 'hidden'
}

interface ContextMeterProps {
  messages: Message[]
  onNewConversation?: () => void
}

/**
 * Jauge de contexte + invite à repartir propre (P3).
 *
 * Mesure `estimateMessagesTokens(messages) / COMPRESSION_THRESHOLD` — soit
 * EXACTEMENT la quantité qui déclenche l'auto-résumé dans `compressIfNeeded`
 * (mêmes messages texte). C'est donc un « % avant auto-résumé » fidèle, pas un
 * chiffre fantaisiste. (Les fichiers/base64 vivent dans `Message.files`, hors
 * `content`, et ne sont pas re-envoyés d'un tour à l'autre — cohérent de ne pas
 * les compter ici, comme le compresseur.)
 *
 * Se cache dès qu'une compression a eu lieu (CONTEXT_COMPRESSED_EVENT) : la
 * `ContextCompressedBanner` prend alors le relais → un seul CTA « nouvelle
 * conversation » visible à la fois (pas de doublon, cf. revue P3).
 */
export function ContextMeter({ messages, onNewConversation }: ContextMeterProps) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)
  const [compressed, setCompressed] = useState(false)

  useEffect(() => {
    const onCompressed = () => setCompressed(true)
    window.addEventListener(CONTEXT_COMPRESSED_EVENT, onCompressed)
    return () => window.removeEventListener(CONTEXT_COMPRESSED_EVENT, onCompressed)
  }, [])

  // O(nombre de messages) — `content.length` est O(1) ; recalcul per-token
  // pendant le stream négligeable.
  const ratio = useMemo(
    () => Math.min(estimateMessagesTokens(messages) / COMPRESSION_THRESHOLD, 1),
    [messages],
  )
  const band = contextBand(ratio)

  if (compressed || dismissed || band === 'hidden') return null

  const pct = Math.round(ratio * 100)
  const isHigh = band === 'high'
  const tone = isHigh
    ? 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400'
    : 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
  const barColor = isHigh ? 'bg-red-500/60' : 'bg-amber-500/60'
  const hover = isHigh ? 'hover:bg-red-500/10' : 'hover:bg-amber-500/10'

  return (
    <div className={`mx-4 mb-2 px-4 py-2 border rounded-xl text-sm flex items-center gap-3 ${tone}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0">{t('chat.contextMeter.label')}</span>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('chat.contextMeter.aria')}
            className="flex-1 h-1.5 rounded-full bg-theme-ink/10 overflow-hidden"
          >
            <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="flex-shrink-0 tabular-nums">{pct}%</span>
        </div>
        {isHigh && <div className="mt-1 text-xs opacity-90">{t('chat.contextMeter.nudge')}</div>}
      </div>
      {isHigh && onNewConversation && (
        <button
          onClick={onNewConversation}
          className={`flex-shrink-0 px-2.5 py-1 rounded-md border border-current/40 font-medium ${hover} transition-colors`}
        >
          {t('chat.contextMeter.newConv')}
        </button>
      )}
      {isHigh && (
        <button
          onClick={() => setDismissed(true)}
          className={`flex-shrink-0 p-1.5 rounded-md ${hover} transition-colors`}
          aria-label={t('common.close')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
