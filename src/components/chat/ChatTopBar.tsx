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

  return (
    <header className="bg-cream border-b border-gray-100">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Back */}
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors"
          aria-label={t('chat.topBar.aria.back')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12 4L6 10L12 16" stroke="#1E1A14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Title */}
        <h1 className="flex-1 text-sm font-medium text-bubble-user truncate text-center">
          {title}
        </h1>

        {/* Summary button (Feature 4) */}
        {onOpenSummary && (
          <button
            onClick={onOpenSummary}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            title="Résumé de la conversation"
            aria-label="Résumé"
          >
            📋
          </button>
        )}

        {/* Export button (Feature 7) */}
        {conversation && (
          <button
            onClick={() => exportConversation(conversation)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            title="Exporter la conversation (JSON)"
            aria-label="Exporter"
          >
            ⬇️
          </button>
        )}

        {/* Share link (Feature 7) */}
        {conversation && (
          <button
            onClick={async () => {
              const url = buildShareUrl(conversation)
              try {
                await navigator.clipboard.writeText(url)
              } catch {}
            }}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors text-xs"
            title="Copier le lien de partage"
            aria-label="Partager"
          >
            🔗
          </button>
        )}

        {/* Style + Model dropdowns */}
        <div className="flex items-center gap-1.5" ref={menuRef}>
          {/* Style dropdown */}
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'style' ? null : 'style')}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                openMenu === 'style' ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>{styleOption.emoji}</span>
              <span>{styleLabel(styleOption.id)}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-50">
                <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>

            {openMenu === 'style' && (
              <div className="absolute top-full right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50 min-w-[140px]">
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleStyleChange(opt.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      currentStyle === opt.id
                        ? 'bg-accent/10 text-accent font-semibold'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span>{opt.emoji}</span>
                    <span>{styleLabel(opt.id)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info button */}
          <button
            onClick={() => setShowGuide(true)}
            className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label={t('chat.topBar.aria.toneModelHelp')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M5.5 5.5C5.5 4.67 6.17 4 7 4C7.83 4 8.5 4.67 8.5 5.5C8.5 6.17 8 6.5 7.5 6.75C7.25 6.87 7 7.12 7 7.5V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="7" cy="9.5" r="0.5" fill="currentColor" />
            </svg>
          </button>

          {/* Model dropdown — locked if EU-only conversation */}
          <div className="relative">
            {euOnly ? (
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-blue-100 text-blue-700">
                <span>🇪🇺</span>
                <span>{t('chat.topBar.euBadge')}</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-50">
                  <rect x="3" y="5" width="4" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="0.8" />
                  <path d="M4 5V3.5C4 2.67 4.67 2 5.5 2V2C6.33 2 7 2.67 7 3.5V5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
                </svg>
              </div>
            ) : (
              <button
                onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  openMenu === 'model' ? 'bg-bubble-user text-cream' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
              <div className="absolute top-full right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50 min-w-[140px]">
                {MODEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => handleModelChange(opt.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      currentModel === opt.id
                        ? 'bg-bubble-user/10 text-bubble-user font-semibold'
                        : 'text-gray-600 hover:bg-gray-50'
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
      </div>

      {showGuide && <SettingsGuide onClose={() => setShowGuide(false)} />}

      {privacyWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPrivacyWarning(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl mx-6 p-5 max-w-sm w-full">
            <p className="text-sm font-semibold text-bubble-user mb-2">{t('chat.privacyWarning.title')}</p>
            <p className="text-xs text-gray-500 leading-relaxed mb-4">
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
                className="flex-1 py-2 rounded-xl border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmModelSwitch}
                className="flex-1 py-2 rounded-xl bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
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
