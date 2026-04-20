import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getStyle, setStyle as saveStyle, STYLE_OPTIONS, type ResponseStyle } from '../../services/responseStyles'
import { getSelectedModel, setSelectedModel, MODEL_OPTIONS, type AIModel } from '../../services/modelSelector'
import { SettingsGuide } from '../shared/SettingsGuide'
import { exportConversation, buildShareUrl } from '../../services/conversationExport'
import { Tag } from '../shared/editorial'
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

  useEffect(() => {
    if (!openMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openMenu])

  const styleOption = STYLE_OPTIONS.find(o => o.id === currentStyle) ?? STYLE_OPTIONS[0]!
  const modelOption = MODEL_OPTIONS.find(o => o.id === currentModel) ?? MODEL_OPTIONS[0]!

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // Pillbox token shared — respects --arty-* for Ember/Nocturne flip
  const chipStyle = (active: boolean) => ({
    backgroundColor: active ? 'var(--arty-ink)' : 'var(--arty-card-hi)',
    color: active ? 'var(--arty-bg)' : 'var(--arty-ink-soft)',
    border: '1px solid var(--arty-line)',
  })

  const iconBtn = {
    color: 'var(--arty-muted)',
  }

  return (
    <header style={{ backgroundColor: 'var(--arty-bg)', borderBottom: '1px solid var(--arty-line)' }}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Back */}
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-lg transition-colors"
          style={{ color: 'var(--arty-ink)' }}
          aria-label={t('chat.topBar.aria.back')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Title editorial */}
        <div className="flex-1 min-w-0 leading-tight overflow-hidden">
          <Tag>Conversation · {now}</Tag>
          <div
            className="font-display italic text-[15px] truncate"
            style={{ color: 'var(--arty-ink)', letterSpacing: '-0.01em' }}
          >
            {title}
          </div>
        </div>
      </div>

      {/* Style + Model row (keeps functionality, editorial presentation) */}
      <div
        className="px-4 pb-2 flex items-center gap-1.5"
        style={{ borderTop: '1px solid var(--arty-line)' }}
        ref={menuRef}
      >
        {/* Style dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'style' ? null : 'style')}
            className="flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] font-medium mt-2"
            style={chipStyle(openMenu === 'style')}
          >
            <span>{styleOption.emoji}</span>
            <span>{styleLabel(styleOption.id)}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-50">
              <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          {openMenu === 'style' && (
            <div
              className="absolute top-full left-0 mt-1 py-1 z-50 min-w-[140px]"
              style={{ backgroundColor: 'var(--arty-card)', border: '1px solid var(--arty-line)', borderRadius: 4 }}
            >
              {STYLE_OPTIONS.map((opt) => {
                const active = currentStyle === opt.id
                return (
                  <button
                    key={opt.id}
                    onClick={() => handleStyleChange(opt.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors"
                    style={{
                      color: active ? 'var(--arty-accent)' : 'var(--arty-ink-soft)',
                      fontWeight: active ? 600 : 400,
                      backgroundColor: active ? 'var(--arty-accent-glow)' : 'transparent',
                    }}
                  >
                    <span>{opt.emoji}</span>
                    <span>{styleLabel(opt.id)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Info */}
        <button
          onClick={() => setShowGuide(true)}
          className="p-1 rounded-full mt-2"
          style={{ color: 'var(--arty-muted)' }}
          aria-label={t('chat.topBar.aria.toneModelHelp')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5.5 5.5C5.5 4.67 6.17 4 7 4C7.83 4 8.5 4.67 8.5 5.5C8.5 6.17 8 6.5 7.5 6.75C7.25 6.87 7 7.12 7 7.5V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="7" cy="9.5" r="0.5" fill="currentColor" />
          </svg>
        </button>

        <div className="flex-1" />

        {/* Model */}
        <div className="relative">
          {euOnly ? (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] font-medium mt-2"
              style={{ backgroundColor: 'var(--arty-accent-glow)', color: 'var(--arty-accent)' }}
            >
              <span>🇪🇺</span>
              <span>{t('chat.topBar.euBadge')}</span>
            </div>
          ) : (
            <button
              onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
              className="flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] font-medium mt-2"
              style={chipStyle(openMenu === 'model')}
            >
              <span>{modelOption.flag}</span>
              <span>{modelLabel(modelOption.id)}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-50">
                <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {openMenu === 'model' && (
            <div
              className="absolute top-full right-0 mt-1 py-1 z-50 min-w-[140px]"
              style={{ backgroundColor: 'var(--arty-card)', border: '1px solid var(--arty-line)', borderRadius: 4 }}
            >
              {MODEL_OPTIONS.map((opt) => {
                const active = currentModel === opt.id
                return (
                  <button
                    key={opt.id}
                    onClick={() => handleModelChange(opt.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors"
                    style={{
                      color: active ? 'var(--arty-ink)' : 'var(--arty-ink-soft)',
                      fontWeight: active ? 600 : 400,
                      backgroundColor: active ? 'var(--arty-card-hi)' : 'transparent',
                    }}
                  >
                    <span>{opt.flag}</span>
                    <span>{modelLabel(opt.id)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Row 2b — actions Résumé / Export / Partager (conditionnelle) */}
      {(onOpenSummary || conversation) && (
        <div className="flex items-center justify-end gap-0.5 px-3 pb-2">
          {onOpenSummary && (
            <button
              onClick={onOpenSummary}
              className="p-1.5 rounded-lg transition-opacity hover:opacity-80"
              style={iconBtn}
              title="Résumé de la conversation"
              aria-label="Résumé"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3h10M3 6h10M3 9h7M3 12h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </button>
          )}
          {conversation && (
            <button
              onClick={() => exportConversation(conversation)}
              className="p-1.5 rounded-lg transition-opacity hover:opacity-80"
              style={iconBtn}
              title="Exporter la conversation (JSON)"
              aria-label="Exporter"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1v9m0 0L4 6.5m3.5 3.5L11 6.5M2 13h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          )}
          {conversation && (
            <button
              onClick={async () => {
                const url = buildShareUrl(conversation)
                try { await navigator.clipboard.writeText(url) } catch {}
              }}
              className="p-1.5 rounded-lg transition-opacity hover:opacity-80"
              style={iconBtn}
              title="Copier le lien de partage"
              aria-label="Partager"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M6 9L9 6M6 6l2.5-2.5a2.5 2.5 0 113.5 3.5L9.5 9.5M9 6L6.5 8.5a2.5 2.5 0 01-3.5-3.5L5.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </button>
          )}
        </div>
      )}

      {showGuide && <SettingsGuide onClose={() => setShowGuide(false)} />}

      {privacyWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={() => setPrivacyWarning(null)} />
          <div
            className="relative mx-6 p-5 max-w-sm w-full"
            style={{
              backgroundColor: 'var(--arty-card)',
              color: 'var(--arty-ink)',
              border: '1px solid var(--arty-line)',
              borderRadius: 4,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <p className="font-display text-[17px] font-medium mb-2">{t('chat.privacyWarning.title')}</p>
            <p className="font-serif italic text-[13px] leading-[1.5] mb-4" style={{ color: 'var(--arty-muted)' }}>
              {t('chat.privacyWarning.body', {
                targetModel:
                  privacyWarning === 'claude' ? 'Claude'
                    : privacyWarning === 'gemini' ? 'Gemini'
                    : privacyWarning === 'openai' ? 'ChatGPT'
                    : privacyWarning,
              })}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPrivacyWarning(null)}
                className="flex-1 py-2 text-xs font-medium"
                style={{ border: '1px solid var(--arty-line)', color: 'var(--arty-ink)', borderRadius: 2 }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmModelSwitch}
                className="flex-1 py-2 text-xs font-serif italic"
                style={{ backgroundColor: 'var(--arty-accent)', color: 'var(--arty-bg)', borderRadius: 2 }}
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
