import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CONTEXT_COMPRESSED_EVENT } from '../../services/conversationCompressor'

// Bannière discrète affichée quand le contexte d'une conversation vient d'être
// résumé (compression à 80k tokens). Avant P1.7 cette compression était
// SILENCIEUSE — l'utilisateur ne savait pas que le début de sa conversation
// avait été condensé (violation du principe « jamais de bascule cachée »).
// Le bouton « nouvelle conversation » est le garde-fou : repartir propre =
// réponses plus nettes ET moins de crédits consommés (le résumé est rejoué à
// chaque message tant qu'on reste dans la même conversation).
interface ContextCompressedBannerProps {
  onNewConversation?: () => void
}

export function ContextCompressedBanner({ onNewConversation }: ContextCompressedBannerProps) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onCompressed = () => setVisible(true)
    window.addEventListener(CONTEXT_COMPRESSED_EVENT, onCompressed)
    return () => window.removeEventListener(CONTEXT_COMPRESSED_EVENT, onCompressed)
  }, [])

  if (!visible) return null

  return (
    <div
      role="status"
      className="mx-4 mb-2 px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2"
    >
      <span className="flex-1 min-w-0">{t('chat.contextCompressed.message')}</span>
      {onNewConversation && (
        <button
          onClick={onNewConversation}
          className="flex-shrink-0 px-2.5 py-1 rounded-md border border-amber-500/40 font-medium hover:bg-amber-500/10 transition-colors"
        >
          {t('chat.contextCompressed.newConv')}
        </button>
      )}
      <button
        onClick={() => setVisible(false)}
        className="flex-shrink-0 p-1.5 rounded-md hover:bg-amber-500/10 transition-colors"
        aria-label={t('common.close')}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
