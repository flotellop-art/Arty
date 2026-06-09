import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getSelectedLevel, setSelectedLevel, type ModelLevel } from '../../services/modelSelector'
import type { ModelFamily } from '../../hooks/usePlanStatus'

// Curseur d'effort partagé entre les 2 barres (accueil TopBar + conversation
// ChatTopBar). Vrai slider (track + curseur), 4 arrêts Auto/Rapide/Équilibré/
// Puissant. N'agit réellement que sur Claude (seul provider multi-tiers :
// Haiku/Sonnet/Opus). Équilibré/Puissant = premium → verrouillés (🔒) pour un
// free sans crédits ; usePlanStatus débloque les familles si l'user a des crédits.

const STOPS: ModelLevel[] = ['auto', 'fast', 'balanced', 'powerful']
const ICON: Record<ModelLevel, string> = { auto: '⚡', fast: '🟢', balanced: '🔵', powerful: '🟣' }

interface Props {
  lockedFamilies: ModelFamily[]
  /** Tap sur un niveau verrouillé → le parent affiche le prompt upgrade. */
  onLocked?: (label: string) => void
  /** Après un choix valide → le parent peut fermer le menu. */
  onPick?: () => void
}

export function ModelLevelSlider({ lockedFamilies, onLocked, onPick }: Props) {
  const { t } = useTranslation()
  const [level, setLevel] = useState<ModelLevel>(getSelectedLevel)

  const isLocked = (lv: ModelLevel): boolean =>
    (lv === 'balanced' && lockedFamilies.includes('claude-sonnet')) ||
    (lv === 'powerful' && lockedFamilies.includes('claude-opus'))

  const pick = (lv: ModelLevel) => {
    if (isLocked(lv)) { onLocked?.(t(`chat.level.${lv}`)); return }
    setSelectedLevel(lv)
    setLevel(lv)
    onPick?.()
  }

  const pctFor = (i: number) => (i / (STOPS.length - 1)) * 100
  const activePct = pctFor(STOPS.indexOf(level))

  return (
    <div className="px-3 pt-2.5 pb-2">
      <div className="text-[9px] uppercase tracking-wider text-theme-muted pb-3">
        {t('chat.level.label')}
      </div>

      {/* Slider : track + remplissage + curseur, arrêts cliquables */}
      <div className="relative h-1.5 bg-theme-ink/10 rounded-full mx-2">
        <div
          className="absolute left-0 top-0 bottom-0 bg-theme-accent/70 rounded-full"
          style={{ width: `${activePct}%` }}
        />
        <div
          className="absolute top-1/2 w-3.5 h-3.5 bg-white border-2 border-theme-accent rounded-full shadow-sm pointer-events-none"
          style={{ left: `${activePct}%`, transform: 'translate(-50%, -50%)' }}
        />
        {STOPS.map((lv, i) => (
          <button
            key={lv}
            onClick={() => pick(lv)}
            aria-label={t(`chat.level.${lv}`)}
            className="absolute -top-2.5 h-6 w-7"
            style={{ left: `${pctFor(i)}%`, transform: 'translateX(-50%)' }}
          >
            {isLocked(lv) && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[8px]">🔒</span>
            )}
          </button>
        ))}
      </div>

      {/* Libellés sous le track (cliquables aussi) */}
      <div className="flex justify-between mt-3">
        {STOPS.map((lv) => (
          <button
            key={lv}
            onClick={() => pick(lv)}
            className={`flex flex-col items-center gap-0.5 text-[9px] leading-tight transition-colors ${
              level === lv
                ? 'text-theme-accent font-semibold'
                : isLocked(lv)
                ? 'text-theme-muted'
                : 'text-theme-ink/55 hover:text-theme-ink/80'
            }`}
          >
            <span className="text-[11px]">{ICON[lv]}</span>
            <span>{t(`chat.level.${lv}`)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
