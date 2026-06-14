// Petit badge en haut de l'écran qui indique le plan actuel et les quotas
// restants. Pour les free users : affiche le quota Haiku restant
// (Mistral n'est plus accessible aux free depuis la dépréciation de Small).
// Pour les payants : "∞".
//
// Click → ouvre la page upgrade pour les free, no-op pour les payants.

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { usePlanStatus } from '../../hooks/usePlanStatus'

// Clés i18n des labels de plan et des abréviations de bucket (P1.6).
const PLAN_LABEL_KEY: Record<string, string> = {
  free: 'chat.planBadge.labelFree',
  subscription: 'chat.planBadge.labelSub',
  pro: 'chat.planBadge.labelPro',
  vip: 'chat.planBadge.labelVip',
}
const BUCKET_KEY: Record<string, string> = {
  'claude-sonnet': 'chat.planBadge.bucketSonnet',
  'gpt-5': 'chat.planBadge.bucketGpt5',
  'gemini-pro': 'chat.planBadge.bucketGeminiPro',
  'gpt-image': 'chat.planBadge.bucketImages',
}

export const PlanBadge = memo(function PlanBadge() {
  const { t } = useTranslation()
  const status = usePlanStatus()
  const navigate = useNavigate()

  if (status.loading) return null

  const planLabel = (p: string) => t(PLAN_LABEL_KEY[p] ?? 'chat.planBadge.labelPro')
  const bucketLabel = (b: string) => (BUCKET_KEY[b] ? t(BUCKET_KEY[b]!) : b)

  const isFree = status.plan === 'free'
  const isSub = status.plan === 'subscription'
  const haikuLeft = status.dailyRemaining?.['claude-haiku'] ?? 0

  // P0.6 — compteur mensuel visible pour le plan subscription : on affiche
  // le bucket le plus entamé (ratio restant le plus faible) — c'est celui
  // qui bloquera en premier. Le détail des 3 buckets vit dans le tooltip
  // et dans la section Quota du ChatOptionsSheet.
  let subLabel = `${planLabel('subscription')} · ∞`
  let subTitle = ''
  let subExhausted = false
  if (isSub && status.monthlyCap) {
    const entries = Object.entries(status.monthlyCap)
    if (entries.length > 0) {
      const tightest = entries.reduce((min, cur) =>
        cur[1].remaining / cur[1].limit < min[1].remaining / min[1].limit ? cur : min
      )
      const [bucket, c] = tightest
      subLabel = `${bucketLabel(bucket)} ${c.remaining}/${c.limit}`
      subExhausted = c.remaining <= 0 && status.premiumPackRemaining <= 0
      subTitle = entries
        .map(([b, e]) => `${bucketLabel(b)} : ${e.remaining}/${e.limit}`)
        .join(' · ')
      if (status.premiumPackRemaining > 0) {
        subTitle += ` · Pack : ${status.premiumPackRemaining}`
      }
    }
  }

  const label = isFree
    ? `${planLabel('free')} · ${haikuLeft}🤖`
    : isSub
    ? subLabel
    : `${planLabel(status.plan)} · ∞`

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
          ? t('chat.planBadge.titleFree', { haiku: haikuLeft, limit: status.dailyLimits?.['claude-haiku'] })
          : isSub && subTitle
          ? t('chat.planBadge.titleSub', { detail: subTitle })
          : t('chat.planBadge.titlePro', { plan: planLabel(status.plan) })
      }
    >
      {label}
    </button>
  )
})
