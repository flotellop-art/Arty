import { useTranslation } from 'react-i18next'
import { REFLECTION_OPTIONS, type ReflectionLevel } from '../../services/reflectionLevel'

interface ReflectionControlProps {
  level: ReflectionLevel
  onSelect: (level: ReflectionLevel) => void
  /** User non-Pro → le segment « Max » affiche un cadenas (le parent
   *  intercepte le tap pour ouvrir la modale d'upgrade). */
  maxLocked?: boolean
}

// Contrôle segmenté de la profondeur de réflexion (le « curseur » demandé) :
// Auto · Rapide · Approfondi · Max. Présentationnel — le parent gère la
// persistance (setReflectionLevel) et le lock Pro. Partagé entre la barre du
// chat (toujours visible) et le sheet « ⋯ ».
export function ReflectionControl({ level, onSelect, maxLocked }: ReflectionControlProps) {
  const { t } = useTranslation()
  return (
    <div
      role="radiogroup"
      aria-label={t('chat.reflection.label')}
      className="flex gap-0.5 p-0.5 rounded-full bg-theme-ink/[0.06] border border-theme-border/60"
    >
      {REFLECTION_OPTIONS.map((opt) => {
        const active = level === opt.id
        const locked = !!opt.proOnly && maxLocked
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(opt.id)}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-full text-[11px] font-medium transition-colors ${
              active
                ? 'bg-theme-accent text-theme-bg shadow-sm'
                : 'text-theme-ink/80 hover:text-theme-ink hover:bg-theme-ink/[0.04]'
            }`}
          >
            <span aria-hidden="true" className="text-[10px] leading-none">
              {locked ? '🔒' : opt.emoji}
            </span>
            <span className="truncate">{t(`chat.reflection.${opt.id}`)}</span>
          </button>
        )
      })}
    </div>
  )
}
