import { Trans, useTranslation } from 'react-i18next'
import { AnimatedStar } from './AnimatedStar'
import { TopBar } from '../layout/TopBar'
import { InputBar } from '../layout/InputBar'
import { GoogleConnectButton } from '../google/GoogleConnectButton'
import { GoogleStatus } from '../google/GoogleStatus'
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

export function HomeScreen({ onMenuToggle, onSend, isStreaming, googleAuth }: HomeScreenProps) {
  const { t } = useTranslation()
  const googleTooltip = useTooltip('google')

  return (
    <div className="flex flex-col h-full">
      <TopBar onMenuToggle={onMenuToggle} onHistoryToggle={onMenuToggle} />

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-4 gap-5">
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
      </div>

      <InputBar onSend={onSend} isStreaming={isStreaming} />
    </div>
  )
}
