import { useState } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { buildOAuthUrl } from '../../services/googleAuth'

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
  const [error, setError] = useState('')

  const handleGoogleLogin = async () => {
    setError('')
    try {
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
        const url = buildOAuthUrl()
        window.location.href = url
      }
    } catch {
      setError('Connexion Google échouée. Réessaie.')
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={handleGoogleLogin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-40"
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.99-.15-1.17z"/>
          <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z"/>
          <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z"/>
          <path fill="#EA4335" d="M8.98 3.58c1.32 0 2.29.44 3.13 1.21l2.27-2.27A7.8 7.8 0 008.98 0 8 8 0 001.83 5.41L4.5 7.48a4.77 4.77 0 014.48-3.9z"/>
        </svg>
        <span className="text-sm font-medium text-gray-700">Se connecter avec Google</span>
      </button>

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      <p className="text-xs text-gray-400 text-center leading-relaxed">
        Connecte ton compte Google pour accéder à Gmail, Drive et Calendar.
      </p>
    </div>
  )
}
