// Modale qui apparaît quand un user free clique un modèle payant (Sonnet,
// Opus, Gemini, GPT). Explique la limite et propose un CTA "Voir les plans".

import { memo } from 'react'
import { useNavigate } from 'react-router-dom'

interface UpgradePromptModalProps {
  modelLabel: string
  onClose: () => void
}

export const UpgradePromptModal = memo(function UpgradePromptModal({
  modelLabel,
  onClose,
}: UpgradePromptModalProps) {
  const navigate = useNavigate()

  const handleUpgrade = () => {
    onClose()
    navigate('/upgrade')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-theme-bg border border-theme-border rounded-2xl shadow-xl max-w-sm w-[90%] mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">🔒</span>
          <h3 className="font-display text-xl text-theme-ink">{modelLabel} réservé aux Pro</h3>
        </div>
        <p className="text-sm text-theme-muted mb-5 leading-relaxed">
          En gratuit tu as accès à <strong className="text-theme-ink">Claude Haiku (10/jour)</strong> et <strong className="text-theme-ink">Mistral (5/jour)</strong>.
          Pour débloquer Sonnet, Opus, Gemini Pro et GPT, passe à Pro.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-sans uppercase tracking-kicker text-theme-muted hover:text-theme-ink transition-colors"
          >
            Plus tard
          </button>
          <button
            onClick={handleUpgrade}
            className="px-4 py-1.5 text-xs font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg hover:opacity-90 rounded-md transition-opacity"
          >
            Voir les plans
          </button>
        </div>
      </div>
    </div>
  )
})
