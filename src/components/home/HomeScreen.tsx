import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { TopBar } from '../layout/TopBar'
import { InputBar } from '../layout/InputBar'
import { PrismMark } from '../shared/PrismMark'
import { ProactiveBriefCard } from './ProactiveBriefCard'
import type { BriefItem, BriefAction } from '../../services/proactiveBriefActions'
import { GoogleConnectButton } from '../google/GoogleConnectButton'
import { GoogleStatus } from '../google/GoogleStatus'
import { CalendarView } from '../google/CalendarView'
import { useTooltip } from '../onboarding/Tooltips'
import { cleanDisplayName } from '../../services/displayName'
import type { useGoogleAuth } from '../../hooks/useGoogleAuth'
import type { useGmail } from '../../hooks/useGmail'
import type { useDrive } from '../../hooks/useDrive'
import type { FileAttachment } from '../../types'

interface HomeScreenProps {
  onMenuToggle: () => void
  onSend: (text: string, files?: FileAttachment[]) => void
  isStreaming: boolean
  googleAuth: ReturnType<typeof useGoogleAuth>
  gmail: ReturnType<typeof useGmail>
  drive: ReturnType<typeof useDrive>
  userName?: string
  proactiveBrief?: { items: BriefItem[] } | { text: string } | null
  briefLoading?: boolean
  briefGeneratedAt?: number | null
  onDismissBrief?: () => void
  onRefreshBrief?: () => void
  onBriefAction?: (action: BriefAction, item: BriefItem) => 'task' | 'chat' | null
}

function HomeScreenInner({ onMenuToggle, onSend, isStreaming, googleAuth, userName, proactiveBrief, briefLoading, briefGeneratedAt, onDismissBrief, onRefreshBrief, onBriefAction }: HomeScreenProps) {
  const { t, i18n } = useTranslation()
  const googleTooltip = useTooltip('google')

  // Editorial kicker: "VENDREDI 19 AVRIL · VALENCE" style — locale-aware.
  const kicker = useMemo(() => {
    const locale = i18n.language?.startsWith('en') ? 'en-US' : 'fr-FR'
    return new Date().toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
  }, [i18n.language])

  // Fraunces hero greeting — splits first name for italic treatment.
  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return t('home.greetingMorning')
    if (h < 18) return t('home.greetingAfternoon')
    return t('home.greetingEvening')
  }, [t])

  // Show a first name only when we're sure it reads like one. The shared
  // cleanDisplayName helper strips API key previews, raw emails, and other
  // placeholder values so we never greet "Bonjour sk-ant-api…".
  // Also skip the generic "Utilisateur" placeholder we store for API-key
  // logins — it's fine in the Sidebar footer but not in a hero greeting.
  const firstName = useMemo(() => {
    const cleaned = cleanDisplayName(userName)
    if (!cleaned) return ''
    if (/^utilisateur$/i.test(cleaned) || /^user$/i.test(cleaned)) return ''
    return cleaned
  }, [userName])

  const openEvent = useCallback(async (event: import('../../types/google').CalendarEvent) => {
    const url = event.htmlLink || `https://calendar.google.com/calendar/r/eventedit?eid=${encodeURIComponent(event.id)}`
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
    } catch {
      window.open(url, '_blank')
    }
  }, [])

  // Roadmap UI Phase 1 #1 — Page d'accueil intelligente.
  // Avant : 4 intents codés en dur. 3/4 supposent Google connecté
  // ("Tes mails non lus", "Ce qu'il y a aujourd'hui", "Trouve-moi un créneau")
  // → un user qui n'a pas connecté Google clique l'intent, l'IA répond
  // "je n'ai pas accès à tes mails" et l'utilisateur ferme l'app.
  // Maintenant : si Google connecté → intents Google. Sinon → intents
  // polyvalents universels (résumé, traduction, rédaction, explication).
  const intents = googleAuth.isConnected
    ? [
        t('home.intents.unreadEmails'),
        t('home.intents.today'),
        t('home.intents.schedule'),
        t('home.intents.useful'),
      ]
    : [
        t('home.intents.summarize'),
        t('home.intents.translate'),
        t('home.intents.writeEmail'),
        t('home.intents.explain'),
      ]

  return (
    <div className="flex flex-col h-full bg-theme-bg text-theme-ink">
      <TopBar onMenuToggle={onMenuToggle} />

      <div className="flex-1 overflow-y-auto">
        {/* Masthead — editorial kicker + brand mark */}
        <div className="px-6 pt-4 pb-2 flex items-center justify-between">
          <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
            {kicker}
          </span>
          <PrismMark size={22} color="rgb(var(--theme-ink))" />
        </div>
        {/* Editorial double rule */}
        <div className="mx-6 h-[2px] bg-theme-ink" />
        <div className="mx-6 mt-[3px] h-px bg-theme-ink" />

        {/* Hero */}
        <div className="px-6 pt-6 pb-2 max-w-2xl">
          <h1 className="font-display font-medium text-[40px] leading-[0.98] -tracking-[0.03em] text-theme-ink">
            {greeting}
            {firstName && (
              <>
                <br />
                <span className="italic">{firstName}</span>
                <span className="text-theme-accent">.</span>
              </>
            )}
          </h1>
        </div>

        {/* Google connect (only when not connected) */}
        {!googleAuth.isConnected && (
          <div className="px-6 pt-5 max-w-md">
            <GoogleConnectButton
              onConnect={googleAuth.login}
              isLoading={googleAuth.isLoading}
            />
            <div className="relative">
              <googleTooltip.TooltipComponent />
            </div>
            {googleAuth.error && (
              <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="font-sans text-xs text-red-700 dark:text-red-400 font-semibold">{t('home.googleConnectError')}</p>
                <p className="font-sans text-xs text-red-600 dark:text-red-300/80 mt-1 break-words">{googleAuth.error}</p>
              </div>
            )}
          </div>
        )}

        {googleAuth.isConnected && (
          <div className="px-6 pt-4">
            <GoogleStatus
              isConnected={googleAuth.isConnected}
              user={googleAuth.user}
              onLogout={googleAuth.logout}
            />
          </div>
        )}

        {/* Proactive brief — auto-generated on app open/resume (read-only,
            Haiku, deduped). Renders here on the Home screen. */}
        <ProactiveBriefCard
          brief={proactiveBrief ?? null}
          loading={!!briefLoading}
          generatedAt={briefGeneratedAt ?? null}
          onDismiss={onDismissBrief ?? (() => {})}
          onRefresh={onRefreshBrief ?? (() => {})}
          onAction={onBriefAction ?? (() => null)}
          isStreaming={isStreaming}
        />

        {/* Discover — one click sends a capabilities summary prompt through the
            normal chat pipeline. Shown to everyone (no Google needed): it's an
            overview of what Arty can do, with concrete example requests. */}
        <div className="px-6 pt-7 max-w-3xl">
          <button
            onClick={() => onSend(t('home.discover.prompt'))}
            disabled={isStreaming}
            aria-label={t('home.discover.label')}
            className="group w-full flex items-center gap-3.5 rounded-[14px] px-4 py-3.5 text-left transition-transform hover:-translate-y-[1px] disabled:opacity-50 disabled:hover:translate-y-0"
            style={{
              background: 'linear-gradient(150deg, rgb(var(--theme-accent)) 0%, rgb(var(--theme-accent) / 0.82) 100%)',
              color: '#1C0E06',
              boxShadow: '0 6px 24px rgba(245,154,75,0.22), 0 1px 0 rgba(255,255,255,0.12) inset',
            }}
          >
            <PrismMark size={22} fill color="#1C0E06" />
            <span className="flex-1 min-w-0">
              <span className="block font-display font-medium text-[16px] leading-tight">{t('home.discover.label')}</span>
              <span className="block font-sans text-[11px] leading-snug opacity-75 mt-0.5">{t('home.discover.description')}</span>
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1C0E06" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform group-hover:translate-x-0.5">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        {/* Two-up: Agenda + Intentions — editorial grid */}
        <div className="px-6 pt-8 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-3xl">
          {/* Agenda (only when Google connected) */}
          {googleAuth.isConnected && (
            <section>
              <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
                {t('home.agendaKicker')}
              </span>
              <div className="border-t border-theme-ink mt-1.5 pt-3">
                <CalendarView days={7} onEventClick={openEvent} />
              </div>
            </section>
          )}

          {/* Intentions — suggestion quotes */}
          <section className={googleAuth.isConnected ? '' : 'sm:col-span-2'}>
            <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
              {t('home.intentionsKicker')}
            </span>
            <ul className="border-t border-theme-ink mt-1.5 pt-3 flex flex-col gap-2.5">
              {intents.map((intent) => (
                <li key={intent}>
                  <button
                    onClick={() => onSend(intent)}
                    className="block w-full text-left font-display italic text-[13px] leading-[1.25] text-theme-ink border-l-2 border-theme-accent pl-2 py-0.5 hover:bg-theme-accent/5 transition-colors"
                  >
                    « {intent} »
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <InputBar onSend={onSend} isStreaming={isStreaming} />
    </div>
  )
}

export const HomeScreen = memo(HomeScreenInner)
