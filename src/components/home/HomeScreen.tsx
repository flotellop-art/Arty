import { memo, useCallback } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AnimatedStar } from './AnimatedStar'
import { TopBar } from '../layout/TopBar'
import { InputBar } from '../layout/InputBar'
import { GoogleConnectButton } from '../google/GoogleConnectButton'
import { GoogleStatus } from '../google/GoogleStatus'
import { CalendarView } from '../google/CalendarView'
import { useTooltip } from '../onboarding/Tooltips'
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
}

function HomeScreenInner({ onMenuToggle, onSend, isStreaming, googleAuth }: HomeScreenProps) {
  const { t } = useTranslation()
  const googleTooltip = useTooltip('google')

  const openEvent = useCallback(async (event: import('../../types/google').CalendarEvent) => {
    const url = event.htmlLink || `https://calendar.google.com/calendar/r/eventedit?eid=${encodeURIComponent(event.id)}`
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
    } catch {
      window.open(url, '_blank')
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      <TopBar onMenuToggle={onMenuToggle} onHistoryToggle={onMenuToggle} />

      <div className="flex-1 overflow-y-auto flex flex-col items-center px-6 pb-4 gap-5">
        <div className="flex flex-col items-center gap-5 pt-6">
          <AnimatedStar />

          <h1 className="font-serif text-2xl md:text-3xl font-semibold text-bubble-user text-center leading-snug">
            {t('home.title')}
          </h1>

          <p className="text-xs text-gray-400 text-center">
            <Trans
              i18nKey="home.hintHelp"
              components={[<span className="font-mono bg-gray-100 px-1 rounded" />]}
            />
          </p>
        </div>

        {/* Google connection */}
        <div className="relative w-full max-w-md flex flex-col items-center gap-2">
          {googleAuth.isConnected ? (
            <GoogleStatus
              isConnected={googleAuth.isConnected}
              user={googleAuth.user}
              onLogout={googleAuth.logout}
            />
          ) : (
            <>
              <GoogleConnectButton
                onConnect={googleAuth.login}
                isLoading={googleAuth.isLoading}
              />
              <div className="relative">
                <googleTooltip.TooltipComponent />
              </div>
            </>
          )}
          {googleAuth.error && (
            <p className="text-xs text-red-500">{googleAuth.error}</p>
          )}
        </div>

        {/* Agenda preview (only when Google connected) */}
        {googleAuth.isConnected && (
          <div className="w-full max-w-md flex flex-col gap-4">
            <section className="flex flex-col gap-2">
              <h2 className="text-xs uppercase tracking-wider text-gray-400">
                {t('home.calendar.title')}
              </h2>
              <CalendarView days={7} onEventClick={openEvent} />
            </section>
          </div>
        )}
      </div>

      <InputBar onSend={onSend} isStreaming={isStreaming} />
    </div>
  )
}

export const HomeScreen = memo(HomeScreenInner)
