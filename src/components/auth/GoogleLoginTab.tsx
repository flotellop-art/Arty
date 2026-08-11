import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { buildOAuthUrl } from '../../services/googleAuth'
import { isPublicGoogleOAuthProfileEnabled } from '../../services/publicGoogleOAuthProfile'
import { GoogleSignInButton } from './GoogleSignInButton'

// Native Google Sign-In plugin (defined in Java)
interface GoogleSignInNativePlugin {
  signIn(): Promise<{ email: string; name: string; avatar: string; serverAuthCode: string }>
  signOut(): Promise<void>
}

const GoogleSignInNative = registerPlugin<GoogleSignInNativePlugin>('GoogleSignInNative')

interface GoogleLoginTabProps {
  loading: boolean
  onNativeGoogleLogin?: (email: string, name: string, avatar: string, serverAuthCode: string) => void
}

export function GoogleLoginTab({ loading, onNativeGoogleLogin }: GoogleLoginTabProps) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const noCasaPhase0 = isPublicGoogleOAuthProfileEnabled()

  const handleGoogleLogin = async () => {
    setError('')
    try {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() !== 'android') {
        setError(t('login.google.iosUnavailable'))
        return
      }
      if (Capacitor.isNativePlatform() && onNativeGoogleLogin) {
        const result = await GoogleSignInNative.signIn()
        onNativeGoogleLogin(
          result.email,
          result.name || result.email?.split('@')[0] || '',
          result.avatar || '',
          result.serverAuthCode
        )
      } else {
        // Web: redirect to Google OAuth
        const url = await buildOAuthUrl()
        window.location.href = url
      }
    } catch {
      setError(t('login.google.failed'))
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-theme-surface px-3 py-2 text-center text-xs leading-relaxed text-theme-muted">
        {t('login.google.disclosure')}
      </p>

      <GoogleSignInButton
        onClick={handleGoogleLogin}
        disabled={loading}
        label={t('login.google.signIn')}
      />

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      {!noCasaPhase0 && (
        <p className="text-xs text-theme-muted text-center leading-relaxed">
          {t('login.google.notice')}
        </p>
      )}
    </div>
  )
}
