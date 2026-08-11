import { useTranslation } from 'react-i18next'
import { GoogleSignInButton } from '../auth/GoogleSignInButton'

interface GoogleConnectButtonProps {
  onConnect: () => void
  isLoading: boolean
  label?: string
}

export function GoogleConnectButton({ onConnect, isLoading, label }: GoogleConnectButtonProps) {
  const { t } = useTranslation()
  return (
    <GoogleSignInButton
      onClick={onConnect}
      disabled={isLoading}
      label={isLoading ? t('common.connecting') : (label || t('login.google.signIn'))}
    />
  )
}
