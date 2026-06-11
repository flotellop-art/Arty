import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getStyle, setStyle as saveStyle, STYLE_OPTIONS, type ResponseStyle } from '../../services/responseStyles'
import { setSelectedModel, MODEL_OPTIONS, type AIModel } from '../../services/modelSelector'
import { useSelectedModel } from '../../hooks/useSelectedModel'
import { SettingsGuide } from '../shared/SettingsGuide'
import { PrismMark } from '../shared/PrismMark'
import { PlanBadge } from './PlanBadge'
import { UpgradePromptModal } from './UpgradePromptModal'
import { ChatOptionsSheet } from './ChatOptionsSheet'
import { usePlanStatus, type ModelFamily } from '../../hooks/usePlanStatus'
import { formatModelName, getModelExplanationKey, type ModelUsedEvent } from '../../services/modelLabels'
import {
  exportConversation,
  exportConversationMarkdown,
  exportConversationPdf,
  buildConversationMarkdown,
} from '../../services/conversationExport'
import { toast } from '../../services/toast'
import type { Conversation } from '../../types'

// Mapping provider → famille primaire (la moins chère). Le proxy gère
// le routage Haiku/Sonnet/Opus dans la famille Claude. Pour le lock UI,
// on regarde si la famille primaire est dispo dans le plan.
const PROVIDER_TO_FAMILY: Record<Exclude<AIModel, 'auto'>, ModelFamily> = {
  claude: 'claude-haiku',
  mistral: 'mistral-medium',
  gemini: 'gemini-flash',
  openai: 'gpt-mini',
}

interface ChatTopBarProps {
  title: string
  onBack: () => void
  usedModels?: string[]
  euOnly?: boolean
  conversation?: Conversation
  onOpenSummary?: () => void
}

type OpenMenu = null | 'style' | 'model'

// Killswitch PR B (pattern arty-conv-encryption-disabled, storage.ts:38-44) :
// header 1 ligne + sheet « ⋯ » actifs par défaut, `arty-chat-sheet-v2 = '0'`
// dans localStorage rebascule sur l'ancien header complet sans rebuild.
// Clé GLOBALE volontairement hors scopedStorage/chiffrement (BUG 43) :
// un flag de secours doit rester lisible même si la crypto est cassée.
function chatSheetV2Enabled(): boolean {
  try {
    return localStorage.getItem('arty-chat-sheet-v2') !== '0'
  } catch {
    return true
  }
}

export function ChatTopBar({ title, onBack, usedModels, euOnly, conversation, onOpenSummary }: ChatTopBarProps) {
  const { t } = useTranslation()
  const planStatus = usePlanStatus()
  const [currentStyle, setCurrentStyle] = useState<ResponseStyle>(getStyle)
  const currentModel = useSelectedModel()
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [privacyWarning, setPrivacyWarning] = useState<AIModel | null>(null)
  const [upgradePrompt, setUpgradePrompt] = useState<string | null>(null)
  const [lastUsedModel, setLastUsedModel] = useState<string | null>(null)
  // Roadmap UI Phase 1 #3 — tap sur le badge "Dernier appel : X" → tooltip
  // expliquant pourquoi ce modèle a été choisi. Améliore la transparence
  // du routeur IA, qui était jusqu'ici opaque (auto sélection invisible).
  const [showModelExplain, setShowModelExplain] = useState(false)
  const [lastSearchProvider, setLastSearchProvider] = useState<string | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  // Évalué à chaque render (lecture localStorage triviale) : un testeur peut
  // poser le flag en DevTools et le voir s'appliquer au prochain render.
  const sheetV2 = chatSheetV2Enabled()

  // Écoute le dernier modèle effectivement appelé (dispatché par les
  // clients AI avant l'envoi). Permet d'afficher "Mistral Medium 3.5" sous
  // le sélecteur, plutôt que juste "Mistral" générique.
  useEffect(() => {
    const onModelUsed = (e: Event) => {
      const detail = (e as CustomEvent<ModelUsedEvent>).detail
      if (detail?.model) {
        setLastUsedModel(detail.model)
        // Reset le provider search quand un nouveau modèle est appelé : on
        // ne sait pas encore si la requête utilisera le tool web_search.
        setLastSearchProvider(null)
      }
    }
    const onSearchUsed = (e: Event) => {
      const detail = (e as CustomEvent<{ provider: string }>).detail
      if (detail?.provider) setLastSearchProvider(detail.provider)
    }
    window.addEventListener('arty-model-used', onModelUsed)
    window.addEventListener('arty-search-used', onSearchUsed)
    return () => {
      window.removeEventListener('arty-model-used', onModelUsed)
      window.removeEventListener('arty-search-used', onSearchUsed)
    }
  }, [])

  const isProviderLocked = (id: AIModel): boolean => {
    if (id === 'auto') return false
    const family = PROVIDER_TO_FAMILY[id]
    return planStatus.lockedFamilies.includes(family)
  }

  const styleLabel = (id: ResponseStyle) => t(`chat.tone.${id}`)
  const modelLabel = (id: AIModel) => (id === 'auto' ? t('chat.model.auto') : MODEL_OPTIONS.find(o => o.id === id)?.label ?? id)

  const handleStyleChange = (style: ResponseStyle) => {
    saveStyle(style)
    setCurrentStyle(style)
    window.dispatchEvent(new CustomEvent('style-changed', { detail: style }))
    setOpenMenu(null)
  }

  const handleModelChange = (model: AIModel) => {
    // Lock check : si modèle réservé aux Pro et user free → modal upgrade,
    // pas de changement de selectedModel.
    if (isProviderLocked(model)) {
      const label = MODEL_OPTIONS.find((o) => o.id === model)?.label ?? model
      setUpgradePrompt(label)
      setOpenMenu(null)
      // UpgradePromptModal est z-50 < sheet z-[90] : fermer le sheet avant
      // d'afficher la modale, sinon elle apparaît sous le backdrop.
      setSheetOpen(false)
      return
    }

    // Warn if conversation used Mistral (EU) and user switches to non-EU model
    const hadMistral = usedModels?.includes('mistral')
    const isNonEU = model === 'claude' || model === 'gemini' || model === 'openai'
    if (hadMistral && isNonEU) {
      setPrivacyWarning(model)
      setOpenMenu(null)
      return
    }
    // L'event 'model-changed' dispatché par setSelectedModel resynchronise
    // currentModel via useSelectedModel — pas de setState local.
    setSelectedModel(model)
    setOpenMenu(null)
  }

  const confirmModelSwitch = () => {
    if (privacyWarning) {
      setSelectedModel(privacyWarning)
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

  // Close export menu on outside click / touch
  useEffect(() => {
    if (!exportMenuOpen) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [exportMenuOpen])

  const styleOption = STYLE_OPTIONS.find(o => o.id === currentStyle) ?? STYLE_OPTIONS[0]!
  const modelOption = MODEL_OPTIONS.find(o => o.id === currentModel) ?? MODEL_OPTIONS[0]!

  // Audit UX 10 juin 2026 — l'ancien partage copiait une URI
  // `data:application/json;base64,…` : incollable dans une messagerie,
  // bloquée par les navigateurs en navigation top-level, et copiée sans
  // aucun feedback. Maintenant : Web Share API (feuille de partage native)
  // avec le markdown de la conversation, fallback copie presse-papier +
  // toast de confirmation.
  const handleShare = async () => {
    if (!conversation) return
    const md = buildConversationMarkdown(conversation)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: conversation.title, text: md })
        return
      } catch (err) {
        // L'utilisateur a fermé la feuille de partage → pas un échec.
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Autre erreur (pas de cible, WebView sans support) → fallback copie.
      }
    }
    try {
      await navigator.clipboard.writeText(md)
      toast(t('chat.topBar.shareCopied'), 'success')
    } catch {
      toast(t('chat.topBar.shareFailed'), 'error')
    }
  }

  return (
    <header
      className="bg-theme-bg"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Row 1 — back + editorial title (left-aligned, Fraunces italic with
          kicker). En v2 (sheet) : + pilule modèle + « ⋯ », et c'est la SEULE
          rangée — les chips style/modèle et les actions vivent dans le sheet. */}
      <div className={`flex gap-3 px-4 pt-3 ${sheetV2 ? 'items-center pb-2' : 'items-baseline pb-1'}`}>
        <button
          onClick={onBack}
          className={`p-1 -ml-1 rounded text-theme-ink hover:bg-theme-ink/5 transition-colors shrink-0 ${sheetV2 ? '' : 'self-start mt-0.5'}`}
          aria-label={t('chat.topBar.aria.back')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1 min-w-0 overflow-hidden">
          <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
            {t('chat.topBar.kicker', { defaultValue: 'Conversation' })}
          </p>
          <h1 className="font-display italic text-[17px] text-theme-ink truncate leading-tight">
            {title}
          </h1>
        </div>
        {sheetV2 && (
          <>
            {euOnly ? (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-theme-accent/10 text-theme-accent shrink-0">
                <span>🇪🇺</span>
                <span>{t('chat.topBar.euBadge')}</span>
              </div>
            ) : (
              <button
                onClick={() => setSheetOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-theme-accent/10 text-theme-accent border border-theme-accent/25 hover:bg-theme-accent/15 transition-colors shrink-0"
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
              >
                {currentModel === 'auto' ? <PrismMark size={11} fill /> : <span>{modelOption.flag}</span>}
                <span>{modelLabel(modelOption.id)}</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-60">
                  <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            )}
            <button
              onClick={() => setSheetOpen(true)}
              className="w-9 h-9 rounded-xl border border-theme-border bg-theme-surface text-theme-ink text-lg leading-none hover:bg-theme-ink/5 transition-colors shrink-0 flex items-center justify-center"
              aria-label={t('chat.optionsSheet.open')}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
            >
              ⋯
            </button>
          </>
        )}
      </div>

      {/* Editorial double rule */}
      <div className="mx-4 h-[2px] bg-theme-ink" />
      <div className="mx-4 mt-[3px] h-px bg-theme-ink" />

      {/* ===== Ancien header complet (killswitch arty-chat-sheet-v2 = '0') —
          conservé tel quel pour rollback sans rebuild. À supprimer une fois
          le sheet validé en beta (garde-fou PLAN.md, risque R2). ===== */}
      {!sheetV2 && (
        <>
      {/* Row 2a — chips Style / Info / Modèle (full width, wraps if needed) */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2 pb-1" ref={menuRef}>
          {/* Style dropdown */}
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'style' ? null : 'style')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                openMenu === 'style' ? 'bg-theme-accent text-theme-bg' : 'bg-theme-ink/5 text-theme-ink/80 hover:bg-theme-ink/10'
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
                        : 'text-theme-ink/80 hover:bg-theme-ink/[0.03]'
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
            className="w-7 h-7 rounded-full border border-theme-accent/40 text-theme-accent text-[10px] font-semibold hover:bg-theme-accent/10 transition-colors flex items-center justify-center shrink-0"
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
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium transition-colors border ${
                  openMenu === 'model'
                    ? 'bg-theme-ink text-theme-bg border-theme-ink'
                    : 'bg-theme-accent/10 text-theme-accent border-theme-accent/25 hover:bg-theme-accent/15'
                }`}
              >
                {currentModel === 'auto' ? (
                  <PrismMark size={11} fill />
                ) : (
                  <span>{modelOption.flag}</span>
                )}
                <span>{modelLabel(modelOption.id)}</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 opacity-60">
                  <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            )}

            {openMenu === 'model' && (
              <div className="absolute top-full left-0 mt-1 bg-theme-surface rounded-xl shadow-lg border border-theme-border py-1 z-50 min-w-[160px]">
                {MODEL_OPTIONS.map((opt) => {
                  const locked = isProviderLocked(opt.id)
                  return (
                  <button
                    key={opt.id}
                    onClick={() => handleModelChange(opt.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      currentModel === opt.id
                        ? 'bg-theme-accent/10 text-theme-accent font-semibold'
                        : locked
                        ? 'text-theme-muted hover:bg-theme-ink/[0.03]'
                        : 'text-theme-ink/80 hover:bg-theme-ink/[0.03]'
                    }`}
                  >
                    {opt.id === 'auto' ? (
                      <PrismMark size={12} fill color={currentModel === opt.id ? 'rgb(var(--theme-accent))' : 'rgb(var(--theme-ink) / 0.6)'} />
                    ) : (
                      <span>{opt.flag}</span>
                    )}
                    <span className="flex-1 text-left">{modelLabel(opt.id)}</span>
                    {locked && <span className="text-[10px] opacity-70">🔒</span>}
                  </button>
                  )
                })}
              </div>
            )}
          </div>
          {/* Plan badge (Free quotas / Pro ∞) — toujours visible côté droit */}
          <div className="ml-auto mr-3">
            <PlanBadge />
          </div>
      </div>

      {/* Sous-titre : modèle exact du dernier appel (ex. "Mistral Medium 3.5").
          Tap → tooltip "Pourquoi ce modèle ?" (roadmap UI Phase 1 #3). */}
      {lastUsedModel && (
        <div className="px-3 pb-1 text-[10px] font-sans uppercase tracking-kicker text-theme-muted">
          <button
            type="button"
            onClick={() => setShowModelExplain((v) => !v)}
            className="hover:text-theme-ink transition-colors underline-offset-2 hover:underline cursor-pointer"
            aria-label={t('chat.topBar.whyModel')}
            aria-expanded={showModelExplain}
          >
            {t('chat.topBar.lastCall', { model: formatModelName(lastUsedModel) })}
          </button>
          {lastSearchProvider && (
            <span className="ml-1 text-theme-accent">
              · 🔍 {lastSearchProvider.charAt(0).toUpperCase() + lastSearchProvider.slice(1)}
            </span>
          )}
          {showModelExplain && (
            <div className="mt-1.5 px-2.5 py-2 bg-theme-surface border border-theme-border rounded-lg normal-case tracking-normal text-[11px] text-theme-ink leading-relaxed max-w-md">
              <p className="font-semibold mb-1">{t('chat.topBar.whyModel')}</p>
              <p className="text-theme-ink/80">{t(getModelExplanationKey(lastUsedModel))}</p>
            </div>
          )}
        </div>
      )}
        </>
      )}

      {upgradePrompt && (
        <UpgradePromptModal
          modelLabel={upgradePrompt}
          onClose={() => setUpgradePrompt(null)}
        />
      )}

      {/* Row 2b — actions Résumé / Export / Partager (conditional: hidden when nothing to show) */}
      {!sheetV2 && (onOpenSummary || conversation) && (
        <div className="flex items-center justify-end gap-0.5 px-3 pb-2 pt-0.5">
          {onOpenSummary && (
            <button
              onClick={onOpenSummary}
              className="p-1.5 rounded text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 transition-colors"
              title={t('chat.optionsSheet.summarize')}
              aria-label={t('chat.topBar.aria.summary')}
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
            <div ref={exportRef} className="relative">
              <button
                onClick={() => setExportMenuOpen((o) => !o)}
                className="p-1.5 rounded text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 transition-colors"
                title={t('chat.topBar.exportTitle')}
                aria-label={t('chat.topBar.aria.export')}
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 11V13H13V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
              {exportMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 bg-theme-surface rounded-xl border border-theme-border shadow-lg overflow-hidden z-30 min-w-[180px]"
                >
                  <button
                    role="menuitem"
                    onClick={() => { setExportMenuOpen(false); void exportConversationMarkdown(conversation) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-theme-ink hover:bg-theme-ink/5"
                  >
                    <span>📄</span><span>Markdown (.md)</span>
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { setExportMenuOpen(false); void exportConversationPdf(conversation) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-theme-ink hover:bg-theme-ink/5"
                  >
                    <span>📑</span><span>PDF (.pdf)</span>
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { setExportMenuOpen(false); exportConversation(conversation) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-theme-ink hover:bg-theme-ink/5"
                  >
                    <span>📦</span><span>{t('chat.topBar.exportJson')}</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {conversation && (
            <button
              onClick={handleShare}
              className="p-1.5 rounded text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 transition-colors"
              title={t('chat.topBar.shareTitle')}
              aria-label={t('chat.topBar.aria.share')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M7 5L5.5 6.5C4.5 7.5 4.5 9.1 5.5 10.1C6.5 11.1 8.1 11.1 9.1 10.1L10.5 8.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M9 11L10.5 9.5C11.5 8.5 11.5 6.9 10.5 5.9C9.5 4.9 7.9 4.9 6.9 5.9L5.5 7.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Sheet « ⋯ » (v2). Présentationnel : la logique (lock Pro, EU/US,
          partage, listeners arty-model-used) reste ici, monté en permanence.
          Les actions ferment le sheet AVANT d'ouvrir leur modale/flux
          (collision d'overlays, audit PR B R3/R7). La sélection modèle/style
          laisse le sheet ouvert : l'utilisateur voit le ✓ se déplacer ; la
          confirmation EU/US (z-[100]) s'affiche par-dessus si déclenchée. */}
      {sheetV2 && (
        <ChatOptionsSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          currentModel={currentModel}
          currentStyle={currentStyle}
          euOnly={euOnly}
          hasMistralData={!!usedModels?.includes('mistral') && !euOnly}
          lastUsedModel={lastUsedModel}
          lastSearchProvider={lastSearchProvider}
          isProviderLocked={isProviderLocked}
          onSelectModel={handleModelChange}
          onSelectStyle={handleStyleChange}
          onOpenSummary={onOpenSummary ? () => { setSheetOpen(false); onOpenSummary() } : undefined}
          hasConversation={!!conversation}
          onExportMarkdown={() => { setSheetOpen(false); if (conversation) void exportConversationMarkdown(conversation) }}
          onExportPdf={() => { setSheetOpen(false); if (conversation) void exportConversationPdf(conversation) }}
          onExportJson={() => { setSheetOpen(false); if (conversation) exportConversation(conversation) }}
          onShare={() => { setSheetOpen(false); void handleShare() }}
          onOpenGuide={() => { setSheetOpen(false); setShowGuide(true) }}
        />
      )}

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
                className="flex-1 py-2 rounded-xl border border-theme-border text-xs font-medium text-theme-ink/80 hover:bg-theme-ink/[0.03] transition-colors"
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
