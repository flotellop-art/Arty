import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getStyle, setStyle as saveStyle, STYLE_OPTIONS, type ResponseStyle } from '../../services/responseStyles'
import { getSelectedModel, setSelectedModel, MODEL_OPTIONS, type AIModel } from '../../services/modelSelector'
import { SettingsGuide } from '../shared/SettingsGuide'
import { SettingsModal } from '../settings/SettingsModal'
import { getTheme, toggleTheme, type Theme } from '../../services/themeService'
import { CostIndicator } from './CostIndicator'
import { PrismMark } from '../shared/PrismMark'

interface TopBarProps {
  onMenuToggle: () => void
  onHistoryToggle: () => void
}

type OpenMenu = null | 'style' | 'model'

export function TopBar({ onMenuToggle, onHistoryToggle }: TopBarProps) {
  const { t } = useTranslation()
  const [currentStyle, setCurrentStyle] = useState<ResponseStyle>(getStyle)
  const [currentModel, setCurrentModel] = useState<AIModel>(getSelectedModel)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const menuRef = useRef<HTMLDivElement>(null)

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
          {/* Cost indicator (Feature 13) */}
          <CostIndicator />

          {/* Day/Night toggle — Ember (☀️) ↔ Nocturne (🌙) */}
          <button
            onClick={handleThemeToggle}
            className="p-2 rounded-lg hover:bg-theme-ink/5 transition-colors text-base"
            aria-label={theme === 'nocturne' ? 'Mode jour (Ember)' : 'Mode nuit (Nocturne)'}
            title={theme === 'nocturne' ? 'Mode jour (Ember)' : 'Mode nuit (Nocturne)'}
          >
            {theme === 'nocturne' ? '☀️' : '🌙'}
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

          {/* History */}
          <button
            onClick={onHistoryToggle}
            className="p-2 -mr-2 rounded-lg hover:bg-theme-ink/5 transition-colors text-theme-ink"
            aria-label={t('common.history')}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <line x1="6" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="6" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="6" y1="14" x2="10" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
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
                        : 'text-theme-ink/70 hover:bg-theme-ink/5'
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
              <div className="absolute top-full right-0 mt-1 bg-theme-surface rounded-xl shadow-lg border border-theme-border py-1 z-50 min-w-[140px]">
                {MODEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleModelChange(opt.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      currentModel === opt.id
                        ? 'bg-theme-accent/10 text-theme-accent font-semibold'
                        : 'text-theme-ink/70 hover:bg-theme-ink/[0.03]'
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
              </div>
            )}
          </div>
      </div>

      {showGuide && <SettingsGuide onClose={() => setShowGuide(false)} />}
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </header>
  )
}
