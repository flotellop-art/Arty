import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchBillingUsage } from '../../services/billingClient'
import { decideBillingAdvice, type BillingAdvice } from '../../services/billingAdvisor'

// Carte « suggestion » du conseiller de facturation. Affichée seulement quand le
// cerveau a une reco CONFIANTE (sinon rien). Déterministe, zéro appel IA.
// Anti-harcèlement : refus mémorisé ; on ne re-montre la MÊME cible que si
// l'économie a matériellement augmenté (doublé).

const DISMISS_KEY = 'billing-advice-dismissed'
interface Dismissed {
  target: string
  savings: number
  at: number
}

function readDismissed(): Dismissed | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    return raw ? (JSON.parse(raw) as Dismissed) : null
  } catch {
    return null
  }
}

export function BillingAdvisorCard() {
  const { t } = useTranslation()
  const [advice, setAdvice] = useState<BillingAdvice | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let alive = true
    fetchBillingUsage().then((usage) => {
      if (alive && usage) setAdvice(decideBillingAdvice(usage))
    })
    return () => {
      alive = false
    }
  }, [])

  if (hidden || !advice || !advice.recommend) return null

  // Refus mémorisé pour la même cible → re-montrer seulement si l'économie a doublé.
  const dismissed = readDismissed()
  if (
    dismissed &&
    dismissed.target === advice.recommend &&
    advice.savingsEur < dismissed.savings * 2
  ) {
    return null
  }

  const onDismiss = () => {
    try {
      localStorage.setItem(
        DISMISS_KEY,
        JSON.stringify({ target: advice.recommend, savings: advice.savingsEur, at: Date.now() }),
      )
    } catch {
      /* ignore */
    }
    setHidden(true)
  }

  const vars = {
    credits: advice.creditsEur.toFixed(2),
    subscription: advice.subscriptionEur.toFixed(2),
    byok: advice.byokEur.toFixed(2),
    current: advice.currentEur.toFixed(2),
    savings: advice.savingsEur.toFixed(2),
    payback: advice.byokPaybackMonths != null ? String(Math.ceil(advice.byokPaybackMonths)) : '',
  }

  return (
    <div className="rounded-2xl border border-theme-border bg-theme-surface p-4 mb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-theme-muted">{t('advisor.title')}</p>
          <p className="text-sm text-theme-ink mt-1">{t(`advisor.${advice.reasonCode}`, vars)}</p>
          {/* Transparence : les 3 chiffres, toujours, pour que la reco soit vérifiable. */}
          <p className="text-[11px] text-theme-muted mt-2 font-mono">{t('advisor.threeNumbers', vars)}</p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 p-1.5 rounded-lg hover:bg-theme-ink/5 text-theme-muted"
          aria-label={t('common.close')}
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
            <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
