import { useState, useCallback } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ArtyWordmark } from '../shared/PrismMark'
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
    openaiKey?: string
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

  const handleApiKeyLogin = useCallback(async (anthropicKey: string, geminiKey?: string, mistralKey?: string, openaiKey?: string) => {
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
          openaiKey,
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
          openaiKey,
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
      const existingKeys = scoped.getJSON<{ anthropic: string; gemini?: string; mistral?: string; openai?: string }>('api-keys')

      if (existingKeys && existingKeys.anthropic) {
        // Already has keys — login directly
        await onLogin('email', {
          displayName: email.split('@')[0] || email,
          email,
          anthropicKey: existingKeys.anthropic,
          geminiKey: existingKeys.gemini || undefined,
          mistralKey: existingKeys.mistral || undefined,
          openaiKey: existingKeys.openai || undefined,
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
      <div className="min-h-[100dvh] bg-theme-bg text-theme-ink flex items-center justify-center px-7 py-8">
        <div className="w-full max-w-md">
          <header className="flex flex-col items-center mb-10">
            <ArtyWordmark size={22} color="rgb(var(--theme-accent))" />
            <div className="mt-5 mb-3 h-px w-full bg-theme-ink/10" />
            <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
              {t('login.edition')}
            </span>
          </header>

          <p className="font-serif italic text-theme-muted text-base leading-relaxed mb-6">
            <Trans
              i18nKey="login.connectedAs"
              values={{ name: pendingAuth.email || pendingAuth.displayName }}
              components={{ strong: <strong className="not-italic font-medium text-theme-ink" /> }}
            />
          </p>
          <ApiKeyLoginTab onLogin={handleApiKeyLogin} loading={loading} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-theme-bg text-theme-ink flex items-center justify-center px-7 py-8">
      <div className="w-full max-w-md">
        <header className="flex flex-col items-center mb-10">
          <ArtyWordmark size={22} color="rgb(var(--theme-accent))" />
          <div className="mt-5 mb-3 h-px w-full bg-theme-ink/10" />
          <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
            {t('login.edition')}
          </span>
        </header>

        <h1 className="font-display text-[42px] leading-[1.05] font-medium -tracking-[0.025em] text-theme-ink">
          {t('login.editorialTitle')}<span className="text-theme-accent">.</span>
        </h1>
        <p className="font-display italic text-theme-muted text-base mt-2">
          {t('login.editorialSubtitle')}
        </p>

        <div className="mt-8">
          {/* Minimal underline tabs */}
          <div className="flex gap-5 mb-6 border-b border-theme-ink/10">
            {([
              { id: 'apikey' as Tab, label: t('login.tabs.apikey') },
              { id: 'google' as Tab, label: t('login.tabs.google') },
              { id: 'email' as Tab, label: t('login.tabs.email') },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-2 -mb-px text-[11px] font-semibold uppercase tracking-kicker transition-colors ${
                  activeTab === tab.id
                    ? 'text-theme-ink border-b border-theme-ink'
                    : 'text-theme-muted hover:text-theme-ink'
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

        {/* Privacy note */}
        <p className="font-display italic text-[11px] text-theme-muted text-center mt-7 leading-relaxed">
          {t('login.privacyNote')}
        </p>

        {/* Known sessions */}
        {knownSessions.length > 0 && (
          <div className="mt-8 border-t border-theme-ink/10 pt-4">
            <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-3">
              {t('login.recentAccounts')}
            </p>
            {knownSessions.slice(0, 3).map((session) => (
              <button
                key={session.userId}
                onClick={() => onSwitchAccount(session.userId)}
                className="w-full flex items-center gap-3 py-2.5 px-1 hover:bg-theme-ink/5 transition-colors text-left"
              >
                {session.avatar ? (
                  <img src={session.avatar} alt="" className="w-8 h-8 rounded-full" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-theme-accent/15 flex items-center justify-center text-theme-accent text-sm font-semibold">
                    {(session.displayName || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-display text-sm text-theme-ink truncate">{session.displayName}</p>
                  <p className="font-sans text-[11px] text-theme-muted truncate">{session.email || session.authMethod}</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-theme-muted">
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
