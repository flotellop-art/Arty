/**
 * F-004 — StreakBadge
 * Badge discret affiché dans le TopBar.
 *
 * Design éthique :
 * - Invisible si streak < 2 jours (pas de pression dès J1)
 * - Icône flamme sobre (pas d'animation anxiogène)
 * - Mode vacances : icône pause à la place de la flamme
 * - Tooltip positif et non-punitif
 * - Accessible (aria-label descriptif, i18n)
 */

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { recordActivity, type StreakData } from '../../services/streakService'

export function StreakBadge() {
  const { t } = useTranslation()
  const [streak, setStreak] = useState<StreakData>(() => {
    // recordActivity() au montage = une fois par session
    return recordActivity()
  })

  // Écoute les mises à jour (ex: toggle vacation depuis Settings)
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent<StreakData>).detail
      setStreak(data)
    }
    window.addEventListener('arty-streak-updated', handler)
    return () => window.removeEventListener('arty-streak-updated', handler)
  }, [])

  // Discret : invisible si streak < 2 ET pas en mode vacances
  if (streak.currentStreak < 2 && !streak.vacationMode) return null

  const label = streak.vacationMode
    ? t('streak.badge.vacationAriaLabel', { count: streak.currentStreak })
    : t('streak.badge.ariaLabel', { count: streak.currentStreak })

  return (
    <div
      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-theme-ink/5 hover:bg-theme-ink/10 transition-colors cursor-default select-none"
      aria-label={label}
      title={label}
      role="status"
    >
      {streak.vacationMode ? (
        <span aria-hidden="true" className="text-[13px]">⏸</span>
      ) : (
        <svg
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          aria-hidden="true"
          className="text-theme-accent"
        >
          {/* Flamme sobre — pas d'animation */}
          <path
            d="M6.5 1C6.5 1 9.5 4 9.5 6.5C9.5 8.433 8.157 10 6.5 10C4.843 10 3.5 8.433 3.5 6.5C3.5 5.2 4.2 4.1 5 3.3C5 4.5 5.8 5.2 6.5 5.2C6.5 3.5 6.5 1 6.5 1Z"
            fill="currentColor"
          />
        </svg>
      )}
      <span className="font-sans text-[11px] font-semibold text-theme-ink tabular-nums">
        {streak.currentStreak}
      </span>
    </div>
  )
}
