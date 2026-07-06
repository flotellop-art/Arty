// Modale qui apparaît quand un user free clique un modèle payant (Sonnet,
// Opus, Gemini, GPT). Explique la limite et propose un CTA "Voir les plans".

import { memo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import { canPurchase } from '../../services/checkout'

interface UpgradePromptModalProps {
  modelLabel: string
  onClose: () => void
}

export const UpgradePromptModal = memo(function UpgradePromptModal({
  modelLabel,
  onClose,
}: UpgradePromptModalProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  // H-UX-7 (audit étape 10) — Escape ferme la modale.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleUpgrade = () => {
    onClose()
    navigate('/upgrade')
  }

  // Play Store — sur natif, pas d'incitation à l'achat : on oriente vers
  // BYOK (gratuit côté Arty, l'utilisateur paie son provider directement).
  const handleByok = () => {
    onClose()
    window.dispatchEvent(new CustomEvent('arty-open-api-keys'))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-modal-title"
        className="bg-theme-bg border border-theme-border rounded-2xl shadow-xl max-w-sm w-[90%] mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl" aria-hidden="true">🔒</span>
          <h3 id="upgrade-modal-title" className="font-display text-xl text-theme-ink">
            {t('chat.upgradeModal.title', { model: modelLabel })}
          </h3>
        </div>
        <p className="text-sm text-theme-muted mb-5 leading-relaxed">
          <Trans
            i18nKey={canPurchase ? 'chat.upgradeModal.body' : 'chat.upgradeModal.bodyNative'}
            components={{ 0: <strong className="text-theme-ink" />, 1: <strong className="text-theme-ink" /> }}
          />
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-sans uppercase tracking-kicker text-theme-muted hover:text-theme-ink transition-colors"
          >
            {t('chat.upgradeModal.later')}
          </button>
          <button
            onClick={canPurchase ? handleUpgrade : handleByok}
            className="px-4 py-1.5 text-xs font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg hover:opacity-90 rounded-md transition-opacity"
          >
            {canPurchase ? t('chat.upgradeModal.seePlans') : t('chat.upgradeModal.useByok')}
          </button>
        </div>
      </div>
    </div>
  )
})
