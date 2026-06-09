import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getStyle, setStyle as saveStyle, STYLE_OPTIONS, type ResponseStyle } from '../../services/responseStyles'
import { getSelectedModel, setSelectedModel, MODEL_OPTIONS, type AIModel } from '../../services/modelSelector'
import { SettingsGuide } from '../shared/SettingsGuide'
import { SettingsModal } from '../settings/SettingsModal'
import { getTheme, toggleTheme, type Theme } from '../../services/themeService'
import { CostIndicator } from './CostIndicator'
import { WalletBadge } from './WalletBadge'
import { PrismMark } from '../shared/PrismMark'
import { isProActivated } from '../../services/proLicense'
import { StreakBadge } from './StreakBadge'
import { usePlanStatus } from '../../hooks/usePlanStatus'
import { UpgradePromptModal } from '../chat/UpgradePromptModal'
import { ModelLevelSlider } from '../chat/ModelLevelSlider'

interface TopBarProps {
  onMenuToggle: () => void
}

type OpenMenu = null | 'style' | 'model'

export function TopBar({ onMenuToggle }: TopBarProps) {
  const { t } = useTranslation()
  const planStatus = usePlanStatus()
  const [currentStyle, setCurrentStyle] = useState<ResponseStyle>(getStyle)
  const [currentModel, setCurrentModel] = useState<AIModel>(getSelectedModel)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [upgradePrompt, setUpgradePrompt] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const [proActive, setProActive] = useState<boolean>(isProActivated)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sync = () => setProActive(isProActivated())
    window.addEventListener('pro-license-changed', sync)
    return () => window.removeEventListener('pro-license-changed', sync)
  }, [])

  const handleThemeToggle = () => {
    const next = toggleTheme()
    setThemeState(next)
  }

  // Labels traduisibles pour les tons / modèles affichés
  const styleLabel = (id: ResponseStyle) => t(`chat.tone.${id}`)
  const modelLabel = (id: AIModel) => (id === 'auto' ? t('chat.model.auto') : MODEL_OPTIONS.find(o => o.id === id)?.label ?? id)

  const handleStyleChange = (style: ResponseStyle) => {
    saveStyle(style)
    setCurrentStyle(style)
    window.dispatchEvent(new CustomEvent('style-changed', { detail: style }))
    setOpenMenu(null)
  }

  const handleModelChange = (model: AIModel) => {
    setSelectedModel(model)
    setCurrentModel(model)
    setOpenMenu(null)
  }

  // Close menu on outside click
  useEffect(() => {
    if (!openMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openMenu])

  const styleOption = STYLE_OPTIONS.find(o => o.id === currentStyle) ?? STYLE_OPTIONS[0]!
  const modelOption = MODEL_OPTIONS.find(o => o.id === currentModel) ?? MODEL_OPTIONS[0]!

  return (
    <header
      className="bg-theme-bg border-b border-theme-ink/10"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Row 1 — hamburger (gauche) + utilitaires (droite) */}
      <div className="flex items-center justify-between px-4 pt-2.5 pb-1">
        {/* Hamburger */}
        <button
          onClick={onMenuToggle}
          className="p-2 -ml-2 rounded-lg hover:bg-theme-ink/5 transition-colors text-theme-ink"
          aria-label={t('common.menu')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect y="3" width="20" height="2" rx="1" fill="currentColor" />
            <rect y="9" width="20" height="2" rx="1" fill="currentColor" />
            <rect y="15" width="20" height="2" rx="1" fill="currentColor" />
          </svg>
        </button>

        <div className="flex items-center gap-1">
          {proActive && (
            <span
              className="px-2 py-0.5 rounded-pill bg-theme-accent text-theme-bg font-sans text-[9px] font-semibold uppercase tracking-kicker"
              title="Licence Pro activée"
            >
              Pro
            </span>
          )}
          {/* Solde de crédits prépayés (visible seulement si l'user a un wallet) */}
          <WalletBadge />
          {/* Cost indicator (Feature 13) */}
          <CostIndicator />

          {/* Streak discret (F-004) — visible seulement >= 2 jours */}
          <StreakBadge />

          {/* Day/Night toggle — half-filled circle, the standard
              "appearance" icon. A sun/moon would collide with the settings
              icon next to it (itself a sunburst); the split circle reads as
              light/dark unambiguously and matches the line-icon toolbar. */}
          <button
            onClick={handleThemeToggle}
            className="p-2 rounded-lg hover:bg-theme-ink/5 transition-colors text-theme-ink"
            aria-label={theme === 'nocturne' ? 'Mode jour (Ember)' : 'Mode nuit (Nocturne)'}
            title={theme === 'nocturne' ? 'Mode jour (Ember)' : 'Mode nuit (Nocturne)'}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 2.75A7.25 7.25 0 0 1 10 17.25Z" fill="currentColor" />
            </svg>
          </button>

          {/* Settings (gear) */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-theme-ink/5 transition-colors text-theme-ink"
            aria-label="Paramètres"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M10 1.5V4M10 16V18.5M18.5 10H16M4 10H1.5M16.01 4L14.24 5.76M5.76 14.24L4 16M16.01 16L14.24 14.24M5.76 5.76L4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>

          {/* Bouton History supprimé — faisait doublon avec le burger menu à
              gauche qui ouvre déjà la même sidebar (cf. HomeScreen.tsx ligne 79
              qui passait onHistoryToggle={onMenuToggle}). Doublon confondant
              pour l'utilisateur. */}
        </div>
      </div>

      {/* Row 2 — chips Style / Info / Modèle */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5" ref={menuRef}>
          {/* Style dropdown */}
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'style' ? null : 'style')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                openMenu === 'style'
                  ? 'bg-theme-accent text-theme-bg border-theme-accent'
                  : 'bg-theme-surface text-theme-ink/80 border-theme-border hover:bg-theme-ink/[0.03]'
              }`}
            >
              <span>{styleOption.emoji}</span>
              <span>{styleLabel(styleOption.id)}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-50">
                <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>

            {openMenu === 'style' && (
              <div className="absolute top-full left-0 mt-1 bg-theme-surface rounded-xl shadow-lg border border-theme-border py-1 z-50 min-w-[140px]">
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleStyleChange(opt.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      currentStyle === opt.id
                        ? 'bg-theme-accent/10 text-theme-accent font-semibold'
                        : 'text-theme-ink/80 hover:bg-theme-ink/5'
                    }`}
                  >
                    <span>{opt.emoji}</span>
                    <span>{styleLabel(opt.id)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info help — petit cercle terracotta avec "?" (design handoff toolbar) */}
          <button
            onClick={() => setShowGuide(true)}
            className="w-6 h-6 rounded-full border border-theme-accent/40 text-theme-accent text-[11px] font-semibold hover:bg-theme-accent/10 transition-colors flex items-center justify-center shrink-0"
            aria-label={t('chat.topBar.aria.toneModelHelp')}
          >
            ?
          </button>

          {/* Model dropdown — en accent terracotta avec PrismMark (design handoff) */}
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                openMenu === 'model'
                  ? 'bg-theme-ink text-theme-bg border-theme-ink'
                  : 'bg-theme-accent/10 text-theme-accent border-theme-accent/25 hover:bg-theme-accent/15'
              }`}
            >
              {currentModel === 'auto' ? (
                <PrismMark size={12} fill />
              ) : (
                <span>{modelOption.flag}</span>
              )}
              <span>{modelLabel(modelOption.id)}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-60">
                <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>

            {openMenu === 'model' && (
              <div className="absolute top-full right-0 mt-1 bg-theme-surface rounded-xl shadow-lg border border-theme-border py-1 z-50 min-w-[236px]">
                {MODEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleModelChange(opt.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      currentModel === opt.id
                        ? 'bg-theme-accent/10 text-theme-accent font-semibold'
                        : 'text-theme-ink/80 hover:bg-theme-ink/[0.03]'
                    }`}
                  >
                    {opt.id === 'auto' ? (
                      <PrismMark size={12} fill color={currentModel === opt.id ? 'rgb(var(--theme-accent))' : 'rgb(var(--theme-ink) / 0.6)'} />
                    ) : (
                      <span>{opt.flag}</span>
                    )}
                    <span>{modelLabel(opt.id)}</span>
                  </button>
                ))}
                {/* Curseur d'effort partagé (slider) — dispo aussi en accueil. */}
                <div className="border-t border-theme-border mt-1">
                  <ModelLevelSlider
                    lockedFamilies={planStatus.lockedFamilies}
                    onLocked={(label) => { setUpgradePrompt(label); setOpenMenu(null) }}
                    onPick={() => setOpenMenu(null)}
                  />
                </div>
              </div>
            )}
          </div>
      </div>

      {showGuide && <SettingsGuide onClose={() => setShowGuide(false)} />}
      {upgradePrompt && (
        <UpgradePromptModal modelLabel={upgradePrompt} onClose={() => setUpgradePrompt(null)} />
      )}
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </header>
  )
}
