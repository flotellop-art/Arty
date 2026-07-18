import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'
import { ACTION_LABEL_KEY, type BriefAction, type BriefItem } from '../../services/proactiveBriefActions'
import { recordBriefFeedback } from '../../services/proactiveBriefSettings'

type BriefState = { items: BriefItem[] } | { text: string } | null

interface Props {
  brief: BriefState
  loading: boolean
  onDismiss: () => void
  onAction: (action: BriefAction, item: BriefItem) => 'task' | 'chat' | null
  isStreaming?: boolean
}

function hasItems(brief: BriefState): brief is { items: BriefItem[] } {
  return !!brief && 'items' in brief
}

function ProactiveBriefCardInner({ brief, loading, onDismiss, onAction, isStreaming }: Props) {
  const { t } = useTranslation()
  const [doneActions, setDoneActions] = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useState<null | 'up' | 'down'>(null)

  const runAction = (action: BriefAction, item: BriefItem, key: string) => {
    if (isStreaming) return
    if (onAction(action, item) === 'task') {
      setDoneActions((current) => new Set(current).add(key))
    }
  }

  return (
    <section className="mb-[14px] border border-theme-ink px-[18px] py-4" aria-labelledby="arty-brief-title">
      <div className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-3 min-[640px]:grid-cols-[1fr_auto_auto] min-[640px]:items-center">
        <div className="min-w-0">
          <h2 id="arty-brief-title" className="font-sans text-[11.5px] font-bold uppercase tracking-[0.14em] text-theme-accent-text">
            {t('proactiveBrief.title')}
          </h2>

          {loading && !brief ? (
            <p className="mt-1 flex items-center gap-2 font-display text-[16.8px] leading-snug" role="status">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-theme-accent border-t-transparent" aria-hidden="true" />
              {t('proactiveBrief.loading')}
            </p>
          ) : hasItems(brief) && brief.items.length > 0 ? (
            <ul className="mt-1 space-y-2">
              {brief.items.map((item, index) => (
                <li key={`${item.title}-${index}`}>
                  <p className="font-display text-[16.8px] leading-snug">{item.title}</p>
                  {item.detail && <p className="mt-0.5 font-sans text-xs leading-snug text-theme-muted">{item.detail}</p>}
                  {item.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.actions.map((action, actionIndex) => {
                        const key = `${index}:${action.type}:${actionIndex}`
                        const done = doneActions.has(key)
                        const label = done
                          ? t('proactiveBrief.actions.reminderDone')
                          : t(ACTION_LABEL_KEY[action.type])
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => runAction(action, item, key)}
                            disabled={isStreaming || done}
                            aria-label={`${label} — ${item.title}`}
                            className="min-h-11 border border-theme-accent bg-transparent px-[14px] py-[7px] font-sans text-xs text-theme-accent-text transition-colors hover:bg-theme-ink hover:text-theme-bg disabled:opacity-50"
                          >
                            {done ? `✓ ${label}` : `⏰ ${label}`}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : brief && 'text' in brief ? (
            <div className="mt-1 font-display text-[16.8px] leading-snug"><MarkdownRenderer content={brief.text} /></div>
          ) : (
            <p className="mt-1 font-display text-[16.8px] leading-snug">{t('proactiveBrief.empty')}</p>
          )}
        </div>

        <button
          id="arty-brief-close"
          type="button"
          onClick={onDismiss}
          aria-label={t('common.close')}
          className="col-start-2 row-start-1 flex h-11 w-11 items-center justify-center text-lg text-theme-muted transition-colors hover:text-theme-accent-text min-[640px]:col-start-3"
        >
          ×
        </button>
      </div>
      {brief && (
        <div className="mt-3 flex min-h-11 items-center justify-end gap-1 border-t border-theme-border pt-2">
          {feedback ? (
            <span className="font-display text-xs italic text-theme-muted">{t('proactiveBrief.feedbackThanks')}</span>
          ) : (
            <>
              <span className="mr-1 font-sans text-[10px] text-theme-muted">{t('proactiveBrief.feedbackPrompt')}</span>
              <button
                type="button"
                onClick={() => { recordBriefFeedback(true); setFeedback('up') }}
                aria-label={t('proactiveBrief.feedbackUp')}
                className="grid h-11 w-11 place-items-center text-theme-muted transition-colors hover:text-theme-accent-text"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => { recordBriefFeedback(false); setFeedback('down') }}
                aria-label={t('proactiveBrief.feedbackDown')}
                className="grid h-11 w-11 place-items-center text-theme-muted transition-colors hover:text-theme-accent-text"
              >
                ↓
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}

export const ProactiveBriefCard = memo(ProactiveBriefCardInner)
