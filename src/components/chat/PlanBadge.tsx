// Petit badge en haut de l'écran qui indique le plan actuel et les quotas
// restants. Pour les free users : affiche le minimum entre Haiku et Mistral
// pour signaler la contrainte la plus serrée. Pour les payants : "∞".
//
// Click → ouvre la page upgrade pour les free, no-op pour les payants.

import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlanStatus } from '../../hooks/usePlanStatus'

const PLAN_LABEL: Record<string, string> = {
  free: 'Gratuit',
  subscription: 'Sub',
  pro: 'Pro',
  vip: 'VIP',
}

export const PlanBadge = memo(function PlanBadge() {
  const status = usePlanStatus()
  const navigate = useNavigate()

  if (status.loading) return null

  const isFree = status.plan === 'free'
  const haikuLeft = status.dailyRemaining?.['claude-haiku'] ?? 0
  const mistralLeft = status.dailyRemaining?.['mistral-small'] ?? 0

  const label = isFree
    ? `${PLAN_LABEL.free} · ${haikuLeft}🤖 ${mistralLeft}🇪🇺`
    : `${PLAN_LABEL[status.plan] ?? 'Pro'} · ∞`

  const isAlmostExhausted = isFree && haikuLeft <= 2 && mistralLeft <= 1

  return (
    <button
      onClick={() => isFree && navigate('/upgrade')}
      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-kicker font-sans transition-colors ${
        isAlmostExhausted
          ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
          : isFree
          ? 'bg-theme-surface text-theme-muted hover:bg-theme-bg hover:text-theme-ink border border-theme-border'
          : 'bg-theme-accent/10 text-theme-accent'
      }`}
      title={
        isFree
          ? `Plan gratuit · ${haikuLeft}/${status.dailyLimits?.['claude-haiku']} Haiku, ${mistralLeft}/${status.dailyLimits?.['mistral-small']} Mistral aujourd'hui. Click pour upgrader.`
          : `Plan ${PLAN_LABEL[status.plan]} · accès illimité`
      }
    >
      {label}
    </button>
  )
})
