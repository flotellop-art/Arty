/**
 * Onboarding screens — first-launch entry into Arty after the welcome slides.
 *
 * Three components live in this file because they form a single conceptual
 * flow (welcome → post-login splash) split across the auth boundary :
 *
 *   1. `OnboardingChoice` — pre-auth welcome screen. Default CTA is now
 *      "Continuer avec Google" (free trial of 30 messages, no credit card).
 *      Two discrete links sit below for power users : "J'ai une clé API"
 *      (BYOK) and "J'ai déjà un abonnement" (jumps straight to the regular
 *      LoginScreen so they can sign in via their existing path).
 *
 *   2. `VipSplash` — post-auth, shown for ~1.5 s when `/api/trial/init`
 *      returned `plan: 'vip'` (i.e. the email is in `ALLOWED_EMAILS`).
 *      Auto-dismisses to the main app via `onDone`.
 *
 *   3. `TrialIntro` — post-auth, shown when `plan: 'trial'`. Lists the four
 *      basic models available during the 30-message run and waits for the
 *      user to click "C'est parti" before unblocking the app.
 *
 * The Google login itself is delegated to the shared `GoogleLoginTab` so we
 * keep a single source of truth for the native plugin / web redirect logic.
 * The trial init call (`/api/trial/init`) lives in `services/trialClient.ts`
 * and is invoked by all Google login paths (this onboarding, LoginScreen
 * Google tab, deep-link callback) so the splash state is set before the
 * splash component renders.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { ArtyWordmark, PrismMark } from '../shared/PrismMark'
import { EmailTrialFlow } from '../auth/EmailTrialFlow'
import { buildOAuthUrl } from '../../services/googleAuth'
import { initTrial } from '../../services/trialClient'
import { exchangeNativeGoogleCode } from '../../services/nativeGoogleTokenExchange'
import { canPurchase } from '../../services/checkout'

const CHOICE_DONE_KEY = 'arty-onboarding-choice-done'

interface GoogleSignInNativePlugin {
  signIn(): Promise<{ email: string; name: string; avatar: string; serverAuthCode: string }>
  signOut(): Promise<void>
}
const GoogleSignInNative = registerPlugin<GoogleSignInNativePlugin>('GoogleSignInNative')

export function isOnboardingChoiceDone(): boolean {
  return localStorage.getItem(CHOICE_DONE_KEY) === '1'
}

export function markOnboardingChoiceDone(): void {
  localStorage.setItem(CHOICE_DONE_KEY, '1')
}

// ─── 1. Welcome screen ─────────────────────────────────────────────────────

interface OnboardingChoiceProps {
  /** BYOK path — parent calls auth.login('apikey', …). */
  onApiKeyLogin: (anthropicKey: string) => Promise<void>
  /** Native Google path — parent receives the Google credentials and calls
   *  auth.login('google', …). The trial init call has already happened by
   *  the time this fires, so the splash state is set before unmount. */
  onNativeGoogleLogin: (
    email: string,
    name: string,
    avatar: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number
  ) => Promise<void>
  /** Jump to the regular LoginScreen for users who already have a sub. */
  onGoToLogin: () => void
  /** Essai par email (OTP) — sans Google. Parent appelle auth.login('email', …)
   *  puis setTrialToken(token). */
  onEmailTrialLogin: (email: string, token: string) => Promise<void>
}

type Mode = 'choice' | 'byok' | 'emailtrial'

export function OnboardingChoice({
  onApiKeyLogin,
  onNativeGoogleLogin,
  onGoToLogin,
  onEmailTrialLogin,
}: OnboardingChoiceProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('choice')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleGoogle = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() !== 'android') {
        setError(t('login.google.iosUnavailable'))
        return
      }
      if (Capacitor.isNativePlatform()) {
        const { email, name, avatar, serverAuthCode } = await GoogleSignInNative.signIn()
        const { accessToken, refreshToken, expiresIn } = await exchangeNativeGoogleCode(serverAuthCode)
        // Décide du splash post-login (vip|trial|none) AVANT de finaliser
        // l'auth — le composant va unmount dès que auth.isAuthenticated flip.
        await initTrial(accessToken)
        await onNativeGoogleLogin(
          email,
          name || email.split('@')[0] || '',
          avatar || '',
          accessToken,
          refreshToken,
          expiresIn
        )
        // Ne jamais masquer le chemin de récupération avant que l'échange OAuth
        // ET la création de session aient tous deux abouti.
        markOnboardingChoiceDone()
      } else {
        // Web — redirect to Google. Trial init is performed in App's
        // OAuthCallback handler once we get the access_token back.
        markOnboardingChoiceDone()
        window.location.href = await buildOAuthUrl()
      }
    } catch {
      setError(t('login.google.failed', { defaultValue: 'Connexion Google impossible.' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      className="keyboard-aware bg-theme-bg text-theme-ink flex items-center justify-center px-6 py-10"
      style={{ minHeight: 'var(--viewport-h, 100dvh)' }}
    >
      <div className="w-full max-w-md">
        <header className="flex flex-col items-center mb-10">
          <ArtyWordmark size={26} color="rgb(var(--theme-accent))" />
        </header>

        {mode === 'choice' && (
          <>
            <h1 className="font-display text-[34px] sm:text-[40px] leading-[1.05] font-medium -tracking-[0.025em] text-theme-ink text-center">
              {t('onboardingChoice.tryFree.title', { defaultValue: 'Essaie Arty gratuitement' })}
            </h1>
            {/* P0.10 — la promesse trial n'est plus atténuée (était text-theme-muted
                italic) : c'est l'argument n°1 face au marché (la plainte la plus
                fréquente contre le concurrent direct = pas d'essai gratuit). */}
            <p className="font-display text-theme-ink text-base mt-3 text-center">
              {t('onboardingChoice.tryFree.subtitle', {
                defaultValue: '30 messages offerts. Sans carte bancaire.',
              })}
            </p>

            {/* P2.2 — preuve de valeur concrète (statique, JSX pur, aucun appel
                réseau). Cas par « collage » → réponse, donc HONNÊTES avant la
                connexion Google (on ne montre pas de démo Gmail qui exigerait un
                compte connecté = pas de promesse trahie). Remplace les anciennes
                4 slides emojis génériques. */}
            <ProofPills />

            <div className="mt-8 space-y-4">
              <button
                type="button"
                onClick={handleGoogle}
                disabled={busy}
                className="w-full py-3.5 font-display italic text-base font-medium tracking-[0.02em] bg-theme-accent text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-50 flex flex-col items-center justify-center gap-0.5"
              >
                <span className="flex items-center justify-center gap-3">
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                    <path fill="#fff" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.99-.15-1.17z" />
                    <path fill="#fff" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z" />
                    <path fill="#fff" d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z" />
                    <path fill="#fff" d="M8.98 3.58c1.32 0 2.29.44 3.13 1.21l2.27-2.27A7.8 7.8 0 008.98 0 8 8 0 001.83 5.41L4.5 7.48a4.77 4.77 0 014.48-3.9z" />
                  </svg>
                  <span>
                    {busy
                      ? t('onboardingChoice.tryFree.googleLoading', { defaultValue: 'Connexion…' })
                      : `${t('onboardingChoice.tryFree.googleCta', { defaultValue: 'Continuer avec Google' })} →`}
                  </span>
                </span>
                {!busy && (
                  <span className="font-sans not-italic text-[11px] font-normal opacity-80 tracking-normal">
                    {t('onboardingChoice.tryFree.googleSub', { defaultValue: '30 messages gratuits · sans carte bancaire' })}
                  </span>
                )}
              </button>

              {error && (
                <p className="font-sans text-xs text-red-500 text-center">{error}</p>
              )}
            </div>

                        {/* Divider */}
            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-theme-ink/15" />
              <span className="font-display italic text-[12px] text-theme-muted">{t('common.or')}</span>
              <div className="flex-1 h-px bg-theme-ink/15" />
            </div>

            {/* Cards secondaires */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" onClick={onGoToLogin}
                className="flex flex-col items-start gap-2 p-4 rounded-2xl bg-theme-ink/[0.04] border border-theme-ink/10 hover:bg-theme-ink/[0.07] transition-colors text-left">
                <div className="w-7 h-7 rounded-lg bg-theme-accent flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M7 1L13 4V7C13 10.3 10.3 13 7 13C3.7 13 1 10.3 1 7V4L7 1Z" stroke="rgb(var(--theme-bg))" strokeWidth="1.2" fill="none"/>
                    <path d="M4.5 7L6 8.5L9.5 5" stroke="rgb(var(--theme-bg))" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </div>
                <p className="font-display text-[13px] font-medium text-theme-ink leading-tight">{t('onboardingChoice.cards.subscription.title')}</p>
                {/* Play Store — sur natif, libellé neutre (« Pro, illimité »
                    = pub pour un tier payant). La carte reste : c'est juste
                    la connexion à un compte existant. */}
                <p className="font-display italic text-[11px] text-theme-muted leading-tight -mt-1.5">
                  {canPurchase
                    ? t('onboardingChoice.cards.subscription.subtitle')
                    : t('onboardingChoice.cards.subscription.subtitleNative')}
                </p>
              </button>

              <button type="button" onClick={() => setMode('byok')}
                className="flex flex-col items-start gap-2 p-4 rounded-2xl bg-theme-ink/[0.04] border border-theme-ink/10 hover:bg-theme-ink/[0.07] transition-colors text-left">
                <div className="w-7 h-7 rounded-lg bg-[#7C3AED] flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <rect x="1" y="4" width="12" height="8" rx="2" stroke="white" strokeWidth="1.2" fill="none"/>
                    <path d="M4 4V3C4 2 5 1 7 1C9 1 10 2 10 3V4" stroke="white" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                    <circle cx="7" cy="8" r="1" fill="white"/>
                  </svg>
                </div>
                <p className="font-display text-[13px] font-medium text-theme-ink leading-tight">{t('onboardingChoice.cards.apiKey.title')}</p>
                <p className="font-display italic text-[11px] text-theme-muted leading-tight -mt-1.5">{t('onboardingChoice.cards.apiKey.subtitle')}</p>
              </button>
            </div>
<div className="mt-10 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => setMode('emailtrial')}
                className="font-display italic text-[13px] text-theme-muted hover:text-theme-ink transition-colors"
              >
                {t('onboardingChoice.tryFree.emailLink', { defaultValue: 'Essayer avec mon email' })}
              </button>
              <button
                type="button"
                onClick={() => setMode('byok')}
                className="font-display italic text-[13px] text-theme-muted hover:text-theme-ink transition-colors"
              >
                {t('onboardingChoice.tryFree.byokLink', { defaultValue: "J'ai une clé API" })}
              </button>
              <button
                type="button"
                onClick={onGoToLogin}
                className="font-display italic text-[13px] text-theme-muted hover:text-theme-ink transition-colors"
              >
                {t('onboardingChoice.tryFree.subLink', { defaultValue: "J'ai déjà un abonnement" })}
              </button>
            </div>
          </>
        )}

        {mode === 'byok' && (
          <ByokForm onBack={() => setMode('choice')} onApiKeyLogin={onApiKeyLogin} />
        )}

        {mode === 'emailtrial' && (
          <EmailTrialFlow onSuccess={onEmailTrialLogin} onBack={() => setMode('choice')} />
        )}
      </div>
    </main>
  )
}

// ─── 2. VIP splash (post-auth, 1.5 s auto-dismiss) ─────────────────────────

interface VipSplashProps {
  onDone: () => void
}

export function VipSplash({ onDone }: VipSplashProps) {
  const { t } = useTranslation()
  useEffect(() => {
    const id = setTimeout(onDone, 1500)
    return () => clearTimeout(id)
  }, [onDone])

  return (
    <div
      className="bg-theme-bg text-theme-ink flex items-center justify-center px-6"
      style={{ minHeight: 'var(--viewport-h, 100dvh)' }}
      role="status"
      aria-live="polite"
    >
      <div className="text-center">
        <div className="text-6xl mb-6" aria-hidden>⭐</div>
        <p className="font-display text-2xl text-theme-ink">
          {t('onboardingChoice.vip.welcome', { defaultValue: 'Bienvenue, accès VIP activé.' })}
        </p>
      </div>
    </div>
  )
}

// ─── 3. Trial intro (post-auth, click to continue) ─────────────────────────

interface TrialIntroProps {
  onDone: () => void
  onUpgrade: () => void
}

export function TrialIntro({ onDone, onUpgrade }: TrialIntroProps) {
  const { t } = useTranslation()

  return (
    <div
      className="bg-theme-bg text-theme-ink flex items-center justify-center px-6 py-10"
      style={{ minHeight: 'var(--viewport-h, 100dvh)' }}
    >
      <div className="w-full max-w-md text-center">
        <div className="text-6xl mb-6" aria-hidden>🎁</div>
        <h1 className="font-display text-[32px] leading-tight font-medium text-theme-ink">
          {t('onboardingChoice.trial.title', { defaultValue: '30 messages offerts !' })}
        </h1>
        <p className="font-display italic text-theme-muted text-base mt-3">
          {t('onboardingChoice.trial.subtitle', {
            // « GPT-4o mini » était obsolète — la source de vérité (checkAllowedUser)
            // liste gpt-5-mini. Aligné aussi avec la carte pricing.
            defaultValue: 'Modèles disponibles : Claude Haiku, GPT-5 mini, Gemini Flash, Mistral Medium',
          })}
        </p>
        {/* P1.1 — obligation de transparence de la mémoire auto (ON par défaut). */}
        <p className="font-display italic text-theme-muted text-xs mt-3">
          🧠 {t('onboardingChoice.trial.memoryNote', {
            defaultValue:
              'Arty mémorise discrètement ce qui compte pour toi — tout reste chiffré sur ton appareil, modifiable dans les Paramètres.',
          })}
        </p>

        <button
          type="button"
          onClick={onDone}
          className="mt-10 w-full py-4 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90"
        >
          {t('onboardingChoice.trial.cta', { defaultValue: "C'est parti" })} →
        </button>

        {/* Play Store — pas de CTA d'upgrade sur natif. */}
        {canPurchase && (
          <button
            type="button"
            onClick={onUpgrade}
            className="mt-6 font-display italic text-[13px] text-theme-muted hover:text-theme-ink transition-colors"
          >
            {t('onboardingChoice.trial.upgrade', {
              defaultValue: 'Passe à Pro ou Subscription pour débloquer tous les modèles',
            })}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── P2.2 — preuve de valeur (mini démos statiques) ────────────────────────

interface ProofItem {
  ask: string
  reply: string
}

function ProofPills() {
  const { t } = useTranslation()
  const raw = t('onboardingChoice.proof.items', { returnObjects: true })
  const items: ProofItem[] = Array.isArray(raw) ? (raw as ProofItem[]) : []
  if (items.length === 0) return null

  return (
    <div className="mt-8">
      <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted text-center mb-3">
        {t('onboardingChoice.proof.intro', { defaultValue: 'Concrètement, en un message :' })}
      </p>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-2xl bg-theme-ink/[0.04] border border-theme-ink/10 p-3">
            <p className="font-display italic text-[13px] text-theme-ink/90 leading-snug">« {item.ask} »</p>
            <div className="flex gap-2 mt-1.5">
              <span className="flex-shrink-0 mt-[3px] text-theme-accent" aria-hidden>
                <PrismMark size={13} fill />
              </span>
              <p className="font-sans text-[12px] text-theme-muted leading-snug">{item.reply}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── BYOK sub-form ──────────────────────────────────────────────────────────

interface ByokFormProps {
  onBack: () => void
  onApiKeyLogin: (anthropicKey: string) => Promise<void>
}

function ByokForm({ onBack, onApiKeyLogin }: ByokFormProps) {
  const { t } = useTranslation()
  const [key, setKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = key.trim()
    if (!trimmed) {
      setError(t('login.apiKey.errors.required'))
      return
    }
    if (!trimmed.startsWith('sk-ant-')) {
      setError(t('login.apiKey.errors.invalidPrefix'))
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await onApiKeyLogin(trimmed)
      // Login succeeded — auth flips and the parent unmounts us. Mark the
      // choice as done so a future logout doesn't replay onboarding.
      markOnboardingChoiceDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.email.errors.generic'))
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 mx-auto max-w-md space-y-6">
      <div>
        <label
          htmlFor="onboarding-apikey"
          className="block font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-1.5"
        >
          {t('login.apiKey.anthropicLabel')}
        </label>
        <input
          id="onboarding-apikey"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-api03-…"
          autoComplete="off"
          autoFocus
          className="w-full bg-transparent border-0 border-b border-theme-ink/40 py-2.5 font-mono text-sm text-theme-ink placeholder:text-theme-muted focus:outline-none focus:border-theme-accent transition-colors"
        />
      </div>

      <button
        type="button"
        onClick={() => setShowHelp((v) => !v)}
        className="font-display italic text-[13px] text-theme-muted hover:text-theme-ink transition-colors"
      >
        {showHelp
          ? t('onboardingChoice.byok.hideHelp', { defaultValue: 'Masquer l’aide' })
          : t('onboardingChoice.byok.showHelp', { defaultValue: 'Où trouver ma clé ?' })}
      </button>

      {showHelp && (
        <ul className="font-sans text-xs text-theme-muted leading-relaxed space-y-1.5 border-l-2 border-theme-accent/40 pl-3">
          <li>
            Anthropic Claude →{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-theme-accent underline underline-offset-2"
            >
              console.anthropic.com/settings/keys
            </a>
          </li>
          <li>
            OpenAI →{' '}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-theme-accent underline underline-offset-2"
            >
              platform.openai.com/api-keys
            </a>
          </li>
          <li>
            Google Gemini →{' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-theme-accent underline underline-offset-2"
            >
              aistudio.google.com/app/apikey
            </a>
          </li>
        </ul>
      )}

      {error && <p className="font-sans text-xs text-theme-accent">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !key.trim()}
        className="w-full py-4 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {submitting
          ? t('login.apiKey.connecting')
          : `${t('login.apiKey.submit')} →`}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="w-full font-display italic text-[13px] text-theme-muted hover:text-theme-ink transition-colors text-center"
      >
        ← {t('onboardingChoice.byok.back', { defaultValue: 'Revenir au choix' })}
      </button>

      <p className="font-display italic text-[11px] text-theme-muted text-center leading-relaxed">
        {t('login.apiKey.notice')}
      </p>
    </form>
  )
}
