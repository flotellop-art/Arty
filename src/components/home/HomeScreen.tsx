import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TopBar } from '../layout/TopBar'
import { InputBar, type ComposerPrefill } from '../layout/InputBar'
import { ProactiveBriefCard } from './ProactiveBriefCard'
import type { BriefAction, BriefItem } from '../../services/proactiveBriefActions'
import { GoogleConnectButton } from '../google/GoogleConnectButton'
import { GoogleStatus } from '../google/GoogleStatus'
import { CalendarView } from '../google/CalendarView'
import { useTooltip } from '../onboarding/Tooltips'
import { cleanDisplayName } from '../../services/displayName'
import type { useGoogleAuth } from '../../hooks/useGoogleAuth'
import type { useDrive } from '../../hooks/useDrive'
import type { ChatSendHandler, Conversation } from '../../types'
import { isPublicGoogleOAuthProfileEnabled } from '../../services/publicGoogleOAuthProfile'

interface HomeScreenProps {
  onMenuToggle: () => void
  menuOpen?: boolean
  onSend: ChatSendHandler
  isStreaming: boolean
  onStop?: () => void
  googleAuth: ReturnType<typeof useGoogleAuth>
  drive: ReturnType<typeof useDrive>
  userName?: string
  proactiveBrief?: { items: BriefItem[] } | { text: string } | null
  briefLoading?: boolean
  onDismissBrief?: () => void
  onRestoreBrief?: () => void
  onBriefAction?: (action: BriefAction, item: BriefItem) => 'task' | 'chat' | null
  conversations?: Conversation[]
  onSelectConv?: (id: string) => void
  onNewConversation?: () => void
  error?: string | null
  onDismissError?: () => void
}

interface Intention {
  title: string
  subtitle: string
  prompt: string
}

function relativeDate(timestamp: number, locale: string): string {
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const abs = Math.abs(deltaSeconds)
  if (abs < 60) return formatter.format(0, 'second')
  if (abs < 3600) return formatter.format(Math.round(deltaSeconds / 60), 'minute')
  if (abs < 86_400) return formatter.format(Math.round(deltaSeconds / 3600), 'hour')
  if (abs < 604_800) return formatter.format(Math.round(deltaSeconds / 86_400), 'day')
  return new Date(timestamp).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

function HomeScreenInner({
  onMenuToggle,
  menuOpen = false,
  onSend,
  isStreaming,
  onStop,
  googleAuth,
  userName,
  proactiveBrief,
  briefLoading,
  onDismissBrief,
  onRestoreBrief,
  onBriefAction,
  conversations,
  onSelectConv,
  onNewConversation,
  error,
  onDismissError,
}: HomeScreenProps) {
  const { t, i18n } = useTranslation()
  const noCasaPhase0 = isPublicGoogleOAuthProfileEnabled()
  const googleTooltip = useTooltip(noCasaPhase0 ? 'googleNoCasa' : 'google')
  const [briefVisible, setBriefVisible] = useState(true)
  const [prefill, setPrefill] = useState<ComposerPrefill | undefined>()
  const prefillId = useRef(0)
  const reopenBriefRef = useRef<HTMLButtonElement>(null)

  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'fr-FR'
  const dateLabel = useMemo(
    () =>
      new Date().toLocaleDateString(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [locale],
  )

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 12) return t('home.greetingMorning')
    if (hour < 18) return t('home.greetingAfternoon')
    return t('home.greetingEvening')
  }, [t])

  const firstName = useMemo(() => {
    const cleaned = cleanDisplayName(userName)
    if (!cleaned || /^(utilisateur|user)$/i.test(cleaned)) return ''
    return cleaned
  }, [userName])

  const intentions = useMemo<Intention[]>(
    () => [
      {
        title: t('home.editorial.intentions.prepare.title'),
        subtitle: t('home.editorial.intentions.prepare.subtitle'),
        prompt: t('home.editorial.intentions.prepare.prompt'),
      },
      {
        title: t('home.editorial.intentions.structure.title'),
        subtitle: t('home.editorial.intentions.structure.subtitle'),
        prompt: t('home.editorial.intentions.structure.prompt'),
      },
      {
        title: t('home.editorial.intentions.analyze.title'),
        subtitle: t('home.editorial.intentions.analyze.subtitle'),
        prompt: t('home.editorial.intentions.analyze.prompt'),
      },
      {
        title: t('home.editorial.intentions.imagine.title'),
        subtitle: t('home.editorial.intentions.imagine.subtitle'),
        prompt: t('home.editorial.intentions.imagine.prompt'),
      },
    ],
    [t],
  )

  const suggestions = useMemo(
    () => [
      { label: t('home.editorial.suggestions.summarize'), prompt: t('home.editorial.suggestions.summarizePrompt') },
      { label: t('home.editorial.suggestions.write'), prompt: t('home.editorial.suggestions.writePrompt') },
      { label: t('home.editorial.suggestions.translate'), prompt: t('home.editorial.suggestions.translatePrompt') },
      { label: t('home.editorial.suggestions.explain'), prompt: t('home.editorial.suggestions.explainPrompt') },
    ],
    [t],
  )

  const recentConversations = useMemo(
    () => [...(conversations ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3),
    [conversations],
  )

  const fillComposer = useCallback((text: string) => {
    prefillId.current += 1
    setPrefill({ id: prefillId.current, text })
  }, [])

  const dismissBrief = () => {
    onDismissBrief?.()
    setBriefVisible(false)
    requestAnimationFrame(() => reopenBriefRef.current?.focus())
  }

  const reopenBrief = () => {
    onRestoreBrief?.()
    setBriefVisible(true)
    requestAnimationFrame(() => document.getElementById('arty-brief-close')?.focus())
  }

  const openEvent = useCallback(async (event: import('../../types/google').CalendarEvent) => {
    const url = event.htmlLink || `https://calendar.google.com/calendar/r/eventedit?eid=${encodeURIComponent(event.id)}`
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-theme-bg text-theme-ink">
      <TopBar onMenuToggle={onMenuToggle} menuOpen={menuOpen} dateLabel={dateLabel} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1060px] px-[34px] pb-6 pt-[22px] max-[900px]:px-[14px] max-[900px]:pt-5">
          <header className="mb-[18px]">
            <h1 className="font-display text-[32px] font-normal leading-[1.05] tracking-[-0.02em] max-[900px]:text-[28px]">
              {greeting}{firstName ? ' ' : ''}
              {firstName && <em className="font-normal text-theme-accent-text">{firstName}</em>}.
            </h1>
            <p className="mt-1 font-sans text-[13.6px] leading-snug text-theme-muted">
              {t('home.editorial.subtitle')}
            </p>
          </header>

          {briefVisible ? (
            <ProactiveBriefCard
              brief={proactiveBrief ?? null}
              loading={!!briefLoading}
              onDismiss={dismissBrief}
              onAction={onBriefAction ?? (() => null)}
              isStreaming={isStreaming}
            />
          ) : (
            <button
              ref={reopenBriefRef}
              type="button"
              onClick={reopenBrief}
              className="mb-[14px] min-h-11 border border-theme-ink bg-transparent px-4 py-2 font-sans text-xs hover:bg-theme-ink hover:text-theme-bg"
            >
              {t('home.editorial.showBrief')}
            </button>
          )}

          <section className="mb-[18px] grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 border-b border-theme-border border-t-2 border-t-theme-ink py-[10px] max-[900px]:grid-cols-1">
            <h2 className="font-sans text-[11.5px] font-bold uppercase tracking-[0.16em]">
              {t('home.discover.label')}
            </h2>
            <p className="font-display text-[13.6px] italic leading-snug text-theme-muted">
              {t('home.editorial.discoverDescription')}
            </p>
            <button
              type="button"
              onClick={() => fillComposer(t('home.discover.prompt'))}
              className="min-h-11 border border-theme-ink bg-transparent px-[14px] py-[7px] font-sans text-xs hover:bg-theme-ink hover:text-theme-bg max-[900px]:mt-1 max-[900px]:w-full"
            >
              {t('home.editorial.explore')} →
            </button>
          </section>

          <div className="mb-[18px] grid grid-cols-3 gap-[14px] max-[900px]:grid-cols-1">
            <section className="border border-theme-border p-[14px]" aria-labelledby="home-agenda-title">
              <h2 id="home-agenda-title" className="mb-[10px] border-b border-theme-border pb-2 font-sans text-[11.2px] font-bold uppercase tracking-[0.14em]">
                <span className="mr-1 text-theme-accent-text">01</span> {t('home.agendaKicker')}
              </h2>
              {googleAuth.isInitializing ? (
                <p className="py-3 font-display text-sm italic text-theme-muted" role="status">{t('common.loading')}</p>
              ) : googleAuth.isConnected ? (
                <>
                  <div className="mb-2"><GoogleStatus isConnected user={googleAuth.user} onLogout={googleAuth.logout} /></div>
                  <CalendarView days={1} onEventClick={openEvent} />
                </>
              ) : (
                <div className="py-1">
                  <p className="font-display text-sm leading-snug text-theme-muted">{t('home.editorial.calendarDisconnected')}</p>
                  {googleAuth.reconsentRequired && (
                    <p className="mt-2 font-sans text-xs text-theme-accent-text" role="status">{t('home.googleReconsent.body')}</p>
                  )}
                  <div className="mt-3">
                    <GoogleConnectButton
                      onConnect={googleAuth.login}
                      isLoading={googleAuth.isLoading}
                      label={googleAuth.reconsentRequired ? t('home.googleReconsent.cta') : undefined}
                    />
                  </div>
                  <div className="relative"><googleTooltip.TooltipComponent /></div>
                  {googleAuth.error && <p className="mt-2 break-words font-sans text-xs text-theme-accent-text" role="alert">{googleAuth.error}</p>}
                </div>
              )}
            </section>

            <section className="border border-theme-border" aria-labelledby="home-intentions-title">
              <div className="flex items-center justify-between border-b border-theme-border px-[14px] pb-[11px] pt-[14px] max-[420px]:px-[10px] max-[420px]:pb-[10px] max-[420px]:pt-[13px]">
                <h2 id="home-intentions-title" className="font-display text-[24.8px] font-normal leading-none tracking-[-0.025em]">
                  {t('home.intentionsKicker')}
                </h2>
                <span className="font-sans text-[10px] tracking-[0.08em] text-theme-accent-text">02</span>
              </div>
              <div className="grid grid-cols-2 gap-2 px-[14px] pb-[14px] max-[420px]:gap-[7px] max-[420px]:px-[10px] max-[420px]:pb-3 max-[339px]:grid-cols-1">
                {intentions.map((intention) => (
                  <button
                    key={intention.title}
                    type="button"
                    onClick={() => fillComposer(intention.prompt)}
                    className="flex min-h-[84px] flex-col justify-between border border-theme-border bg-transparent px-3 py-[11px] text-left hover:border-theme-accent hover:text-theme-accent-text max-[420px]:min-h-[90px] max-[420px]:p-[10px]"
                  >
                    <strong className="font-display text-base font-normal leading-[1.15] max-[420px]:text-[15.36px]">{intention.title}</strong>
                    <span className="font-sans text-[10.88px] leading-[1.35] text-theme-muted">{intention.subtitle} →</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="border border-theme-border p-[14px]" aria-labelledby="home-resume-title">
              <h2 id="home-resume-title" className="mb-[2px] border-b border-theme-border pb-2 font-sans text-[11.2px] font-bold uppercase tracking-[0.14em]">
                <span className="mr-1 text-theme-accent-text">03</span> {t('home.resumeKicker')}
              </h2>
              {recentConversations.length > 0 && onSelectConv ? (
                recentConversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => onSelectConv(conversation.id)}
                    className="block min-h-11 w-full border-b border-theme-border bg-transparent py-2 text-left hover:text-theme-accent-text"
                  >
                    <strong className="block font-display text-[13.12px] font-normal leading-snug">{conversation.title}</strong>
                    <small className="mt-0.5 block font-sans text-[10.88px] text-theme-muted">{relativeDate(conversation.updatedAt, locale)}</small>
                  </button>
                ))
              ) : (
                <div className="py-3">
                  <p className="font-display text-sm italic text-theme-muted">{t('home.editorial.noRecent')}</p>
                  {onNewConversation && (
                    <button type="button" onClick={onNewConversation} className="mt-3 min-h-11 border border-theme-ink px-3 py-2 font-sans text-xs hover:bg-theme-ink hover:text-theme-bg">
                      {t('sidebar.newConversation')}
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label={t('home.suggestions.title')}>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => fillComposer(suggestion.prompt)}
                className="min-h-11 border border-theme-ink bg-transparent px-[14px] py-1.5 font-display text-xs hover:border-theme-ink hover:bg-theme-ink hover:text-theme-bg"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-auto mb-2 flex w-[calc(100%-28px)] max-w-[992px] items-center gap-2 border border-red-700 bg-red-500/10 px-4 py-2 font-sans text-sm text-red-800 dark:text-red-300" role="alert">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          {onDismissError && <button type="button" onClick={onDismissError} className="min-h-11 min-w-11" aria-label={t('common.close')}>×</button>}
        </div>
      )}

      <InputBar
        onSend={onSend}
        isStreaming={isStreaming}
        onStop={onStop}
        prefill={prefill}
        showQuickActions={false}
        draftKey="home"
      />
    </div>
  )
}

export const HomeScreen = memo(HomeScreenInner)
