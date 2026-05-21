import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'
import { PrismMark } from '../shared/PrismMark'
import { getDateLocale } from '../../utils/formatDate'
import { recordBriefFeedback } from '../../services/proactiveBriefSettings'
import { ACTION_LABEL_KEY, type BriefActionType, type BriefItem, type BriefAction } from '../../services/proactiveBriefActions'

type BriefState = { items: BriefItem[] } | { text: string } | null

interface Props {
  brief: BriefState
  loading: boolean
  generatedAt?: number | null
  onDismiss: () => void
  onRefresh: () => void
  onAction: (action: BriefAction, item: BriefItem) => 'task' | 'chat' | null
  isStreaming?: boolean
}

function hasItems(b: BriefState): b is { items: BriefItem[] } {
  return !!b && 'items' in b
}

// Petites icônes par type d'action — réduit la largeur des chips et améliore la
// scannabilité sur mobile (retour QA).
function ActionIcon({ type }: { type: BriefActionType }) {
  const common = { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (type) {
    case 'view_email':
      return <svg {...common}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>
    case 'reply':
      return <svg {...common}><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg>
    case 'reminder':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    case 'schedule':
      return <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
    default:
      return null
  }
}

function BriefSkeleton() {
  const { t } = useTranslation()
  return (
    <div className="px-6 pt-7 max-w-3xl">
      <div className="rounded-[14px] border border-theme-border bg-theme-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <span className="flex items-center gap-2">
            <PrismMark size={16} color="rgb(var(--theme-accent))" />
            <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
              {t('proactiveBrief.title')}
            </span>
          </span>
          <span className="font-display italic text-[11px] text-theme-muted">{t('proactiveBrief.loading')}</span>
        </div>
        <div className="mx-4 h-px bg-theme-border" />
        <div className="px-4 py-3.5 space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3.5 bg-theme-ink/10 rounded animate-pulse" style={{ width: `${80 - i * 12}%` }} />
              <div className="flex gap-1.5">
                <div className="h-4 w-16 bg-theme-ink/5 rounded-md animate-pulse" />
                <div className="h-4 w-14 bg-theme-ink/5 rounded-md animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProactiveBriefCardInner({ brief, loading, generatedAt, onDismiss, onRefresh, onAction, isStreaming }: Props) {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState<null | 'up' | 'down'>(null)
  const [doneActions, setDoneActions] = useState<Set<string>>(new Set())

  // Skeleton uniquement quand AUCUNE carte n'est encore affichée (un refresh ne
  // doit pas masquer une carte en cours de lecture).
  if (loading && !brief) return <BriefSkeleton />
  if (!brief) return null

  const updatedLabel = generatedAt
    ? new Date(generatedAt).toLocaleTimeString(getDateLocale(), { hour: '2-digit', minute: '2-digit' })
    : null

  const handleAction = (action: BriefAction, item: BriefItem, key: string) => {
    if (isStreaming) return
    if (onAction(action, item) === 'task') {
      setDoneActions((prev) => new Set(prev).add(key))
    }
  }

  return (
    <div className="px-6 pt-7 max-w-3xl">
      <div className="rounded-[14px] border border-theme-border bg-theme-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <span className="flex items-center gap-2 min-w-0">
            <PrismMark size={16} color="rgb(var(--theme-accent))" />
            <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
              {t('proactiveBrief.title')}
            </span>
            {updatedLabel && (
              <span className="font-sans text-[10px] text-theme-muted/80 truncate">
                · {t('proactiveBrief.updatedAt', { time: updatedLabel })}
              </span>
            )}
          </span>
          <span className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={onRefresh}
              disabled={loading}
              aria-label={t('proactiveBrief.refresh')}
              className="text-theme-muted hover:text-theme-accent rounded p-1 transition-colors disabled:opacity-50"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'animate-spin' : ''}>
                <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3L3 16M3 21v-5h5" />
              </svg>
            </button>
            <button
              onClick={onDismiss}
              aria-label={t('common.close')}
              className="text-theme-muted hover:text-theme-ink rounded p-1 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        </div>
        <div className="mx-4 h-px bg-theme-border" />

        <div className="px-4 py-3.5">
          {hasItems(brief) ? (
            <ul className="flex flex-col divide-y divide-theme-border/60">
              {brief.items.map((item, i) => (
                <li key={i} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="font-display text-[15px] leading-snug text-theme-ink">{item.title}</p>
                  {item.detail && (
                    <p className="font-sans text-[12px] leading-snug text-theme-muted mt-0.5">{item.detail}</p>
                  )}
                  {item.actions.length > 0 && (
                    <div className="flex flex-row flex-wrap gap-1.5 mt-2">
                      {item.actions.map((action, j) => {
                        const key = `${i}:${action.type}`
                        const done = doneActions.has(key)
                        return (
                          <button
                            key={j}
                            onClick={() => handleAction(action, item, key)}
                            disabled={isStreaming || done}
                            className="inline-flex items-center gap-1 font-sans text-[11px] px-2 py-0.5 rounded-md border border-theme-border text-theme-muted hover:text-theme-accent hover:border-theme-accent transition-colors disabled:opacity-50"
                          >
                            <ActionIcon type={action.type} />
                            {done ? t('proactiveBrief.actions.reminderDone') : t(ACTION_LABEL_KEY[action.type])}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm leading-relaxed text-theme-ink">
              <MarkdownRenderer content={brief.text} />
            </div>
          )}
        </div>

        {/* Feedback — ajuste le prochain brief (longueur). */}
        <div className="mx-4 h-px bg-theme-border" />
        <div className="px-4 py-2 flex items-center justify-end gap-2">
          {feedback ? (
            <span className="font-display italic text-[11px] text-theme-muted">{t('proactiveBrief.feedbackThanks')}</span>
          ) : (
            <>
              <span className="font-sans text-[10px] text-theme-muted mr-1">{t('proactiveBrief.feedbackPrompt')}</span>
              <button
                onClick={() => { recordBriefFeedback(true); setFeedback('up') }}
                aria-label={t('proactiveBrief.feedbackUp')}
                className="text-theme-muted hover:text-theme-accent transition-colors p-1"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>
              </button>
              <button
                onClick={() => { recordBriefFeedback(false); setFeedback('down') }}
                aria-label={t('proactiveBrief.feedbackDown')}
                className="text-theme-muted hover:text-theme-accent transition-colors p-1"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export const ProactiveBriefCard = memo(ProactiveBriefCardInner)
