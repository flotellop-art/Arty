/**
 * OnboardingChoice — first-launch fork between BYOK ("J'ai ma clé API") and
 * Subscription ("9,99€/mois"). Shown once, after WelcomeSlides, before
 * LoginScreen. The chosen path is recorded under
 * `arty-onboarding-choice-done` so the screen never reappears.
 *
 * BYOK path: the user types an Anthropic key in a sub-form and we call
 * `auth.login('apikey', …)` directly — same flow as ApiKeyLoginTab.
 * Subscription path: opens Lemon Squeezy checkout in the in-app browser
 * (Capacitor) with a window.open fallback for web, then marks the choice
 * done so the user can come back via the regular LoginScreen (Google /
 * Email tabs) — server-side will validate the subscription on the first
 * AI call.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArtyWordmark } from '../shared/PrismMark'

const CHOICE_DONE_KEY = 'arty-onboarding-choice-done'

// TODO: replace with the real Lemon Squeezy variant ID once the product is
// published. Until then we open the store landing page so the link still
// "works" in dev/staging.
const LEMON_SQUEEZY_CHECKOUT_URL = 'https://arty.lemonsqueezy.com/buy/'

export function isOnboardingChoiceDone(): boolean {
  return localStorage.getItem(CHOICE_DONE_KEY) === '1'
}

export function markOnboardingChoiceDone(): void {
  localStorage.setItem(CHOICE_DONE_KEY, '1')
}

interface OnboardingChoiceProps {
  /** Called when the user submits a valid Anthropic key. The parent
   *  performs the actual login (auth.login('apikey', …)). */
  onApiKeyLogin: (anthropicKey: string) => Promise<void>
  /** Called after the subscription checkout link has been opened so the
   *  parent can refresh the "choice done" state and move on to LoginScreen. */
  onSubscriptionStarted: () => void
}

type Mode = 'choice' | 'byok'

export function OnboardingChoice({ onApiKeyLogin, onSubscriptionStarted }: OnboardingChoiceProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('choice')

  return (
    <div
      className="bg-theme-bg text-theme-ink flex items-center justify-center px-6 py-10"
      style={{ minHeight: 'var(--viewport-h, 100dvh)' }}
    >
      <div className="w-full max-w-3xl">
        <header className="flex flex-col items-center mb-8">
          <ArtyWordmark size={22} color="rgb(var(--theme-accent))" />
          <div className="mt-5 mb-3 h-px w-full bg-theme-ink/10" />
          <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
            {t('onboardingChoice.kicker', { defaultValue: 'Édition privée · Vol. 1' })}
          </span>
        </header>

        <h1 className="font-display text-[36px] sm:text-[42px] leading-[1.05] font-medium -tracking-[0.025em] text-theme-ink text-center">
          {t('onboardingChoice.title', { defaultValue: 'Comment veux-tu commencer' })}
          <span className="text-theme-accent">?</span>
        </h1>
        <p className="font-display italic text-theme-muted text-base mt-2 text-center">
          {t('onboardingChoice.subtitle', {
            defaultValue: 'Deux portes d’entrée. Tu peux changer plus tard.',
          })}
        </p>

        {mode === 'choice' && (
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-5">
            <ByokCard onChoose={() => setMode('byok')} />
            <SubscriptionCard onStarted={onSubscriptionStarted} />
          </div>
        )}

        {mode === 'byok' && (
          <ByokForm onBack={() => setMode('choice')} onApiKeyLogin={onApiKeyLogin} />
        )}
      </div>
    </div>
  )
}

// ─── Choice cards ───────────────────────────────────────────────────────────

interface ByokCardProps {
  onChoose: () => void
}

function ByokCard({ onChoose }: ByokCardProps) {
  const { t } = useTranslation()
  return (
    <article className="flex flex-col rounded-sm border border-theme-border bg-theme-surface p-7 transition-colors hover:border-theme-accent/60">
      <span className="text-4xl" aria-hidden>
        🔑
      </span>
      <h2 className="mt-5 font-display text-[22px] leading-tight font-medium text-theme-ink">
        {t('onboardingChoice.byok.title', { defaultValue: 'Mode Clé API' })}
      </h2>
      <p className="mt-2 font-sans text-sm text-theme-muted leading-relaxed flex-1">
        {t('onboardingChoice.byok.description', {
          defaultValue:
            'Tu as déjà un compte Claude, OpenAI ou Gemini. Tu utilises ta propre clé, gratuit côté Arty.',
        })}
      </p>
      <button
        type="button"
        onClick={onChoose}
        className="mt-6 w-full py-3.5 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90"
      >
        {t('onboardingChoice.byok.cta', { defaultValue: 'Entrer ma clé API' })} →
      </button>
    </article>
  )
}

interface SubscriptionCardProps {
  onStarted: () => void
}

function SubscriptionCard({ onStarted }: SubscriptionCardProps) {
  const { t } = useTranslation()
  const [opening, setOpening] = useState(false)

  const handleSubscribe = async () => {
    if (opening) return
    setOpening(true)
    try {
      try {
        const { Browser } = await import('@capacitor/browser')
        await Browser.open({ url: LEMON_SQUEEZY_CHECKOUT_URL })
      } catch {
        window.open(LEMON_SQUEEZY_CHECKOUT_URL, '_blank', 'noopener,noreferrer')
      }
      markOnboardingChoiceDone()
      onStarted()
    } finally {
      setOpening(false)
    }
  }

  return (
    <article className="relative flex flex-col rounded-sm border border-theme-accent/60 bg-theme-surface p-7 shadow-[0_2px_24px_rgba(0,0,0,0.06)]">
      <span
        className="absolute -top-3 right-5 px-2.5 py-1 rounded-pill bg-theme-accent text-theme-bg font-sans text-[10px] font-semibold uppercase tracking-kicker"
      >
        {t('onboardingChoice.subscription.badge', { defaultValue: 'Le plus simple' })}
      </span>
      <span className="text-4xl" aria-hidden>
        ⚡
      </span>
      <h2 className="mt-5 font-display text-[22px] leading-tight font-medium text-theme-ink">
        {t('onboardingChoice.subscription.title', { defaultValue: 'Mode Abonnement' })}
      </h2>
      <p className="mt-2 font-sans text-sm text-theme-muted leading-relaxed flex-1">
        {t('onboardingChoice.subscription.description', {
          defaultValue:
            '9,99€/mois. Accès immédiat à Claude, GPT-5-mini, Gemini et Mistral. Sans clé API.',
        })}
      </p>
      <button
        type="button"
        onClick={handleSubscribe}
        disabled={opening}
        className="mt-6 w-full py-3.5 font-display italic text-base font-medium tracking-[0.02em] bg-theme-accent text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {opening
          ? t('onboardingChoice.subscription.opening', { defaultValue: 'Ouverture…' })
          : `${t('onboardingChoice.subscription.cta', { defaultValue: 'Démarrer l’abonnement' })} →`}
      </button>
    </article>
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
    <form onSubmit={handleSubmit} className="mt-10 mx-auto max-w-md space-y-6">
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
          className="w-full bg-transparent border-0 border-b border-theme-ink/40 py-2.5 font-mono text-sm text-theme-ink placeholder:text-theme-muted/60 focus:outline-none focus:border-theme-accent transition-colors"
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
