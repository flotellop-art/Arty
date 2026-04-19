import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TopBar } from '../layout/TopBar'
import { InputBar } from '../layout/InputBar'
import { GoogleConnectButton } from '../google/GoogleConnectButton'
import { GoogleStatus } from '../google/GoogleStatus'
import { CalendarView } from '../google/CalendarView'
import { useTooltip } from '../onboarding/Tooltips'
import { Tag, Rule } from '../shared/editorial'
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
  onOpenBrief?: () => void
}

function firstName(userName?: string, googleName?: string) {
  const raw = userName || googleName || ''
  const first = raw.split(/\s+/)[0] || raw
  return first.trim() || null
}

function dateTag(lang: string) {
  const now = new Date()
  const weekday = now.toLocaleDateString(lang, { weekday: 'long' })
  const day = now.getDate()
  const month = now.toLocaleDateString(lang, { month: 'long' })
  return `${weekday} ${day} ${month}`.toLocaleUpperCase(lang)
}

function greetingKey() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}

function HomeScreenInner({ onMenuToggle, onSend, isStreaming, googleAuth, userName, onOpenBrief }: HomeScreenProps) {
  const { t, i18n } = useTranslation()
  const googleTooltip = useTooltip('google')
  const lang = i18n.language || 'fr'
  const fname = firstName(userName, googleAuth.user?.name)

  const openEvent = useCallback(async (event: import('../../types/google').CalendarEvent) => {
    const url = event.htmlLink || `https://calendar.google.com/calendar/r/eventedit?eid=${encodeURIComponent(event.id)}`
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
    } catch {
      window.open(url, '_blank')
    }
  }, [])

  const greetings = {
    morning: { fr: 'Bonjour', en: 'Good morning' },
    afternoon: { fr: 'Bon après-midi', en: 'Good afternoon' },
    evening: { fr: 'Bonsoir', en: 'Good evening' },
  } as const
  const g = greetings[greetingKey()][lang === 'en' ? 'en' : 'fr']

  const suggestions = [
    t('home.suggestions.unreadEmails'),
    t('home.suggestions.calendarToday'),
    t('home.suggestions.calendarWeek'),
    t('home.suggestions.createEvent'),
  ]

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--arty-bg)', color: 'var(--arty-ink)' }}>
      <TopBar onMenuToggle={onMenuToggle} onHistoryToggle={onMenuToggle} />

      <div className="flex-1 overflow-y-auto">
        {/* Masthead — journal style */}
        <div className="px-5 pt-3 pb-2 flex items-center justify-between">
          <Tag>{dateTag(lang)}</Tag>
          <Tag>◈ arty</Tag>
        </div>
        <Rule className="mx-5" />

        {/* Hero greeting */}
        <div className="px-5 pt-6 pb-2">
          <h1 className="font-display text-[40px] leading-[0.98] font-light tracking-[-0.03em] text-ink">
            {g}
            {fname && (
              <>
                <br />
                <span className="italic">{fname}</span>
              </>
            )}
            <span style={{ color: 'var(--arty-accent)' }}>.</span>
          </h1>
          <p className="font-serif italic mt-2 text-[16px] leading-[1.4] text-muted">
            {googleAuth.isConnected
              ? t('home.subtitle.connected', { defaultValue: 'Ton agenda, tes mails, tes pensées — tout ici.' })
              : t('home.subtitle.idle', { defaultValue: 'Pose ta question, Arty écoute.' })}
          </p>
        </div>

        {/* Brief card — the "feature article" */}
        {googleAuth.isConnected && (
          <button
            type="button"
            onClick={onOpenBrief}
            className="group relative mx-5 mt-5 block w-auto text-left"
            style={{
              backgroundColor: 'var(--arty-card)',
              border: '1px solid var(--arty-line)',
              borderRadius: 2,
              boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
              padding: 18,
              width: 'calc(100% - 40px)',
            }}
          >
            <Tag accent>◈ {t('home.brief.kicker', { defaultValue: 'Le brief du matin' })}</Tag>
            <h2 className="font-display text-[22px] leading-[1.15] font-medium mt-2">
              {t('home.brief.headline', { defaultValue: "Aujourd'hui en un coup d'œil," })}{' '}
              <span className="italic" style={{ color: 'var(--arty-accent)' }}>
                {t('home.brief.italic', { defaultValue: 'agenda, mails, priorités.' })}
              </span>
            </h2>
            <span
              className="absolute top-4 right-4 font-serif italic text-[13px]"
              style={{ color: 'var(--arty-accent)' }}
            >
              {t('home.brief.cta', { defaultValue: 'lire →' })}
            </span>
          </button>
        )}

        {/* Google connect (only if not connected) */}
        {!googleAuth.isConnected && (
          <div className="px-5 pt-6 flex flex-col gap-2 items-center">
            <GoogleConnectButton onConnect={googleAuth.login} isLoading={googleAuth.isLoading} />
            <div className="relative">
              <googleTooltip.TooltipComponent />
            </div>
            {googleAuth.error && <p className="text-xs text-red-500">{googleAuth.error}</p>}
          </div>
        )}

        {googleAuth.isConnected && (
          <div className="px-5 pt-2">
            <GoogleStatus isConnected user={googleAuth.user} onLogout={googleAuth.logout} />
          </div>
        )}

        {/* Two-up: Agenda | Intentions */}
        <div className="px-5 pt-6 pb-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          {googleAuth.isConnected && (
            <section>
              <Tag>{t('home.calendar.title')}</Tag>
              <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--arty-ink)' }}>
                <CalendarView days={7} onEventClick={openEvent} />
              </div>
            </section>
          )}

          <section>
            <Tag>{t('home.suggestions.title')}</Tag>
            <div
              className="mt-2 pt-3 flex flex-col gap-3"
              style={{ borderTop: '1px solid var(--arty-ink)' }}
            >
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => onSend(s)}
                  disabled={isStreaming}
                  className="text-left font-serif italic text-[14px] leading-[1.3] cursor-pointer disabled:opacity-50"
                  style={{
                    color: 'var(--arty-ink)',
                    borderLeft: '2px solid var(--arty-accent)',
                    paddingLeft: 10,
                  }}
                >
                  « {s} »
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="h-4" />
      </div>

      <InputBar onSend={onSend} isStreaming={isStreaming} />
    </div>
  )
}

export const HomeScreen = memo(HomeScreenInner)
