import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReflectionLevel } from '../../hooks/useReflectionLevel'
import { useSelectedModel } from '../../hooks/useSelectedModel'
import {
  REFLECTION_OPTIONS,
  setReflectionLevel,
  reflectionSupported,
  isReflectionLevelLocked,
  type ReflectionLevel,
} from '../../services/reflectionLevel'
import { UpgradePromptModal } from './UpgradePromptModal'

// Pastille « Réflexion » discrète au-dessus de la barre de saisie (audit UX
// 12 juin — feedback utilisateur : le strip segmenté du header n'était « pas
// esthétique » ; il voulait discret, visible, proche de la barre de chat,
// sans gêner la saisie). Rendue dans l'InputContextSlot avec les chips :
// visible à l'idle (textarea vide), disparaît automatiquement dès la frappe
// — la contrainte « ne gêne pas » est structurelle, pas un hack clavier.
// Tap → popover compact vers le haut avec les 4 niveaux. Le réglage complet
// (avec hint) reste dans le sheet « ⋯ ».
//
// Autonome : lit le niveau (useReflectionLevel), le modèle (useSelectedModel)
// et le plan via le cache localStorage 'arty-plan-cache' (même source que
// selectClaudeSubModel) — pas de usePlanStatus ici, le composant se
// monte/démonte à chaque frappe et relancerait un fetch à chaque fois.
// Le cache est tenu frais par le usePlanStatus de ChatTopBar, monté à côté.

interface ReflectionPillProps {
  /** Conversation verrouillée Europe → réflexion non supportée → rien. */
  euOnly?: boolean
}

function isProFromCache(): boolean {
  try {
    const plan = localStorage.getItem('arty-plan-cache')
    return plan !== null && plan !== 'free'
  } catch {
    return false
  }
}

export function ReflectionPill({ euOnly }: ReflectionPillProps) {
  const { t } = useTranslation()
  const level = useReflectionLevel()
  const model = useSelectedModel()
  const [open, setOpen] = useState(false)
  const [upgradePrompt, setUpgradePrompt] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Fermeture au tap extérieur (même pattern que les menus de ChatTopBar).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  if (!reflectionSupported(model, euOnly)) return null

  const current = REFLECTION_OPTIONS.find((o) => o.id === level) ?? REFLECTION_OPTIONS[0]!
  const isPro = isProFromCache()

  const select = (id: ReflectionLevel) => {
    if (isReflectionLevelLocked(id, isPro)) {
      setOpen(false)
      setUpgradePrompt(true)
      return
    }
    setReflectionLevel(id)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('chat.reflection.label')}
        className="flex items-center gap-1 px-2 py-1 rounded-full text-[10.5px] text-theme-muted hover:text-theme-ink hover:bg-theme-ink/[0.04] transition-colors"
      >
        <span aria-hidden="true">{current.emoji}</span>
        <span className="font-sans uppercase tracking-kicker text-[9.5px] font-semibold">
          {t('chat.reflection.label')} · {t(`chat.reflection.${current.id}`)}
        </span>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" className="opacity-50" aria-hidden="true">
          <path d="M2.5 6.5L5 4L7.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('chat.reflection.label')}
          className="absolute bottom-full left-0 mb-1.5 bg-theme-surface rounded-xl shadow-lg border border-theme-border py-1 z-30 min-w-[170px] animate-fade-in"
        >
          {REFLECTION_OPTIONS.map((opt) => {
            const selected = level === opt.id
            const locked = isReflectionLevelLocked(opt.id, isPro)
            return (
              <button
                key={opt.id}
                role="option"
                aria-selected={selected}
                onClick={() => select(opt.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                  selected
                    ? 'bg-theme-accent/10 text-theme-accent font-semibold'
                    : 'text-theme-ink/80 hover:bg-theme-ink/[0.03]'
                }`}
              >
                <span aria-hidden="true">{locked ? '🔒' : opt.emoji}</span>
                <span className="flex-1 text-left">{t(`chat.reflection.${opt.id}`)}</span>
                {selected && <span className="text-theme-accent" aria-hidden="true">✓</span>}
              </button>
            )
          })}
        </div>
      )}

      {upgradePrompt && (
        <UpgradePromptModal
          modelLabel={t('chat.reflection.maxUpgradeLabel')}
          onClose={() => setUpgradePrompt(false)}
        />
      )}
    </div>
  )
}
