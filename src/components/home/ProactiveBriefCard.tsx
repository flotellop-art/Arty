import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'
import { PrismMark } from '../shared/PrismMark'

interface Props {
  brief: string | null
  loading: boolean
  onDismiss: () => void
}

function ProactiveBriefCardInner({ brief, loading, onDismiss }: Props) {
  const { t } = useTranslation()
  if (!loading && !brief) return null

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
          <button
            onClick={onDismiss}
            aria-label={t('common.close')}
            className="text-theme-muted hover:text-theme-ink rounded p-1 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mx-4 h-px bg-theme-border" />
        <div className="px-4 py-3.5">
          {loading ? (
            <div className="flex items-center gap-2.5 text-theme-muted">
              <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-theme-accent border-t-transparent animate-spin" />
              <span className="font-display italic text-sm">{t('proactiveBrief.loading')}</span>
            </div>
          ) : (
            <div className="text-sm leading-relaxed text-theme-ink">
              <MarkdownRenderer content={brief || ''} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const ProactiveBriefCard = memo(ProactiveBriefCardInner)
