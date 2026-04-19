import { useState, useCallback } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { StarIcon } from '../shared/StarIcon'
import { Tag, Rule, Glow } from '../shared/editorial'
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
      const encoder = new TextEncoder()
      const hash = await crypto.subtle.digest('SHA-256', encoder.encode(password + email))
      const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
      const storedHash = localStorage.getItem(`arty-email-hash-${email}`)
      if (storedHash && storedHash !== hashHex) {
        setEmailError(t('login.email.errors.wrongPassword'))
        setLoading(false)
        return
      }
      if (!storedHash) localStorage.setItem(`arty-email-hash-${email}`, hashHex)

      const { generateUserId, setActiveSession } = await import('../../services/userSession')
      const userId = await generateUserId('email', email)
      setActiveSession({ userId, authMethod: 'email', displayName: email, email, createdAt: Date.now() })
      const existingKeys = scoped.getJSON<{ anthropic: string; gemini?: string; mistral?: string; openai?: string }>('api-keys')

      if (existingKeys && existingKeys.anthropic) {
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
        setPendingAuth({ method: 'email', displayName: email.split('@')[0] || email, email })
      }
    } catch {
      setEmailError(t('login.email.errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [onLogin, t])

  // ─── Step 2 : API key request after Google/Email auth ─────────────────────
  if (pendingAuth) {
    return (
      <EditorialShell>
        <div className="px-7 pt-10 pb-2">
          <Tag accent>◈ Deuxième étape</Tag>
          <h1 className="font-display mt-2 text-[32px] leading-[1.05] font-light tracking-[-0.02em] text-ink">
            Presque <em className="italic" style={{ color: 'var(--arty-accent)' }}>prêt</em>.
          </h1>
          <p className="font-serif italic text-[14px] leading-relaxed mt-2 text-muted">
            <Trans
              i18nKey="login.connectedAs"
              values={{ name: pendingAuth.email || pendingAuth.displayName }}
              components={{ strong: <strong className="not-italic font-semibold text-ink" /> }}
            />
          </p>
        </div>
        <div className="px-7 pb-8">
          <ApiKeyLoginTab onLogin={handleApiKeyLogin} loading={loading} />
        </div>
      </EditorialShell>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'apikey', label: t('login.tabs.apikey') },
    { id: 'google', label: t('login.tabs.google') },
    { id: 'email', label: t('login.tabs.email') },
  ]

  return (
    <EditorialShell>
      <div className="px-7 pt-10 pb-2 text-center">
        <div className="inline-flex items-center gap-2.5">
          <StarIcon size={22} />
          <span className="font-display italic text-[26px] text-ink tracking-[-0.01em]">arty</span>
        </div>
        <Rule className="my-4" />
        <Tag>Édition privée · Vol. 1</Tag>
      </div>

      <div className="px-7 pt-6">
        <h1 className="font-display text-[38px] leading-[1.04] font-light tracking-[-0.025em] text-ink">
          {t('login.title')}<span style={{ color: 'var(--arty-accent)' }}>.</span>
        </h1>
        <p className="font-serif italic mt-2 text-[15px] leading-[1.5] text-muted">
          {t('login.subtitle', { defaultValue: 'Ton assistant, chiffré, à toi.' })}
        </p>
      </div>

      {/* Tabs rail — minimal caplock rail, not pillbox */}
      <div className="px-7 mt-7">
        <div className="flex items-center gap-6 border-b" style={{ borderColor: 'var(--arty-line)' }}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative pb-3 text-[11px] tracking-[0.18em] uppercase font-semibold transition-colors"
                style={{ color: active ? 'var(--arty-ink)' : 'var(--arty-muted)' }}
              >
                {tab.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 -bottom-px h-[2px]"
                    style={{ backgroundColor: 'var(--arty-accent)' }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="px-7 pt-6 pb-8">
        {activeTab === 'apikey' && (
          <ApiKeyLoginTab onLogin={handleApiKeyLogin} loading={loading} />
        )}
        {activeTab === 'google' && (
          <GoogleLoginTab
            loading={loading}
            onNativeGoogleLogin={async (email, name, avatar, serverAuthCode) => {
              setLoading(true)
              try {
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
                    // ignored — flow continues without tokens
                  }
                }
                await onLogin('google', {
                  displayName: name, email, avatar,
                  anthropicKey: 'server-provided',
                  identifier: email,
                })
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

      <p className="px-10 pb-8 font-serif italic text-[11px] leading-[1.55] text-center text-muted">
        {t('login.privacyNote', { defaultValue: 'Chiffré localement. Rien ne quitte ton appareil sans toi.' })}
      </p>

      {knownSessions.length > 0 && (
        <div className="mx-7 mb-10 pt-5" style={{ borderTop: '1px solid var(--arty-line)' }}>
          <Tag>— {t('login.recentAccounts')}</Tag>
          <div className="mt-3 flex flex-col gap-1">
            {knownSessions.slice(0, 3).map((session) => (
              <button
                key={session.userId}
                onClick={() => onSwitchAccount(session.userId)}
                className="flex items-center gap-3 py-2 px-1 rounded-sm text-left transition-colors"
                style={{ color: 'var(--arty-ink)' }}
              >
                {session.avatar ? (
                  <img src={session.avatar} alt="" className="w-8 h-8 rounded-full" />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full grid place-items-center font-serif italic text-sm font-semibold"
                    style={{ background: 'var(--arty-accent-glow)', color: 'var(--arty-accent)' }}
                  >
                    {(session.displayName || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-serif text-[14px] truncate" style={{ color: 'var(--arty-ink)' }}>
                    {session.displayName}
                  </p>
                  <p className="text-[11px] truncate text-muted">
                    {session.email || session.authMethod}
                  </p>
                </div>
                <span className="font-serif italic text-[12px]" style={{ color: 'var(--arty-accent)' }}>
                  ouvrir →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </EditorialShell>
  )
}

/** Full-bleed editorial page — paper in Ember, cacao + glow in Nocturne. */
function EditorialShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center px-4 py-8 relative overflow-hidden"
      style={{ backgroundColor: 'var(--arty-bg)' }}
    >
      {/* Nocturne glows — quasi-invisibles en Ember */}
      <Glow size={260} top={-60} right={-80} />
      <Glow size={180} bottom={-40} left={-60} />

      <div
        className="relative w-full max-w-md"
        style={{
          backgroundColor: 'var(--arty-card)',
          borderRadius: 4,
          border: '1px solid var(--arty-line)',
          boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
