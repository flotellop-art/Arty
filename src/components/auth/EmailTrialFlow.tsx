import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { requestOtp, verifyOtp, EmailTrialError } from '../../services/emailTrialClient'

/**
 * Essai par email (OTP) — flux en 2 étapes : saisie email → code 6 chiffres.
 * Pas de magic-link (un lien email ouvre Chrome au lieu de la WebView sur APK,
 * cf. BUG 53) : l'OTP garde la même session sur web / PWA / APK.
 *
 * Le composant ne crée PAS la session lui-même : à la vérification réussie il
 * remonte `(email, token)` au parent (App), qui appelle `auth.login('email', …)`
 * puis `setTrialToken`. Le jeton est opaque/révocable côté serveur.
 */
interface EmailTrialFlowProps {
  onSuccess: (email: string, token: string) => Promise<void>
  onBack: () => void
}

export function EmailTrialFlow({ onSuccess, onBack }: EmailTrialFlowProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resent, setResent] = useState(false)

  const errText = (errorCode: string) =>
    t(`onboardingChoice.emailTrial.errors.${errorCode}`, {
      defaultValue: t('onboardingChoice.emailTrial.errors.generic', {
        defaultValue: 'Une erreur est survenue.',
      }),
    })

  const sendCode = async (target: string) => {
    setError('')
    setBusy(true)
    try {
      await requestOtp(target)
      setEmail(target)
      setStep('code')
      return true
    } catch (err) {
      setError(errText(err instanceof EmailTrialError ? err.code : 'network'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed.includes('@') || trimmed.length < 5) {
      setError(errText('invalid_email'))
      return
    }
    await sendCode(trimmed)
  }

  const handleResend = async () => {
    if (busy) return
    const ok = await sendCode(email)
    if (ok) {
      setResent(true)
      setTimeout(() => setResent(false), 4000)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(code.trim())) {
      setError(errText('invalid_code'))
      return
    }
    setError('')
    setBusy(true)
    try {
      const { token, email: verifiedEmail } = await verifyOtp(email, code.trim())
      // Succès → le parent crée la session puis nous démonte.
      await onSuccess(verifiedEmail, token)
    } catch (err) {
      setError(errText(err instanceof EmailTrialError ? err.code : 'network'))
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 mx-auto max-w-md">
      <h1 className="font-display text-[28px] sm:text-[32px] leading-[1.08] font-medium -tracking-[0.02em] text-theme-ink text-center">
        {t('onboardingChoice.emailTrial.title', { defaultValue: 'Essaie sans compte Google' })}
      </h1>
      <p className="font-display text-theme-ink text-sm mt-3 text-center">
        {t('onboardingChoice.emailTrial.subtitle', {
          defaultValue: 'Reçois un code par email. 30 messages offerts, sans carte bancaire.',
        })}
      </p>

      {step === 'email' && (
        <form onSubmit={handleSendCode} className="mt-8 space-y-5">
          <div>
            <label
              htmlFor="emailtrial-email"
              className="block font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-1.5"
            >
              {t('onboardingChoice.emailTrial.emailLabel', { defaultValue: 'Ton email' })}
            </label>
            <input
              id="emailtrial-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('onboardingChoice.emailTrial.emailPlaceholder', { defaultValue: 'toi@exemple.com' })}
              autoComplete="email"
              autoFocus
              className="w-full bg-transparent border-0 border-b border-theme-ink/40 py-2.5 text-sm text-theme-ink placeholder:text-theme-muted focus:outline-none focus:border-theme-accent transition-colors"
            />
          </div>

          {error && <p className="font-sans text-xs text-theme-accent">{error}</p>}

          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="w-full py-4 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy
              ? t('onboardingChoice.emailTrial.sending', { defaultValue: 'Envoi…' })
              : `${t('onboardingChoice.emailTrial.sendCode', { defaultValue: 'Recevoir mon code' })} →`}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={handleVerify} className="mt-8 space-y-5">
          <p className="font-sans text-xs text-theme-muted text-center leading-relaxed">
            {t('onboardingChoice.emailTrial.codeSentTo', {
              email,
              defaultValue: `Code envoyé à ${email}. Pense à vérifier tes spams.`,
            })}
          </p>
          <div>
            <label
              htmlFor="emailtrial-code"
              className="block font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-1.5"
            >
              {t('onboardingChoice.emailTrial.codeLabel', { defaultValue: 'Code à 6 chiffres' })}
            </label>
            <input
              id="emailtrial-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              autoFocus
              className="w-full bg-transparent border-0 border-b border-theme-ink/40 py-2.5 text-center font-mono text-2xl tracking-[0.5em] text-theme-ink placeholder:text-theme-muted focus:outline-none focus:border-theme-accent transition-colors"
            />
          </div>

          {error && <p className="font-sans text-xs text-theme-accent text-center">{error}</p>}
          {resent && !error && (
            <p className="font-sans text-xs text-theme-muted text-center">
              {t('onboardingChoice.emailTrial.resent', { defaultValue: 'Nouveau code envoyé.' })}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="w-full py-4 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy
              ? t('onboardingChoice.emailTrial.verifying', { defaultValue: 'Vérification…' })
              : `${t('onboardingChoice.emailTrial.verify', { defaultValue: 'Vérifier et démarrer' })} →`}
          </button>

          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={handleResend}
              disabled={busy}
              className="font-display italic text-[13px] text-theme-muted hover:text-theme-ink transition-colors disabled:opacity-40"
            >
              {t('onboardingChoice.emailTrial.resend', { defaultValue: 'Renvoyer le code' })}
            </button>
            <span className="text-theme-ink/20">·</span>
            <button
              type="button"
              onClick={() => {
                setStep('email')
                setCode('')
                setError('')
              }}
              className="font-display italic text-[13px] text-theme-muted hover:text-theme-ink transition-colors"
            >
              {t('onboardingChoice.emailTrial.changeEmail', { defaultValue: "Changer d'email" })}
            </button>
          </div>
        </form>
      )}

      <button
        type="button"
        onClick={onBack}
        className="mt-8 w-full font-display italic text-[13px] text-theme-muted hover:text-theme-ink transition-colors text-center"
      >
        ← {t('onboardingChoice.emailTrial.back', { defaultValue: 'Revenir au choix' })}
      </button>
    </div>
  )
}
