import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
    // 'trial' : défensif (C-E) — un essai n'est pas un compte payant, même si
    // status.ts venait à le distinguer de 'free' un jour.
    return plan !== null && plan !== 'free' && plan !== 'trial'
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Fermeture extérieure/Échap et focus initial sur l'option active.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKeyDown)
    const selectedIndex = Math.max(0, REFLECTION_OPTIONS.findIndex((option) => option.id === level))
    const focusFrame = window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus())
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [level, open])

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
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const moveOptionFocus = (index: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    let nextIndex = index
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % REFLECTION_OPTIONS.length
    else if (event.key === 'ArrowUp') nextIndex = (index - 1 + REFLECTION_OPTIONS.length) % REFLECTION_OPTIONS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = REFLECTION_OPTIONS.length - 1
    else return
    event.preventDefault()
    optionRefs.current[nextIndex]?.focus()
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('chat.reflection.label')}
        className="flex min-h-11 items-center gap-1 rounded-full border border-theme-ink/10 bg-theme-bg/60 px-3 py-1 text-[10.5px] text-theme-muted shadow-[0_1px_2px_rgb(var(--theme-ink)/0.025)] transition-colors hover:border-theme-accent/30 hover:bg-theme-accent/10 hover:text-theme-ink"
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
          className="absolute bottom-full left-0 z-30 mb-1.5 min-w-[170px] border border-theme-ink bg-theme-bg py-1 animate-fade-in"
        >
          {REFLECTION_OPTIONS.map((opt, index) => {
            const selected = level === opt.id
            const locked = isReflectionLevelLocked(opt.id, isPro)
            return (
              <button
                ref={(element) => { optionRefs.current[index] = element }}
                key={opt.id}
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(opt.id)}
                onKeyDown={(event) => moveOptionFocus(index, event)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                  selected
                    ? 'bg-theme-accent/10 text-theme-accent-text font-semibold'
                    : 'text-theme-ink/80 hover:bg-theme-ink/[0.03]'
                }`}
              >
                <span aria-hidden="true">{locked ? '🔒' : opt.emoji}</span>
                <span className="flex-1 text-left">{t(`chat.reflection.${opt.id}`)}</span>
                {selected && <span className="text-theme-accent-text" aria-hidden="true">✓</span>}
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
