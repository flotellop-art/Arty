import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GmailSearchPayload } from '../../types'
import {
  copyGmailSearch,
  copyThenOpenGmail,
  validateGmailSearchQuery,
} from '../../services/gmailSearchHandoff'
import { AssistantAvatar } from '../chat/AssistantAvatar'
import { PrismMark } from '../shared/PrismMark'

interface GmailSearchCardProps {
  content: string
  payload: GmailSearchPayload
  onQueryChange?: (query: string) => void
}

type Status = 'idle' | 'copying' | 'copied' | 'opening' | 'invalid' | 'copy_error' | 'open_error'

function GmailSearchCardInner({ content, payload, onQueryChange }: GmailSearchCardProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState(payload.query)
  const [status, setStatus] = useState<Status>('idle')
  const expired = payload.expiresAt <= Date.now()
  const busy = status === 'copying' || status === 'opening'
  const isValid = useMemo(
    () => validateGmailSearchQuery(query.trim(), query.trim()),
    [query],
  )

  const validate = useCallback(() => {
    if (expired || !isValid) {
      setStatus('invalid')
      return false
    }
    return true
  }, [expired, isValid])

  const handleCopy = useCallback(async () => {
    if (!validate()) return
    onQueryChange?.(query.trim())
    setStatus('copying')
    try {
      await copyGmailSearch(query.trim())
      setStatus('copied')
    } catch {
      setStatus('copy_error')
    }
  }, [onQueryChange, query, validate])

  const handleOpen = useCallback(async () => {
    if (!validate()) return
    onQueryChange?.(query.trim())
    setStatus('opening')
    try {
      // Invariant P0 : la copie doit réussir avant toute navigation.
      await copyThenOpenGmail(query.trim())
      setStatus('copied')
    } catch (error) {
      setStatus(error instanceof Error && error.message === 'gmail_open_failed' ? 'open_error' : 'copy_error')
    }
  }, [onQueryChange, query, validate])

  const statusText = expired
    ? t('gmailSearch.status.expired')
    : status === 'copying'
      ? t('gmailSearch.status.copying')
      : status === 'copied'
        ? t('gmailSearch.status.copied')
        : status === 'opening'
          ? t('gmailSearch.status.opening')
          : status === 'invalid'
            ? t('gmailSearch.status.invalid')
            : status === 'copy_error'
              ? t('gmailSearch.status.copyError')
              : status === 'open_error'
                ? t('gmailSearch.status.openError')
                : t('gmailSearch.status.ready')

  return (
    <div className="group/bubble relative mb-6 flex gap-2.5">
      <AssistantAvatar />
      <div className="w-full max-w-[92%] text-theme-ink">
        <p className="mb-3 font-display text-[15px] leading-relaxed">{content}</p>

        <section
          className="overflow-hidden rounded-[14px] border border-theme-border bg-theme-surface shadow-sm"
          aria-label={t('gmailSearch.title')}
        >
          <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-3.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-theme-accent/10">
                <PrismMark size={17} color="rgb(var(--theme-accent))" />
              </span>
              <div className="min-w-0">
                <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
                  {t('gmailSearch.kicker')}
                </p>
                <h3 className="truncate font-display text-[17px] leading-tight">{t('gmailSearch.title')}</h3>
              </div>
            </div>
            <span className="shrink-0 rounded-pill border border-theme-accent/25 bg-theme-accent/10 px-2 py-1 font-sans text-[9px] font-semibold uppercase tracking-kicker text-theme-accent">
              {t('gmailSearch.noGlobalAccess')}
            </span>
          </header>

          <div className="mx-4 h-px bg-theme-border" />

          <div className="space-y-3 px-4 py-3.5">
            <label className="block">
              <span className="mb-1.5 block font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
                {t('gmailSearch.queryLabel')}
              </span>
              <textarea
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setStatus('idle')
                }}
                onBlur={() => {
                  if (isValid && !expired) onQueryChange?.(query.trim())
                }}
                rows={3}
                maxLength={500}
                spellCheck={false}
                className="w-full resize-y rounded-sm border border-theme-border bg-theme-bg px-3 py-2.5 font-mono text-[13px] leading-relaxed text-theme-ink outline-none transition-colors focus:border-theme-accent"
              />
            </label>

            {payload.assumptions.length > 0 && (
              <div className="border-l-2 border-theme-accent/40 pl-3 font-sans text-[11px] leading-relaxed text-theme-muted">
                {payload.assumptions.map((assumption) => (
                  <p key={`${assumption.kind}:${assumption.label}`}>
                    {t('gmailSearch.assumption', { value: assumption.label })}
                  </p>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleOpen}
                disabled={busy || expired || !isValid}
                className="rounded-sm bg-theme-accent px-3.5 py-2 font-sans text-[11px] font-semibold text-theme-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('gmailSearch.open')}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={busy || expired || !isValid}
                className="rounded-sm border border-theme-border px-3.5 py-2 font-sans text-[11px] font-semibold text-theme-ink transition-colors hover:border-theme-accent hover:text-theme-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('gmailSearch.copy')}
              </button>
            </div>

            <p
              className={`font-sans text-[11px] ${
                status === 'copy_error' || status === 'open_error' || status === 'invalid' || expired
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-theme-muted'
              }`}
              aria-live="polite"
            >
              {statusText}
            </p>
          </div>

          <footer className="border-t border-theme-border bg-theme-ink/[0.025] px-4 py-3">
            <p className="font-sans text-[11px] leading-relaxed text-theme-muted">
              {t('gmailSearch.instructions')}
            </p>
            <p className="mt-2 flex items-center gap-1.5 font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-accent">
              <span aria-hidden>✓</span>
              {t('gmailSearch.privacy')}
            </p>
          </footer>
        </section>
      </div>
    </div>
  )
}

export const GmailSearchCard = memo(GmailSearchCardInner)
