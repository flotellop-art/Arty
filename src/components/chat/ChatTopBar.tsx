import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getStyle, setStyle as saveStyle, STYLE_OPTIONS, type ResponseStyle } from '../../services/responseStyles'
import { getSelectedModel, setSelectedModel, MODEL_OPTIONS, type AIModel } from '../../services/modelSelector'
import { SettingsGuide } from '../shared/SettingsGuide'
import { exportConversation, buildShareUrl } from '../../services/conversationExport'
import type { Conversation } from '../../types'

interface ChatTopBarProps {
  title: string
  onBack: () => void
  usedModels?: string[]
  euOnly?: boolean
  conversation?: Conversation
  onOpenSummary?: () => void
}

type OpenMenu = null | 'style' | 'model'

export function ChatTopBar({ title, onBack, usedModels, euOnly, conversation, onOpenSummary }: ChatTopBarProps) {
  const { t } = useTranslation()
  const [currentStyle, setCurrentStyle] = useState<ResponseStyle>(getStyle)
  const [currentModel, setCurrentModel] = useState<AIModel>(getSelectedModel)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [privacyWarning, setPrivacyWarning] = useState<AIModel | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const styleLabel = (id: ResponseStyle) => t(`chat.tone.${id}`)
  const modelLabel = (id: AIModel) => (id === 'auto' ? t('chat.model.auto') : MODEL_OPTIONS.find(o => o.id === id)?.label ?? id)

  const handleStyleChange = (style: ResponseStyle) => {
    saveStyle(style)
    setCurrentStyle(style)
    window.dispatchEvent(new CustomEvent('style-changed', { detail: style }))
    setOpenMenu(null)
  }

  const handleModelChange = (model: AIModel) => {
    // Warn if conversation used Mistral (EU) and user switches to non-EU model
    const hadMistral = usedModels?.includes('mistral')
    const isNonEU = model === 'claude' || model === 'gemini' || model === 'openai'
    if (hadMistral && isNonEU) {
      setPrivacyWarning(model)
      setOpenMenu(null)
      return
    }
    setSelectedModel(model)
    setCurrentModel(model)
    setOpenMenu(null)
  }

  const confirmModelSwitch = () => {
    if (privacyWarning) {
      setSelectedModel(privacyWarning)
      setCurrentModel(privacyWarning)
      setPrivacyWarning(null)
    }
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

  const handleShare = async () => {
    if (!conversation) return
    const url = buildShareUrl(conversation)
    try { await navigator.clipboard.writeText(url) } catch {}
  }

  return (
    <header className="bg-theme-bg">
      {/* Row 1 — back + editorial title (left-aligned, Fraunces italic with kicker) */}
      <div className="flex items-baseline gap-3 px-4 pt-3 pb-1">
        <button
          onClick={onBack}
          className="p-1 -ml-1 rounded text-theme-ink hover:bg-theme-ink/5 transition-colors shrink-0 self-start mt-0.5"
          aria-label={t('chat.topBar.aria.back')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
            {t('chat.topBar.kicker', { defaultValue: 'Conversation' })}
          </p>
          <h1 className="font-display italic text-[17px] text-theme-ink truncate leading-tight">
            {title}
          </h1>
        </div>
      </div>

      {/* Editorial double rule */}
      <div className="mx-4 h-[2px] bg-theme-ink" />
      <div className="mx-4 mt-[3px] h-px bg-theme-ink" />

      {/* Row 2 — chips + actions (clean SVG icons, pas d'emoji) */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        {/* Style + Model chips */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0" ref={menuRef}>
          {/* Style dropdown */}
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'style' ? null : 'style')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                openMenu === 'style' ? 'bg-theme-accent text-theme-bg' : 'bg-theme-ink/5 text-theme-ink/70 hover:bg-theme-ink/10'
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
                        : 'text-theme-ink/70 hover:bg-theme-ink/[0.03]'
                    }`}
                  >
                    <span>{opt.emoji}</span>
                    <span>{styleLabel(opt.id)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info button — terracotta ? circle */}
          <button
            onClick={() => setShowGuide(true)}
            className="w-5 h-5 rounded-full border border-theme-accent/40 text-theme-accent text-[10px] font-semibold hover:bg-theme-accent/10 transition-colors flex items-center justify-center shrink-0"
            aria-label={t('chat.topBar.aria.toneModelHelp')}
          >
            ?
          </button>

          {/* Model dropdown — locked if EU-only */}
          <div className="relative">
            {euOnly ? (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-theme-accent/10 text-theme-accent">
                <span>🇪🇺</span>
                <span>{t('chat.topBar.euBadge')}</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-60">
                  <rect x="3" y="5" width="4" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="0.8" />
                  <path d="M4 5V3.5C4 2.67 4.67 2 5.5 2C6.33 2 7 2.67 7 3.5V5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
                </svg>
              </div>
            ) : (
              <button
                onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  openMenu === 'model' ? 'bg-theme-ink text-theme-bg' : 'bg-theme-ink/5 text-theme-ink/70 hover:bg-theme-ink/10'
                }`}
              >
                <span>{modelOption.flag}</span>
                <span>{modelLabel(modelOption.id)}</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-50">
                  <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            )}

            {openMenu === 'model' && (
              <div className="absolute top-full left-0 mt-1 bg-theme-surface rounded-xl shadow-lg border border-theme-border py-1 z-50 min-w-[140px]">
                {MODEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleModelChange(opt.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      currentModel === opt.id
                        ? 'bg-theme-ink/10 text-theme-ink font-semibold'
                        : 'text-theme-ink/70 hover:bg-theme-ink/[0.03]'
                    }`}
                  >
                    <span>{opt.flag}</span>
                    <span>{modelLabel(opt.id)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions — icônes SVG minimalistes, muted */}
        <div className="flex items-center gap-0.5 shrink-0">
          {onOpenSummary && (
            <button
              onClick={onOpenSummary}
              className="p-1.5 rounded text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 transition-colors"
              title="Résumé de la conversation"
              aria-label="Résumé"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="4" y="2" width="8" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <line x1="6" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="6" y1="9" x2="10" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="6" y1="12" x2="8.5" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          )}

          {conversation && (
            <button
              onClick={() => exportConversation(conversation)}
              className="p-1.5 rounded text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 transition-colors"
              title="Exporter la conversation (JSON)"
              aria-label="Exporter"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 11V13H13V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          )}

          {conversation && (
            <button
              onClick={handleShare}
              className="p-1.5 rounded text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 transition-colors"
              title="Copier le lien de partage"
              aria-label="Partager"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M7 5L5.5 6.5C4.5 7.5 4.5 9.1 5.5 10.1C6.5 11.1 8.1 11.1 9.1 10.1L10.5 8.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M9 11L10.5 9.5C11.5 8.5 11.5 6.9 10.5 5.9C9.5 4.9 7.9 4.9 6.9 5.9L5.5 7.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {showGuide && <SettingsGuide onClose={() => setShowGuide(false)} />}

      {privacyWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-theme-ink/40" onClick={() => setPrivacyWarning(null)} />
          <div className="relative bg-theme-surface rounded-2xl shadow-xl mx-6 p-5 max-w-sm w-full">
            <p className="text-sm font-semibold text-theme-ink mb-2">{t('chat.privacyWarning.title')}</p>
            <p className="text-xs text-theme-muted leading-relaxed mb-4">
              {t('chat.privacyWarning.body', {
                targetModel:
                  privacyWarning === 'claude'
                    ? 'Claude'
                    : privacyWarning === 'gemini'
                      ? 'Gemini'
                      : privacyWarning === 'openai'
                        ? 'ChatGPT'
                        : privacyWarning,
              })}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPrivacyWarning(null)}
                className="flex-1 py-2 rounded-xl border border-theme-border text-xs font-medium text-theme-ink/70 hover:bg-theme-ink/[0.03] transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmModelSwitch}
                className="flex-1 py-2 rounded-xl bg-theme-accent text-theme-bg text-xs font-medium hover:opacity-90 transition-colors"
              >
                {t('common.continue')}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
