import { memo, useCallback, useRef, useId, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AssistantAvatar } from './AssistantAvatar'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'
import { FactCheckBadge } from './FactCheckBadge'
import type { FactCheckResult } from '../../types'
import { speak, cancel as cancelTts, getSpeakingId, onSpeakingChange, isTtsSupported } from '../../utils/tts'

interface AssistantBubbleProps {
  content: string
  onAction?: (action: string, params: Record<string, string>) => void
  pinned?: boolean
  onTogglePin?: () => void
  interrupted?: boolean
  onRetry?: () => void
  factCheck?: FactCheckResult
  /** Bulle live pendant le stream : masque les actions (copier une réponse
      à mi-stream copie un fragment, TTS lirait un texte incomplet). */
  isStreaming?: boolean
  /** Dernière réponse assistant de la conversation : seule à exposer
      « Régénérer » (pattern claude.ai/ChatGPT — P0.4 du plan d'action). */
  isLast?: boolean
}

export const AssistantBubble = memo(function AssistantBubble({ content, onAction, pinned, onTogglePin, interrupted, onRetry, factCheck, isStreaming, isLast }: AssistantBubbleProps) {
  const { t } = useTranslation()
  const bubbleRef = useRef<HTMLDivElement>(null)

  // Roadmap Phase 2 A — mode voix bidirectionnel. Bouton 🔊 sur chaque bulle
  // assistant qui lit la réponse à voix haute via Web Speech API
  // (SpeechSynthesisUtterance). Marche sur web + Capacitor WebView qui
  // délègue au TTS natif de l'OS. Idéal mains-libres (conduite, cuisine,
  // sport, malvoyants, lecture longue).
  const ttsId = useId()
  const [isSpeaking, setIsSpeaking] = useState(() => getSpeakingId() === ttsId)

  useEffect(() => {
    return onSpeakingChange((id) => setIsSpeaking(id === ttsId))
  }, [ttsId])

  // Annule la lecture si la bulle est démontée (changement de conversation,
  // suppression, etc.). Sinon la synthèse continue tourner en background.
  useEffect(() => () => {
    if (getSpeakingId() === ttsId) cancelTts()
  }, [ttsId])

  const toggleSpeak = useCallback(() => {
    if (isSpeaking) cancelTts()
    else speak(content, ttsId)
  }, [content, isSpeaking, ttsId])

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const btn = target.closest('[data-action]') as HTMLElement
    if (!btn || !onAction) return

    e.preventDefault()
    const action = btn.dataset.action || ''
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(btn.dataset)) {
      if (key !== 'action') params[key] = value || ''
    }

    // Visual feedback
    if (action === 'reply') {
      btn.style.opacity = '0.5'
      btn.style.pointerEvents = 'none'
    } else {
      btn.style.opacity = '0.6'
      btn.textContent = t('chat.bubble.actionPending')
      setTimeout(() => {
        btn.style.opacity = '1'
        btn.textContent = t('chat.bubble.actionDone')
      }, 2000)
    }

    onAction(action, params)
  }, [onAction, t])

  // Audit UX — bouton "copier la réponse" (action la plus fréquente d'un chat
  // IA, présente sur claude.ai/ChatGPT, absente ici jusqu'au 10 juin 2026).
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard indisponible (permissions WebView) */ }
  }, [content])

  return (
    <div className="group/bubble relative flex gap-2.5 mb-6">
      <AssistantAvatar />
      <div
        ref={bubbleRef}
        onClick={handleClick}
        className={`relative max-w-[92%] text-theme-ink leading-relaxed ${
          pinned ? 'pl-3 border-l-2 border-theme-accent' : ''
        }`}
      >
        <MarkdownRenderer content={content} />
        {pinned && (
          <span className="absolute -top-2 -left-3 text-theme-accent text-[10px]">📌</span>
        )}
        {interrupted && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-amber-600">⚠️ {t('errors.streamInterrupted')}</span>
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-2 py-0.5 rounded-md border border-theme-border text-theme-muted hover:text-theme-accent hover:border-theme-accent transition-colors"
              >
                {t('common.retry')}
              </button>
            )}
          </div>
        )}
        {factCheck && <FactCheckBadge result={factCheck} />}
      </div>
      {/* Actions bar : copier + speak + pin. Visible à 50% opacity sur mobile,
          hover desktop (cohérent avec branche button PR 1) + focus-visible
          pour la navigation clavier. */}
      <div className="absolute bottom-1 right-1 flex items-center gap-0.5">
        {/* Régénérer proactif — distinct du bandeau `interrupted` (retry de
            récupération) : ici c'est « j'aime pas la réponse, relance ».
            Uniquement sur la dernière réponse, jamais pendant un stream. */}
        {isLast && !isStreaming && !interrupted && onRetry && (
          <button
            onClick={onRetry}
            className="opacity-50 md:opacity-0 md:group-hover/bubble:opacity-100 focus-visible:opacity-100 p-2 rounded-md text-theme-muted hover:text-theme-accent transition-all"
            aria-label={t('chat.bubble.regenerate')}
            title={t('chat.bubble.regenerate')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M13.5 8a5.5 5.5 0 11-1.61-3.89" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M13.5 1.5v3h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {content && !isStreaming && (
          <button
            onClick={handleCopy}
            className={`p-2 rounded-md transition-all ${
              copied
                ? 'text-theme-accent opacity-100'
                : 'opacity-50 md:opacity-0 md:group-hover/bubble:opacity-100 focus-visible:opacity-100 text-theme-muted hover:text-theme-accent'
            }`}
            aria-label={copied ? t('chat.bubble.copied') : t('chat.bubble.copy')}
            title={copied ? t('chat.bubble.copied') : t('chat.bubble.copy')}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M10.5 5.5V4a1.5 1.5 0 00-1.5-1.5H4A1.5 1.5 0 002.5 4v5A1.5 1.5 0 004 10.5h1.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </button>
        )}
        {isTtsSupported() && content && !isStreaming && (
          <button
            onClick={toggleSpeak}
            className={`p-2 rounded-md transition-all ${
              isSpeaking
                ? 'text-theme-accent opacity-100'
                : 'opacity-50 md:opacity-0 md:group-hover/bubble:opacity-100 focus-visible:opacity-100 text-theme-muted hover:text-theme-accent'
            }`}
            aria-label={isSpeaking ? t('chat.bubble.stopListening') : t('chat.bubble.listen')}
            aria-pressed={isSpeaking}
            title={isSpeaking ? t('chat.bubble.stopListening') : t('chat.bubble.listen')}
          >
            {isSpeaking ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="4" y="4" width="3" height="8" rx="0.5" fill="currentColor" />
                <rect x="9" y="4" width="3" height="8" rx="0.5" fill="currentColor" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 6h2l3-3v10L5 10H3V6z" fill="currentColor" />
                <path d="M11 5.5c1 1 1 4 0 5M13 4c2 2 2 6 0 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none" />
              </svg>
            )}
          </button>
        )}
        {onTogglePin && (
          <button
            onClick={onTogglePin}
            className={`p-2 rounded-md transition-all ${
              pinned
                ? 'text-theme-accent opacity-80'
                : 'opacity-50 md:opacity-0 md:group-hover/bubble:opacity-100 focus-visible:opacity-100 text-theme-muted hover:text-theme-accent'
            }`}
            aria-label={pinned ? t('chat.bubble.unpin') : t('chat.bubble.pin')}
            title={pinned ? t('chat.bubble.unpin') : t('chat.bubble.pin')}
          >
            📌
          </button>
        )}
      </div>
    </div>
  )
})
