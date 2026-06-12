import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '../shared/BottomSheet'
import { PrismMark } from '../shared/PrismMark'
import { PlanBadge } from './PlanBadge'
import { MODEL_OPTIONS, type AIModel } from '../../services/modelSelector'
import { STYLE_OPTIONS, type ResponseStyle } from '../../services/responseStyles'
import { type ReflectionLevel } from '../../services/reflectionLevel'
import { ReflectionControl } from './ReflectionControl'
import { formatModelName, getModelExplanationKey } from '../../services/modelLabels'
import { usePlanStatus } from '../../hooks/usePlanStatus'

// Sheet « ⋯ » de la conversation (PR B) — regroupe modèle / style / actions
// qui occupaient 2 rangées de chips dans ChatTopBar. Composant volontairement
// PRÉSENTATIONNEL : toute la logique (lock Pro, confirmation EU/US, partage,
// listeners arty-model-used) reste dans ChatTopBar qui est monté en
// permanence — un listener monté seulement quand le sheet est ouvert
// raterait tous les événements (audit PR B, risque critique n°1).

interface ChatOptionsSheetProps {
  open: boolean
  onClose: () => void
  /** Titre du sheet — défaut « Cette conversation ». L'accueil (PR G) passe
      un titre neutre (pas de conversation encore). */
  title?: string
  currentModel: AIModel
  currentStyle: ResponseStyle
  currentReflection: ReflectionLevel
  /** Réflexion supportée par le modèle courant (section masquée sinon —
      Mistral / ChatGPT / conversation EU). */
  showReflection: boolean
  maxReflectionLocked?: boolean
  onSelectReflection: (level: ReflectionLevel) => void
  euOnly?: boolean
  /** Conversation mixte ayant utilisé Mistral (≠ euOnly) → note EU informative. */
  hasMistralData?: boolean
  lastUsedModel: string | null
  lastSearchProvider: string | null
  isProviderLocked: (id: AIModel) => boolean
  onSelectModel: (model: AIModel) => void
  onSelectStyle: (style: ResponseStyle) => void
  onOpenSummary?: () => void
  hasConversation: boolean
  onExportMarkdown: () => void
  onExportPdf: () => void
  onExportJson: () => void
  onShare: () => void
  onOpenGuide: () => void
}

export function ChatOptionsSheet({
  open,
  onClose,
  title,
  currentModel,
  currentStyle,
  currentReflection,
  showReflection,
  maxReflectionLocked,
  onSelectReflection,
  euOnly,
  hasMistralData,
  lastUsedModel,
  lastSearchProvider,
  isProviderLocked,
  onSelectModel,
  onSelectStyle,
  onOpenSummary,
  hasConversation,
  onExportMarkdown,
  onExportPdf,
  onExportJson,
  onShare,
  onOpenGuide,
}: ChatOptionsSheetProps) {
  const { t } = useTranslation()
  const [showExplain, setShowExplain] = useState(false)
  // P0.6 — compteurs mensuels premium (plan subscription). Transparence des
  // limites = différenciateur n°1 de l'audit concurrentiel : l'utilisateur
  // voit exactement où il en est, jamais de surprise.
  const planStatus = usePlanStatus()

  const kicker = 'block font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-2'

  const QUOTA_LABELS: Record<string, string> = {
    'claude-sonnet': 'Claude Sonnet/Opus',
    'gpt-5': 'GPT-5',
    'gemini-pro': 'Gemini Pro',
    'gpt-image': 'Images',
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title ?? t('chat.optionsSheet.title')}
      titleAside={<PlanBadge />}
    >
      {/* ===== Modèle ===== */}
      <section className="mb-4">
        <span className={kicker}>{t('chat.optionsSheet.sectionModel')}</span>
        {euOnly ? (
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-theme-accent/10 text-theme-accent text-xs font-medium">
            <span>🇪🇺</span>
            <span>{t('chat.optionsSheet.euLocked')}</span>
          </div>
        ) : (
          <>
            {MODEL_OPTIONS.map((opt) => {
              const locked = isProviderLocked(opt.id)
              const selected = currentModel === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => onSelectModel(opt.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[13px] min-h-[48px] text-left border transition-colors ${
                    selected
                      ? 'border-theme-accent/40 bg-theme-accent/[0.08]'
                      : 'border-transparent hover:bg-theme-ink/[0.03]'
                  }`}
                >
                  <span className="w-[26px] text-center text-[15px] shrink-0">
                    {opt.id === 'auto' ? <PrismMark size={15} fill /> : opt.flag}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[13.5px] font-medium ${locked ? 'text-theme-muted' : 'text-theme-ink'}`}>
                      {opt.id === 'auto' ? t('chat.model.auto') : opt.label}
                    </span>
                    <span className="block text-[11px] text-theme-muted mt-px">
                      {t(`chat.optionsSheet.modelDesc.${opt.id}`)}
                    </span>
                  </span>
                  {selected && <span className="text-theme-accent text-[15px] shrink-0">✓</span>}
                  {!selected && locked && (
                    <span className="flex items-center gap-1 text-[11px] text-theme-muted shrink-0">
                      🔒 {t('chat.optionsSheet.proLock')}
                    </span>
                  )}
                </button>
              )
            })}
            {hasMistralData && (
              <div className="flex gap-2 mt-2 px-3 py-2 rounded-[11px] bg-theme-accent/[0.07] border border-theme-accent/20 text-[11px] leading-relaxed text-theme-muted">
                <span aria-hidden="true">🛡</span>
                <span>{t('chat.optionsSheet.euNote')}</span>
              </div>
            )}
          </>
        )}
        {lastUsedModel && (
          <div className="mt-2.5 pl-0.5">
            <button
              type="button"
              onClick={() => setShowExplain((v) => !v)}
              aria-expanded={showExplain}
              className="font-mono text-[9.5px] uppercase tracking-wider text-theme-muted hover:text-theme-ink transition-colors underline-offset-2 hover:underline"
            >
              {t('chat.topBar.lastCall', { model: formatModelName(lastUsedModel) })}
              {lastSearchProvider && (
                <span className="ml-1 text-theme-accent normal-case">
                  · 🔍 {lastSearchProvider.charAt(0).toUpperCase() + lastSearchProvider.slice(1)}
                </span>
              )}
            </button>
            {showExplain && (
              <div className="mt-1.5 px-2.5 py-2 bg-theme-bg border border-theme-border rounded-lg text-[11px] text-theme-ink leading-relaxed">
                <p className="font-semibold mb-1">{t('chat.topBar.whyModel')}</p>
                <p className="text-theme-ink/80">{t(getModelExplanationKey(lastUsedModel))}</p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ===== Quota du mois (P0.6, plan subscription uniquement) ===== */}
      {planStatus.plan === 'subscription' && planStatus.monthlyCap && (
        <section className="mb-4">
          <span className={kicker}>{t('quota.sheetTitle')}</span>
          <div className="px-3 py-2.5 rounded-[13px] border border-theme-border space-y-2.5">
            {Object.entries(planStatus.monthlyCap).map(([bucket, c]) => {
              const ratio = c.limit > 0 ? c.remaining / c.limit : 0
              const barColor =
                ratio <= 0 ? 'bg-red-500/70' : ratio < 0.2 ? 'bg-theme-accent' : 'bg-theme-accent/60'
              return (
                <div key={bucket}>
                  <div className="flex items-baseline justify-between text-[11px] mb-1">
                    <span className="text-theme-ink">{QUOTA_LABELS[bucket] ?? bucket}</span>
                    <span className="font-mono text-theme-muted">
                      {c.remaining}/{c.limit}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-theme-ink/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor}`}
                      style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
                    />
                  </div>
                </div>
              )
            })}
            <p className="text-[10px] text-theme-muted leading-relaxed pt-0.5">
              {planStatus.premiumPackRemaining > 0
                ? t('quota.sheetFooterWithPack', { pack: planStatus.premiumPackRemaining })
                : t('quota.sheetFooter')}
            </p>
          </div>
        </section>
      )}

      {/* ===== Réflexion ===== (masquée pour Mistral/ChatGPT/EU) */}
      {showReflection && (
        <section className="mb-4">
          <span className={kicker}>{t('chat.optionsSheet.sectionReflection')}</span>
          <ReflectionControl
            level={currentReflection}
            onSelect={onSelectReflection}
            maxLocked={maxReflectionLocked}
          />
          <p className="mt-1.5 text-[11px] text-theme-muted leading-snug">
            {t('chat.reflection.hint')}
          </p>
        </section>
      )}

      {/* ===== Style de réponse ===== */}
      <section className="mb-4">
        <span className={kicker}>{t('chat.optionsSheet.sectionStyle')}</span>
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {STYLE_OPTIONS.map((opt) => {
            const selected = currentStyle === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => onSelectStyle(opt.id)}
                className={`shrink-0 flex items-center gap-1.5 px-4 min-h-[40px] rounded-pill border text-xs whitespace-nowrap transition-colors ${
                  selected
                    ? 'bg-theme-accent text-theme-bg border-theme-accent font-medium'
                    : 'border-theme-border text-theme-ink hover:bg-theme-ink/[0.03]'
                }`}
              >
                <span>{opt.emoji}</span>
                <span>{t(`chat.tone.${opt.id}`)}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* ===== Actions ===== */}
      <section>
        <span className={kicker}>{t('chat.optionsSheet.sectionActions')}</span>
        {onOpenSummary && (
          <>
            <button
              onClick={onOpenSummary}
              className="w-full flex items-center gap-3 min-h-[48px] px-1.5 rounded-xl text-[13.5px] text-theme-ink hover:bg-theme-ink/[0.03] transition-colors"
            >
              <span className="w-6 text-center" aria-hidden="true">✦</span>
              <span>{t('chat.optionsSheet.summarize')}</span>
            </button>
            <div className="h-px bg-theme-border mx-1.5" />
          </>
        )}
        {hasConversation && (
          <>
            <div className="flex items-center gap-3 min-h-[48px] px-1.5 text-[13.5px] text-theme-ink">
              <span className="w-6 text-center" aria-hidden="true">⇩</span>
              <span>{t('chat.optionsSheet.exportLabel')}</span>
              <span className="ml-auto flex gap-1.5">
                {[
                  { label: 'PDF', fn: onExportPdf },
                  { label: 'MD', fn: onExportMarkdown },
                  { label: 'JSON', fn: onExportJson },
                ].map(({ label, fn }) => (
                  <button
                    key={label}
                    onClick={fn}
                    className="px-2.5 py-1 rounded-full border border-theme-border text-[11px] text-theme-ink/80 hover:bg-theme-ink/5 transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>
            <div className="h-px bg-theme-border mx-1.5" />
            <button
              onClick={onShare}
              className="w-full flex items-center gap-3 min-h-[48px] px-1.5 rounded-xl text-[13.5px] text-theme-ink hover:bg-theme-ink/[0.03] transition-colors"
            >
              <span className="w-6 text-center" aria-hidden="true">⇗</span>
              <span>{t('chat.optionsSheet.share')}</span>
            </button>
            <div className="h-px bg-theme-border mx-1.5" />
          </>
        )}
        <button
          onClick={onOpenGuide}
          className="w-full flex items-center gap-3 min-h-[48px] px-1.5 rounded-xl text-[13.5px] text-theme-ink hover:bg-theme-ink/[0.03] transition-colors"
        >
          <span className="w-6 text-center" aria-hidden="true">?</span>
          <span>{t('chat.optionsSheet.help')}</span>
        </button>
      </section>
    </BottomSheet>
  )
}
