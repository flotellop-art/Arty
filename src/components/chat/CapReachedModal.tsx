// P0.7 (plan d'action concurrentiel) — modale de CHOIX quand le cap mensuel
// premium est atteint. Remplace l'ancien redirect muet vers /upgrade : la
// plainte n°1 du marché des agrégateurs (Mammouth, Poe, Abacus) est la
// bascule/le blocage silencieux — ici l'utilisateur garde la main et le
// contexte de sa conversation.
//
// Écoute l'event window `arty-cap-reached` (dispatché par useConversation
// quand un proxy renvoie 429 premium_cap_reached). Pattern event identique
// aux `arty-open-*` d'App.tsx — pas de prop drilling.

import { memo, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { canPurchase } from '../../services/checkout'
import { setSelectedModel } from '../../services/modelSelector'
import { usePlanStatus } from '../../hooks/usePlanStatus'

const BUCKET_LABELS: Record<string, string> = {
  'claude-sonnet': 'Claude Sonnet/Opus',
  'gpt-5': 'GPT-5',
  'gemini-pro': 'Gemini Pro',
}

interface CapDetail {
  bucket?: string
  cap?: number
  // Conversation qui a déclenché le 429 — la relance ne rejoue le message
  // QUE si c'est la conversation affichée (l'event peut venir d'un stream
  // d'arrière-plan, cf. useConversation 'arty-retry-last').
  conversationId?: string
}

/** 1er du mois prochain, formaté dans la locale courante. */
function nextResetDate(locale: string): string {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return next.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
}

export const CapReachedModal = memo(function CapReachedModal() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const [detail, setDetail] = useState<CapDetail | null>(null)
  // Garde anti-lock (revue C-D) : le bouton bascule le sélecteur en direct,
  // en contournant le garde isProviderLocked du sélecteur normal. Aujourd'hui
  // le cap ne touche que le plan subscription (aucune famille verrouillée),
  // mais si ça évolue, on masque le bouton plutôt que d'envoyer vers un 403.
  const planStatus = usePlanStatus()
  const mistralLocked = planStatus.lockedFamilies.includes('mistral-medium')

  useEffect(() => {
    const onCap = (e: Event) => {
      setDetail((e as CustomEvent<CapDetail>).detail ?? {})
    }
    window.addEventListener('arty-cap-reached', onCap)
    return () => window.removeEventListener('arty-cap-reached', onCap)
  }, [])

  useEffect(() => {
    if (!detail) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetail(null)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [detail])

  if (!detail) return null

  const close = () => setDetail(null)
  const buyPack = () => {
    close()
    navigate('/upgrade?scroll=premium')
  }

  const modelLabel = (detail.bucket && BUCKET_LABELS[detail.bucket]) || t('quota.premiumModels')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cap-modal-title"
        className="bg-theme-bg border border-theme-border rounded-2xl shadow-xl max-w-sm w-[90%] mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl" aria-hidden="true">📊</span>
          <h3 id="cap-modal-title" className="font-display text-xl text-theme-ink">
            {t('quota.capReachedTitle')}
          </h3>
        </div>
        <p className="text-sm text-theme-muted mb-2 leading-relaxed">
          {detail.cap
            ? t('quota.capReachedBody', { cap: detail.cap, model: modelLabel })
            : t('quota.capReachedBodyNoCount', { model: modelLabel })}
        </p>
        <p className="text-sm text-theme-muted mb-5 leading-relaxed">
          {t('quota.capReachedHint', { date: nextResetDate(i18n.language) })}
        </p>
        <div className="flex flex-col gap-2">
          {/* Play Store — pas de CTA d'achat sur natif (le hint ci-dessus
              propose déjà les modèles standards + la date de reset). */}
          {canPurchase && (
            <button
              onClick={buyPack}
              className="w-full px-4 py-2.5 text-xs font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg hover:opacity-90 rounded-md transition-opacity"
            >
              {t('quota.buyPack')}
            </button>
          )}
          {/* D4 (CDC visibilité modèle, audit F-11) — l'ancien bouton
              « Continuer avec les modèles standards » était un NO-OP (close()
              seul) : en Auto, le renvoi re-sélectionnait le même modèle capé
              → nouveau 429 immédiat. Remplacé par une action EXPLICITE et
              réversible : bascule le sélecteur sur Mistral (non cappé,
              visible dans l'UI) PUIS rejoue la question restée sans réponse
              (le chemin cap ne pose ni bandeau ni bouton retry, et l'input
              est déjà vidé — sans relance, l'utilisateur devait retaper).
              Pas de downgrade silencieux : le clic EST le consentement. */}
          {!mistralLocked && (
            <button
              onClick={() => {
                setSelectedModel('mistral')
                try {
                  window.dispatchEvent(new CustomEvent('arty-retry-last', {
                    detail: { conversationId: detail.conversationId },
                  }))
                } catch { /* contexte sans window */ }
                close()
              }}
              className="w-full px-4 py-2.5 text-xs font-sans uppercase tracking-kicker border border-theme-border text-theme-ink hover:border-theme-accent hover:text-theme-accent rounded-md transition-colors"
            >
              {t('quota.switchToMistral')}
            </button>
          )}
          <button
            onClick={close}
            className="w-full px-3 py-1.5 text-xs font-sans uppercase tracking-kicker text-theme-muted hover:text-theme-ink transition-colors"
          >
            {t('quota.later')}
          </button>
        </div>
      </div>
    </div>
  )
})
