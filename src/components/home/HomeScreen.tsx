import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { CalendarEvent } from '../../types/google'
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
  /** Controlled by useProactiveBrief so dismissal survives home remounts. */
  briefDismissed?: boolean
  onDismissBrief?: () => void
  onRestoreBrief?: () => void
  onBriefAction?: (action: BriefAction, item: BriefItem) => 'task' | 'chat' | null
  conversations?: Conversation[]
  onSelectConv?: (id: string) => void
  onNewConversation?: () => void
  error?: string | null
  onDismissError?: () => void
}

type SecondarySection = 'brief' | 'agenda' | 'recents'
type SuggestionKind = 'summarize' | 'write' | 'translate' | 'explain'

interface HomeSuggestion {
  kind: SuggestionKind
  label: string
  prompt: string
}

function SuggestionIcon({ kind }: { kind: SuggestionKind }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.55,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  if (kind === 'summarize') {
    return <svg {...common}><path d="M6 4h12M6 9h12M6 14h8M6 19h5" /></svg>
  }
  if (kind === 'write') {
    return <svg {...common}><path d="m5 19 3.5-.8L19 7.7 16.3 5 5.8 15.5Z" /><path d="m14.8 6.5 2.7 2.7" /></svg>
  }
  if (kind === 'translate') {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" /></svg>
  }
  return <svg {...common}><path d="M9 18h6M10 21h4" /><path d="M8.5 15.5A7 7 0 1 1 15.5 15.5c-.8.6-1.2 1.1-1.3 1.5h-4.4c-.1-.4-.5-.9-1.3-1.5Z" /></svg>
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

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString()
}

function agendaTime(event: CalendarEvent, locale: string): string {
  if (!event.start.includes('T')) return locale.startsWith('fr') ? 'Toute la journée' : 'All day'
  return new Date(event.start).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
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
  briefDismissed = false,
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
  const [prefill, setPrefill] = useState<ComposerPrefill | undefined>()
  const [calendarPreview, setCalendarPreview] = useState<{ events: CalendarEvent[] | null; error: string | null }>({
    events: null,
    error: null,
  })
  const prefillId = useRef(0)
  const reopenBriefRef = useRef<HTMLButtonElement>(null)
  const briefDetailsRef = useRef<HTMLDetailsElement>(null)
  const agendaDetailsRef = useRef<HTMLDetailsElement>(null)
  const recentsDetailsRef = useRef<HTMLDetailsElement>(null)

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

  const suggestions = useMemo<HomeSuggestion[]>(
    () => [
      { kind: 'summarize', label: t('home.editorial.suggestions.summarize'), prompt: t('home.editorial.suggestions.summarizePrompt') },
      { kind: 'write', label: t('home.editorial.suggestions.write'), prompt: t('home.editorial.suggestions.writePrompt') },
      { kind: 'translate', label: t('home.editorial.suggestions.translate'), prompt: t('home.editorial.suggestions.translatePrompt') },
      { kind: 'explain', label: t('home.editorial.suggestions.explain'), prompt: t('home.editorial.suggestions.explainPrompt') },
    ],
    [t],
  )

  const recentConversations = useMemo(
    () => [...(conversations ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3),
    [conversations],
  )

  const briefCount = useMemo(() => {
    if (!proactiveBrief) return 0
    return 'items' in proactiveBrief ? proactiveBrief.items.length : 1
  }, [proactiveBrief])

  useEffect(() => {
    if (!googleAuth.isConnected) setCalendarPreview({ events: null, error: null })
  }, [googleAuth.isConnected])

  const updateCalendarPreview = useCallback((events: CalendarEvent[], calendarError: string | null) => {
    setCalendarPreview({ events, error: calendarError })
  }, [])

  const todayEvents = useMemo(() => {
    const now = Date.now()
    return (calendarPreview.events ?? [])
      .filter((event) => {
        if (!isToday(event.start)) return false
        if (!event.start.includes('T')) return true
        const end = event.end ? new Date(event.end).getTime() : new Date(event.start).getTime()
        return end >= now
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  }, [calendarPreview.events])

  const imminentEventId = useMemo(() => {
    const next = todayEvents[0]
    if (!next || !next.start.includes('T')) return null
    const deltaMinutes = Math.ceil((new Date(next.start).getTime() - Date.now()) / 60_000)
    return deltaMinutes >= 0 && deltaMinutes <= 30 ? next.id : null
  }, [todayEvents])

  const fillComposer = useCallback((text: string) => {
    prefillId.current += 1
    setPrefill({ id: prefillId.current, text })
  }, [])

  const openSecondary = useCallback((section: SecondarySection) => {
    const element = section === 'brief'
      ? briefDetailsRef.current
      : section === 'agenda'
        ? agendaDetailsRef.current
        : recentsDetailsRef.current
    if (!element) return
    element.open = true
    requestAnimationFrame(() => element.scrollIntoView?.({ behavior: 'smooth', block: 'start' }))
  }, [])

  const dismissBrief = () => {
    onDismissBrief?.()
    requestAnimationFrame(() => reopenBriefRef.current?.focus())
  }

  const reopenBrief = () => {
    onRestoreBrief?.()
    requestAnimationFrame(() => document.getElementById('arty-brief-close')?.focus())
  }

  const openEvent = useCallback(async (event: CalendarEvent) => {
    const url = event.htmlLink || `https://calendar.google.com/calendar/r/eventedit?eid=${encodeURIComponent(event.id)}`
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }, [])

  const recentTitle = recentConversations[0]?.title || t('home.resumeKicker')

  return (
    <div className="flex h-full min-h-0 max-w-full flex-col overflow-x-hidden bg-theme-bg text-theme-ink">
      <TopBar onMenuToggle={onMenuToggle} menuOpen={menuOpen} dateLabel={dateLabel} />

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <main className="mx-auto flex min-h-full min-w-0 w-full max-w-[1060px] flex-col px-[34px] max-[899px]:px-[14px]" aria-labelledby="home-chat-title">
          <section className="flex flex-1 items-center justify-center py-12 max-[639px]:items-start max-[639px]:pb-9 max-[639px]:pt-11">
            <div className="w-full max-w-[760px] text-center">
              <div className="mb-4 flex min-h-6 items-baseline justify-between gap-6 text-left max-[639px]:flex-col max-[639px]:gap-1.5">
                <p className="shrink-0 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-theme-accent-text">
                  {greeting}{firstName ? ` ${firstName}` : ''}
                </p>
                <button
                  type="button"
                  onClick={() => openSecondary('agenda')}
                  className="group/agenda flex min-w-0 max-w-[470px] items-baseline gap-2 bg-transparent text-right font-sans text-[12px] leading-5 text-theme-muted transition-colors hover:text-theme-ink max-[639px]:w-full max-[639px]:max-w-none max-[639px]:text-left"
                  aria-label={t('home.hybrid.agendaOpen')}
                  aria-live="polite"
                >
                  {!googleAuth.isConnected ? (
                    <span className="border-b border-theme-border group-hover/agenda:border-theme-accent">
                      {t('home.hybrid.agendaConnect')} →
                    </span>
                  ) : calendarPreview.error ? (
                    <span>{t('home.hybrid.agendaUnavailable')}</span>
                  ) : calendarPreview.events === null ? (
                    <span>{t('home.hybrid.agendaLoading')}</span>
                  ) : todayEvents.length === 0 ? (
                    <span className="font-display text-[13px] italic">{t('home.hybrid.agendaFree')}</span>
                  ) : (
                    <>
                      {todayEvents.slice(0, 2).map((event, index) => {
                        const isImminent = event.id === imminentEventId
                        const isOngoing = event.start.includes('T')
                          && new Date(event.start).getTime() <= Date.now()
                          && !!event.end
                          && new Date(event.end).getTime() >= Date.now()
                        const minutes = isImminent
                          ? Math.max(1, Math.ceil((new Date(event.start).getTime() - Date.now()) / 60_000))
                          : null
                        return (
                          <span key={event.id} className={index === 1 ? 'hidden min-w-0 items-baseline gap-1 sm:flex' : 'flex min-w-0 items-baseline gap-1'}>
                            {index > 0 && <span className="text-theme-border" aria-hidden="true">·</span>}
                            <time className="shrink-0 tabular-nums text-theme-ink">{agendaTime(event, locale)}</time>
                            <span className="truncate">{event.title}</span>
                            {(isOngoing || (isImminent && minutes !== null)) && (
                              <span className="shrink-0 font-semibold text-theme-accent-text">
                                {isOngoing ? t('home.hybrid.agendaNow') : t('home.hybrid.agendaSoon', { count: minutes ?? 1 })}
                              </span>
                            )}
                          </span>
                        )
                      })}
                      {todayEvents.length > 1 && (
                        <span className="shrink-0 border-b border-theme-border group-hover/agenda:border-theme-accent sm:hidden">
                          +{todayEvents.length - 1}
                        </span>
                      )}
                      {todayEvents.length > 2 && (
                        <span className="hidden shrink-0 border-b border-theme-border group-hover/agenda:border-theme-accent sm:inline">
                          +{todayEvents.length - 2}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </div>
              <h1 id="home-chat-title" className="mb-8 text-balance font-display text-[clamp(44px,6vw,72px)] font-normal leading-[0.99] tracking-[-0.052em] max-[639px]:mb-7 max-[639px]:text-[clamp(40px,12.5vw,57px)]">
                {t('home.hybrid.heroLead')}{' '}
                <em className="font-normal text-theme-accent-text">{t('home.hybrid.heroEmphasis')}</em>&nbsp;?
              </h1>

              {error && (
                <div className="mb-3 flex items-center gap-2 rounded-[18px] border border-red-700/40 bg-red-500/10 px-4 py-2 text-left font-sans text-sm text-red-800 dark:text-red-300" role="alert">
                  <span className="min-w-0 flex-1 break-words">{error}</span>
                  {onDismissError && (
                    <button type="button" onClick={onDismissError} className="min-h-11 min-w-11" aria-label={t('common.close')}>×</button>
                  )}
                </div>
              )}

              <InputBar
                onSend={onSend}
                isStreaming={isStreaming}
                onStop={onStop}
                prefill={prefill}
                showQuickActions={false}
                draftKey="home"
                variant="hero"
              />

              <div className="mt-5 grid w-full grid-cols-4 gap-2 max-[639px]:grid-cols-2" role="group" aria-label={t('home.suggestions.title')}>
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.kind}
                    type="button"
                    onClick={() => fillComposer(suggestion.prompt)}
                    className="flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-full border border-theme-ink/10 bg-white/20 px-3 font-sans text-[13px] text-theme-muted shadow-[0_1px_2px_rgb(var(--theme-ink)/0.025)] transition-[color,background-color,border-color,box-shadow,transform] duration-200 hover:border-theme-accent/30 hover:bg-theme-accent/10 hover:text-theme-accent-text active:scale-[0.98] dark:bg-theme-surface/40 max-[420px]:px-2 max-[420px]:text-xs"
                  >
                    <SuggestionIcon kind={suggestion.kind} />
                    <span className="truncate">{suggestion.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <nav className="flex min-h-[62px] flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t border-theme-ink/10 py-2 font-sans text-xs text-theme-muted max-[639px]:flex-col max-[639px]:gap-0" aria-label={t('home.hybrid.today')}>
            <span className="font-semibold uppercase tracking-[0.1em] text-theme-ink">{t('home.hybrid.today')}</span>
            <button type="button" onClick={() => openSecondary('brief')} className="min-h-11 bg-transparent hover:text-theme-accent-text">
              {t('home.hybrid.briefSummary', { count: briefCount })}
            </button>
            <button type="button" onClick={() => openSecondary('recents')} className="min-h-11 max-w-[260px] truncate bg-transparent hover:text-theme-accent-text">
              {t('home.hybrid.recentSummary', { title: recentTitle })}
            </button>
          </nav>
        </main>

        <section className="mx-auto w-[calc(100%-40px)] max-w-[760px] pb-14 pt-16 max-[639px]:w-[calc(100%-28px)] max-[639px]:pt-12" aria-labelledby="home-secondary-title">
          <h2 id="home-secondary-title" className="mb-6 font-display text-xl font-normal italic text-theme-muted">
            {t('home.hybrid.secondaryIntro')}
          </h2>

          <div className="border-t border-theme-ink/10">
            <details ref={briefDetailsRef} id="home-brief" className="group scroll-mt-4 border-b border-theme-ink/10">
              <summary className="flex min-h-[68px] cursor-pointer list-none items-center justify-between gap-4 rounded-[14px] px-3 py-3 marker:hidden transition-[color,background-color,transform] duration-200 hover:bg-theme-ink/[0.035] active:scale-[0.995]">
                <span className="font-display text-xl font-normal">{t('proactiveBrief.title')}</span>
                <span className="flex items-center gap-3 font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-theme-muted">
                  {briefCount > 0 ? t('home.hybrid.briefMeta', { count: briefCount }) : t('home.hybrid.briefEmptyMeta')}
                  <span className="text-xl font-normal leading-none text-theme-accent-text transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </span>
              </summary>
              <div className="pb-7 pt-1">
                {!briefDismissed ? (
                  <ProactiveBriefCard
                    brief={proactiveBrief ?? null}
                    loading={!!briefLoading}
                    onDismiss={dismissBrief}
                    onAction={onBriefAction ?? (() => null)}
                    isStreaming={isStreaming}
                    variant="plain"
                  />
                ) : (
                  <button
                    ref={reopenBriefRef}
                    type="button"
                    onClick={reopenBrief}
                    className="min-h-11 border-b border-theme-accent bg-transparent font-sans text-xs text-theme-accent-text"
                  >
                    {t('home.editorial.showBrief')} →
                  </button>
                )}
              </div>
            </details>

            <details ref={agendaDetailsRef} id="home-agenda" className="group scroll-mt-4 border-b border-theme-ink/10">
              <summary className="flex min-h-[68px] cursor-pointer list-none items-center justify-between gap-4 rounded-[14px] px-3 py-3 marker:hidden transition-[color,background-color,transform] duration-200 hover:bg-theme-ink/[0.035] active:scale-[0.995]">
                <span className="font-display text-xl font-normal">{t('home.agendaKicker')}</span>
                <span className="flex items-center gap-3 font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-theme-muted">
                  {googleAuth.isConnected ? t('home.hybrid.agendaMeta') : t('home.hybrid.agendaConnectMeta')}
                  <span className="text-xl font-normal leading-none text-theme-accent-text transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </span>
              </summary>
              <div className="pb-7 pt-1">
                {googleAuth.isInitializing ? (
                  <p className="py-3 font-display text-sm italic text-theme-muted" role="status">{t('common.loading')}</p>
                ) : googleAuth.isConnected ? (
                  <>
                    <div className="mb-3"><GoogleStatus isConnected user={googleAuth.user} onLogout={googleAuth.logout} /></div>
                    <CalendarView days={3} onEventClick={openEvent} onEventsChange={updateCalendarPreview} />
                  </>
                ) : (
                  <div>
                    <p className="max-w-xl font-display text-base leading-snug text-theme-muted">{t('home.editorial.calendarDisconnected')}</p>
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
              </div>
            </details>

            <details ref={recentsDetailsRef} id="home-recents" className="group scroll-mt-4 border-b border-theme-ink/10">
              <summary className="flex min-h-[68px] cursor-pointer list-none items-center justify-between gap-4 rounded-[14px] px-3 py-3 marker:hidden transition-[color,background-color,transform] duration-200 hover:bg-theme-ink/[0.035] active:scale-[0.995]">
                <span className="font-display text-xl font-normal">{t('home.resumeKicker')}</span>
                <span className="flex items-center gap-3 font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-theme-muted">
                  {t('home.hybrid.recentsMeta', { count: recentConversations.length })}
                  <span className="text-xl font-normal leading-none text-theme-accent-text transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </span>
              </summary>
              <div className="pb-7 pt-1">
                {recentConversations.length > 0 && onSelectConv ? (
                  <div className="border-t border-theme-ink/10">
                    {recentConversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => onSelectConv(conversation.id)}
                        className="grid min-h-[58px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-theme-ink/10 bg-transparent px-3 py-2 text-left transition-[color,background-color] hover:bg-theme-ink/[0.025] hover:text-theme-accent-text max-[420px]:grid-cols-1 max-[420px]:gap-1"
                      >
                        <strong className="truncate font-display text-[15px] font-normal leading-snug">{conversation.title}</strong>
                        <small className="font-sans text-[11px] text-theme-muted">{relativeDate(conversation.updatedAt, locale)}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div>
                    <p className="font-display text-sm italic text-theme-muted">{t('home.editorial.noRecent')}</p>
                    {onNewConversation && (
                      <button type="button" onClick={onNewConversation} className="mt-3 min-h-11 border-b border-theme-accent bg-transparent font-sans text-xs text-theme-accent-text">
                        {t('home.hybrid.newConversation')} →
                      </button>
                    )}
                  </div>
                )}
              </div>
            </details>
          </div>
        </section>
      </div>
    </div>
  )
}

export const HomeScreen = memo(HomeScreenInner)
