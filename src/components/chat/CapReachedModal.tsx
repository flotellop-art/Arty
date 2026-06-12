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

const BUCKET_LABELS: Record<string, string> = {
  'claude-sonnet': 'Claude Sonnet/Opus',
  'gpt-5': 'GPT-5',
  'gemini-pro': 'Gemini Pro',
}

interface CapDetail {
  bucket?: string
  cap?: number
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
          <button
            onClick={buyPack}
            className="w-full px-4 py-2.5 text-xs font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg hover:opacity-90 rounded-md transition-opacity"
          >
            {t('quota.buyPack')}
          </button>
          <button
            onClick={close}
            className="w-full px-4 py-2.5 text-xs font-sans uppercase tracking-kicker border border-theme-border text-theme-ink hover:border-theme-accent hover:text-theme-accent rounded-md transition-colors"
          >
            {t('quota.continueStandard')}
          </button>
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
