import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import {
  isMailImapAvailable,
  addMailAccount,
  removeMailAccount,
  type MailAccountMeta,
} from '../../services/native/mailImap'
import { getCachedMailAccounts, refreshMailAccounts } from '../../services/mailAccounts'

interface MailAccountsModalProps {
  open: boolean
  onClose: () => void
}

// Presets des fournisseurs supportés en v1 (client IMAP natif Android,
// décision « natif d'abord » du 9 août 2026). Port TLS 993 imposé côté natif.
// Gmail/Yahoo/iCloud exigent un MOT DE PASSE D'APPLICATION (2FA active) —
// jamais le mot de passe principal du compte.
interface ProviderPreset {
  id: string
  label: string
  host: string
  hostEditable: boolean
  hintKey: string
}

const FREE_PRESET: ProviderPreset = {
  id: 'free', label: 'Free', host: 'imap.free.fr', hostEditable: false, hintKey: 'mailAccountsModal.hintFree',
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  FREE_PRESET,
  { id: 'gmail', label: 'Gmail', host: 'imap.gmail.com', hostEditable: false, hintKey: 'mailAccountsModal.hintGmail' },
  { id: 'yahoo', label: 'Yahoo', host: 'imap.mail.yahoo.com', hostEditable: false, hintKey: 'mailAccountsModal.hintYahoo' },
  { id: 'icloud', label: 'iCloud', host: 'imap.mail.me.com', hostEditable: false, hintKey: 'mailAccountsModal.hintIcloud' },
  { id: 'imap', label: 'IMAP', host: '', hostEditable: true, hintKey: 'mailAccountsModal.hintImap' },
]

export const MailAccountsModal = memo(function MailAccountsModal({ open, onClose }: MailAccountsModalProps) {
  const { t } = useTranslation()
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(open, onClose)
  const [accounts, setAccounts] = useState<MailAccountMeta[]>(getCachedMailAccounts())
  const [providerId, setProviderId] = useState('free')
  const [host, setHost] = useState(FREE_PRESET.host)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const native = isMailImapAvailable()
  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId) ?? FREE_PRESET

  const reload = useCallback(async () => {
    const list = await refreshMailAccounts()
    setAccounts(list)
  }, [])

  useEffect(() => {
    if (open) reload()
  }, [open, reload])

  if (!open) return null

  const selectProvider = (id: string) => {
    const p = PROVIDER_PRESETS.find((x) => x.id === id) ?? FREE_PRESET
    setProviderId(id)
    setHost(p.host)
    setError(null)
    setSuccess(null)
  }

  const handleAdd = async () => {
    if (submitting) return
    setError(null)
    setSuccess(null)
    const trimmedEmail = email.trim()
    const trimmedHost = host.trim()
    if (!trimmedEmail || !password || !trimmedHost) {
      setError(t('mailAccountsModal.errorMissing'))
      return
    }
    setSubmitting(true)
    try {
      const res = await addMailAccount({
        provider: providerId,
        label: preset.label,
        host: trimmedHost,
        email: trimmedEmail,
        password,
      })
      // Le mot de passe ne vit qu'ici, en transit vers le Keystore natif —
      // on vide le champ immédiatement après l'ajout.
      setPassword('')
      setEmail('')
      setSuccess(t('mailAccountsModal.success', { count: res.messageCount }))
      await reload()
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      if (code.includes('auth_failed')) setError(t('mailAccountsModal.errorAuth'))
      else if (code.includes('connect_failed')) setError(t('mailAccountsModal.errorConnect'))
      else if (code.includes('too_many_accounts')) setError(t('mailAccountsModal.errorTooMany'))
      else setError(t('mailAccountsModal.errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemove = async (account: MailAccountMeta) => {
    if (!window.confirm(t('mailAccountsModal.confirmRemove', { email: account.email }))) return
    try {
      await removeMailAccount(account.id)
    } finally {
      await reload()
    }
  }

  const inputClass =
    'w-full border border-theme-border bg-theme-bg px-3 py-2.5 text-sm text-theme-ink placeholder:text-theme-muted focus:border-theme-accent focus:outline-none'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-theme-ink/50"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mail-accounts-modal-title"
        tabIndex={-1}
        className="w-full max-w-md overflow-y-auto border border-theme-border bg-theme-bg text-theme-ink"
        style={{ maxHeight: 'min(90vh, calc(var(--viewport-h, 100dvh) - 32px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 py-4 sticky top-0 bg-theme-bg z-10"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}
        >
          <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
            {t('mailAccountsModal.kicker')}
          </span>
          <button
            onClick={onClose}
            className="grid h-11 w-11 place-items-center border border-theme-border text-theme-ink hover:border-theme-accent"
            aria-label={t('common.close')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mx-6 h-[2px] bg-theme-ink" />
        <div className="mx-6 mt-[3px] h-px bg-theme-ink" />

        <div className="px-6 pt-6 pb-2">
          <h1 id="mail-accounts-modal-title" className="font-display font-medium text-[28px] leading-[1.05] -tracking-[0.02em] text-theme-ink">
            {t('mailAccountsModal.titleLead')}
            <span className="italic text-theme-accent-text">{t('mailAccountsModal.titleAccent')}</span>
          </h1>
          <p className="font-display italic text-theme-muted text-sm mt-1">
            {t('mailAccountsModal.subtitle')}
          </p>
        </div>

        <div className="p-6 space-y-5">
          {!native && (
            <p className="text-sm text-theme-muted border border-theme-border p-3">
              {t('mailAccountsModal.androidOnly')}
            </p>
          )}

          {accounts.length > 0 && (
            <div className="space-y-2">
              <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
                {t('mailAccountsModal.connectedTitle')}
              </p>
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between border border-theme-border px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-theme-ink truncate">{a.email}</p>
                    <p className="text-xs text-theme-muted">{a.label || a.provider} · {a.host}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(a)}
                    className="ml-3 shrink-0 border border-theme-border px-2.5 py-1.5 text-xs text-theme-ink hover:border-theme-accent"
                  >
                    {t('mailAccountsModal.remove')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {native && (
            <div className="space-y-3">
              <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
                {t('mailAccountsModal.addTitle')}
              </p>
              <div className="flex flex-wrap gap-2">
                {PROVIDER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectProvider(p.id)}
                    className={`border px-3 py-1.5 text-sm ${
                      providerId === p.id
                        ? 'border-theme-accent text-theme-ink'
                        : 'border-theme-border text-theme-muted hover:border-theme-accent'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-theme-muted">{t(preset.hintKey)}</p>
              {preset.hostEditable && (
                <input
                  className={inputClass}
                  placeholder={t('mailAccountsModal.hostPlaceholder')}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              )}
              <input
                className={inputClass}
                type="email"
                placeholder={t('mailAccountsModal.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <input
                className={inputClass}
                type="password"
                placeholder={t('mailAccountsModal.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              {success && <p className="text-sm text-theme-accent-text">{success}</p>}
              <button
                onClick={handleAdd}
                disabled={submitting}
                className="w-full border border-theme-ink bg-theme-ink px-4 py-3 text-sm font-medium text-theme-bg hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? t('mailAccountsModal.testing') : t('mailAccountsModal.addButton')}
              </button>
              <p className="text-xs text-theme-muted">{t('mailAccountsModal.securityNote')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
