// Petit badge en haut de l'écran qui indique le plan actuel et les quotas
// restants. Pour les free users : affiche le quota Haiku restant
// (Mistral n'est plus accessible aux free depuis la dépréciation de Small).
// Pour les payants : "∞".
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

const BUCKET_SHORT: Record<string, string> = {
  'claude-sonnet': 'Sonnet',
  'gpt-5': 'GPT-5',
  'gemini-pro': 'G-Pro',
}

export const PlanBadge = memo(function PlanBadge() {
  const status = usePlanStatus()
  const navigate = useNavigate()

  if (status.loading) return null

  const isFree = status.plan === 'free'
  const isSub = status.plan === 'subscription'
  const haikuLeft = status.dailyRemaining?.['claude-haiku'] ?? 0

  // P0.6 — compteur mensuel visible pour le plan subscription : on affiche
  // le bucket le plus entamé (ratio restant le plus faible) — c'est celui
  // qui bloquera en premier. Le détail des 3 buckets vit dans le tooltip
  // et dans la section Quota du ChatOptionsSheet.
  let subLabel = `${PLAN_LABEL.subscription} · ∞`
  let subTitle = ''
  let subExhausted = false
  if (isSub && status.monthlyCap) {
    const entries = Object.entries(status.monthlyCap)
    if (entries.length > 0) {
      const tightest = entries.reduce((min, cur) =>
        cur[1].remaining / cur[1].limit < min[1].remaining / min[1].limit ? cur : min
      )
      const [bucket, c] = tightest
      subLabel = `${BUCKET_SHORT[bucket] ?? bucket} ${c.remaining}/${c.limit}`
      subExhausted = c.remaining <= 0 && status.premiumPackRemaining <= 0
      subTitle = entries
        .map(([b, e]) => `${BUCKET_SHORT[b] ?? b} : ${e.remaining}/${e.limit}`)
        .join(' · ')
      if (status.premiumPackRemaining > 0) {
        subTitle += ` · Pack : ${status.premiumPackRemaining}`
      }
    }
  }

  const label = isFree
    ? `${PLAN_LABEL.free} · ${haikuLeft}🤖`
    : isSub
    ? subLabel
    : `${PLAN_LABEL[status.plan] ?? 'Pro'} · ∞`

  const isAlmostExhausted = (isFree && haikuLeft <= 2) || subExhausted

  return (
    <button
      onClick={() => {
        if (isFree) navigate('/upgrade')
        else if (isSub) navigate(subExhausted ? '/upgrade?scroll=premium' : '/costs')
      }}
      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-kicker font-sans transition-colors ${
        isAlmostExhausted
          ? 'bg-theme-accent/15 text-theme-accent hover:bg-theme-accent/25'
          : isFree
          ? 'bg-theme-surface text-theme-muted hover:bg-theme-bg hover:text-theme-ink border border-theme-border'
          : 'bg-theme-accent/10 text-theme-accent'
      }`}
      title={
        isFree
          ? `Plan gratuit · ${haikuLeft}/${status.dailyLimits?.['claude-haiku']} Haiku aujourd'hui. Click pour upgrader et débloquer Sonnet, Opus, Mistral, Gemini et GPT.`
          : isSub && subTitle
          ? `Messages premium restants ce mois — ${subTitle}`
          : `Plan ${PLAN_LABEL[status.plan]} · accès illimité`
      }
    >
      {label}
    </button>
  )
})
