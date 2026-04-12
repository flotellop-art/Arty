import { useState, useCallback } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { StarIcon } from '../shared/StarIcon'
import { ApiKeyLoginTab } from './ApiKeyLoginTab'
import { EmailLoginTab } from './EmailLoginTab'
import { GoogleLoginTab } from './GoogleLoginTab'
import type { UserSession, AuthMethod } from '../../services/userSession'
import * as scoped from '../../services/scopedStorage'

type Tab = 'apikey' | 'google' | 'email'

interface LoginScreenProps {
  onLogin: (method: AuthMethod, credentials: {
    displayName: string
    email?: string
    avatar?: string
    anthropicKey: string
    geminiKey?: string
    mistralKey?: string
    identifier: string
  }) => Promise<UserSession>
  knownSessions: UserSession[]
  onSwitchAccount: (userId: string) => void
}

export function LoginScreen({ onLogin, knownSessions, onSwitchAccount }: LoginScreenProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<Tab>('apikey')
  const [loading, setLoading] = useState(false)
  const [emailError, setEmailError] = useState('')

  // Step 2 for Google/Email: ask for API key after auth
  const [pendingAuth, setPendingAuth] = useState<{
    method: AuthMethod
    displayName: string
    email: string
    avatar?: string
  } | null>(null)

  const handleApiKeyLogin = useCallback(async (anthropicKey: string, geminiKey?: string, mistralKey?: string) => {
    setLoading(true)
    try {
      // If we have a pending Google/Email auth, complete it with the API key
      if (pendingAuth) {
        await onLogin(pendingAuth.method, {
          displayName: pendingAuth.displayName,
          email: pendingAuth.email,
          avatar: pendingAuth.avatar,
          anthropicKey,
          geminiKey,
          mistralKey,
          identifier: pendingAuth.email,
        })
        setPendingAuth(null)
      } else {
        // Pure API key login
        const keyPreview = anthropicKey.slice(0, 10) + '...'
        await onLogin('apikey', {
          displayName: keyPreview,
          anthropicKey,
          geminiKey,
          mistralKey,
          identifier: anthropicKey,
        })
      }
    } finally {
      setLoading(false)
    }
  }, [onLogin, pendingAuth])

  const handleEmailLogin = useCallback(async (email: string, password: string) => {
    setLoading(true)
    setEmailError('')
    try {
      // Hash password for local verification
      const encoder = new TextEncoder()
      const hash = await crypto.subtle.digest('SHA-256', encoder.encode(password + email))
      const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')

      // Check if account exists (by checking for stored hash)
      const storedHash = localStorage.getItem(`arty-email-hash-${email}`)

      if (storedHash && storedHash !== hashHex) {
        setEmailError(t('login.email.errors.wrongPassword'))
        setLoading(false)
        return
      }

      // Store hash if new account
      if (!storedHash) {
        localStorage.setItem(`arty-email-hash-${email}`, hashHex)
      }

      // Check if this user already has API keys saved
      // We need to temporarily set a session to read scoped storage
      const { generateUserId, setActiveSession } = await import('../../services/userSession')
      const userId = await generateUserId('email', email)
      setActiveSession({ userId, authMethod: 'email', displayName: email, email, createdAt: Date.now() })
      const existingKeys = scoped.getJSON<{ anthropic: string; gemini?: string; mistral?: string }>('api-keys')

      if (existingKeys && existingKeys.anthropic) {
        // Already has keys — login directly
        await onLogin('email', {
          displayName: email.split('@')[0] || email,
          email,
          anthropicKey: existingKeys.anthropic,
          geminiKey: existingKeys.gemini || undefined,
          mistralKey: existingKeys.mistral || undefined,
          identifier: email,
        })
      } else {
        // Need API key — show step 2
        setPendingAuth({
          method: 'email',
          displayName: email.split('@')[0] || email,
          email,
        })
      }
    } catch {
      setEmailError(t('login.email.errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [onLogin, t])

  // If pending auth, show API key form
  if (pendingAuth) {
    return (
      <div className="min-h-[100dvh] bg-cream flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 justify-center mb-6">
            <StarIcon size={36} />
            <h1 className="font-serif text-2xl font-bold text-bubble-user">Arty</h1>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <p className="text-sm text-gray-500 mb-4">
              <Trans
                i18nKey="login.connectedAs"
                values={{ name: pendingAuth.email || pendingAuth.displayName }}
                components={{ strong: <strong /> }}
              />
            </p>
            <ApiKeyLoginTab onLogin={handleApiKeyLogin} loading={loading} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-cream flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-8">
          <StarIcon size={36} />
          <h1 className="font-serif text-2xl font-bold text-bubble-user">Arty</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-serif text-lg font-semibold text-bubble-user mb-4 text-center">
            {t('login.title')}
          </h2>

          {/* Tabs */}
          <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1">
            {([
              { id: 'apikey' as Tab, label: t('login.tabs.apikey') },
              { id: 'google' as Tab, label: t('login.tabs.google') },
              { id: 'email' as Tab, label: t('login.tabs.email') },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white text-bubble-user shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'apikey' && (
            <ApiKeyLoginTab onLogin={handleApiKeyLogin} loading={loading} />
          )}
          {activeTab === 'google' && (
            <GoogleLoginTab
              loading={loading}
              onNativeGoogleLogin={async (email, name, avatar, serverAuthCode) => {
                setLoading(true)
                try {
                  // Exchange serverAuthCode for Google tokens
                  let googleAccessToken = ''
                  let googleRefreshToken = ''
                  let expiresIn = 3600

                  if (serverAuthCode) {
                    try {
                      const { apiUrl } = await import('../../services/apiBase')
                      const res = await fetch(apiUrl('/api/auth/token'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code: serverAuthCode, redirect_uri: '' }),
                      })
                      if (res.ok) {
                        const data = await res.json()
                        googleAccessToken = data.access_token || ''
                        googleRefreshToken = data.refresh_token || ''
                        expiresIn = data.expires_in || 3600
                      }
                    } catch {
                      // Token exchange failed — continue without
                    }
                  }

                  // Login (handles session, crypto, keys)
                  await onLogin('google', {
                    displayName: name,
                    email,
                    avatar,
                    anthropicKey: 'server-provided',
                    identifier: email,
                  })

                  // Store Google data AFTER login (scoped storage needs userId)
                  scoped.setJSON('google-user', { email, name, picture: avatar })
                  scoped.setJSON('google-tokens', {
                    access_token: googleAccessToken,
                    refresh_token: googleRefreshToken,
                    expires_at: Date.now() + expiresIn * 1000,
                  })
                } catch (err) {
                  console.error('Native Google login error:', err)
                  setPendingAuth({ method: 'google', displayName: name, email, avatar })
                } finally {
                  setLoading(false)
                }
              }}
            />
          )}
          {activeTab === 'email' && (
            <EmailLoginTab onLogin={handleEmailLogin} loading={loading} error={emailError} />
          )}
        </div>

        {/* Known sessions */}
        {knownSessions.length > 0 && (
          <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs text-gray-400 mb-2">{t('login.recentAccounts')}</p>
            {knownSessions.slice(0, 3).map((session) => (
              <button
                key={session.userId}
                onClick={() => onSwitchAccount(session.userId)}
                className="w-full flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-gray-50 transition-colors text-left"
              >
                {session.avatar ? (
                  <img src={session.avatar} alt="" className="w-8 h-8 rounded-full" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-semibold">
                    {(session.displayName || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-bubble-user truncate">{session.displayName}</p>
                  <p className="text-xs text-gray-400 truncate">{session.email || session.authMethod}</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-300">
                  <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
