import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import {
  isMailImapAvailable,
  addMailAccount,
  removeMailAccount,
  type MailAccountMeta,
} from '../../services/native/mailImap'
import { getMailInventoryStatus, refreshMailAccounts } from '../../services/mailAccounts'
import { captureLocalReadScope } from '../../services/projects/store'
import { onLocalDataInvalidated } from '../../services/localDataInvalidation'
import { documentWorkspaceSignal } from '../../services/workspaceWriter/runtime'

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
  type Opening = { controller: AbortController; scope: ReturnType<typeof captureLocalReadScope>; read: number; busy: boolean }
  const opening = useRef<Opening | null>(null), onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [admitted, setAdmitted] = useState(false)
  const [accounts, setAccounts] = useState<MailAccountMeta[]>([])
  const [providerId, setProviderId] = useState('free')
  const [host, setHost] = useState(FREE_PRESET.host)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Détail technique renvoyé par le serveur IMAP sur un refus d'auth (BUG 66,
  // leçon BUG 64) : Gmail y distingue « mauvais mot de passe » de « blocage
  // sécurité » — sans lui, impossible de diagnostiquer sur le terrain.
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  // Divulgation proéminente exigée par Google Play pour les intégrations d'IA
  // tierces (annonce du 15 juillet 2026) : elle doit précéder la collecte,
  // être visible sans défilement dans le flux, et demander un acte positif.
  // Un paragraphe en petits caractères sous le bouton ne satisfait aucun des
  // trois critères. L'accord est redemandé à chaque nouvelle boîte.
  const [consented, setConsented] = useState(false)

  const current = useCallback((ticket: Opening | null): ticket is Opening => {
    if (!ticket || opening.current !== ticket || ticket.controller.signal.aborted) return false
    try { ticket.scope.assertCurrent(); return true } catch { return false }
  }, [])
  const close = useCallback(() => {
    opening.current?.controller.abort(); opening.current = null
    setPassword(''); setEmail(''); setAccounts([]); setConsented(false); setAdmitted(false)
    onCloseRef.current()
  }, [])
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(open, close)

  const native = isMailImapAvailable()
  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId) ?? FREE_PRESET

  const reload = useCallback(async (ticket: Opening) => {
    if (!current(ticket)) return
    const read = ++ticket.read
    const list = await refreshMailAccounts()
    if (!current(ticket) || ticket.read !== read) return
    const inventory = getMailInventoryStatus()
    if (inventory.status === 'ready') setAccounts(list)
    else if (inventory.status === 'failed') setError(t('mailAccountsModal.errorGeneric'))
  }, [current, t])

  useEffect(() => {
    if (!open) return
    setShowPassword(false); setPassword(''); setEmail(''); setAccounts([])
    setConsented(false); setSubmitting(false); setAdmitted(false)
    setError(null); setErrorDetail(null); setSuccess(null)
    const controller = new AbortController()
    let ticket: Opening
    try { ticket = { controller, scope: captureLocalReadScope(controller.signal), read: 0, busy: false } }
    catch { setError(t('mailAccountsModal.errorGeneric')); return }
    opening.current = ticket
    const retire = () => { if (opening.current === ticket) close() }
    const off = onLocalDataInvalidated(retire)
    documentWorkspaceSignal.addEventListener('abort', retire, { once: true })
    const timer = setInterval(() => { if (!current(ticket)) retire() }, 250)
    void (async () => {
      try {
        await ticket.scope.validateReadOnly()
        if (!current(ticket)) return
        setAdmitted(true); await reload(ticket)
      } catch { if (current(ticket)) setError(t('mailAccountsModal.errorGeneric')) }
    })()
    return () => {
      controller.abort(); if (opening.current === ticket) opening.current = null
      off(); clearInterval(timer); documentWorkspaceSignal.removeEventListener('abort', retire)
    }
  }, [open, reload])

  if (!open) return null

  const selectProvider = (id: string) => {
    const p = PROVIDER_PRESETS.find((x) => x.id === id) ?? FREE_PRESET
    setProviderId(id)
    setHost(p.host)
    setError(null)
    setErrorDetail(null)
    setSuccess(null)
  }

  const handleAdd = async () => {
    const ticket = opening.current
    if (!admitted || !current(ticket) || ticket.busy) return
    setError(null)
    setErrorDetail(null)
    setSuccess(null)
    const trimmedEmail = email.trim()
    const trimmedHost = host.trim()
    // trim() aussi sur le mot de passe : "   " est truthy mais deviendra vide
    // après normalisation (BUG 66) — mieux vaut errorMissing tout de suite.
    if (!trimmedEmail || !password.trim() || !trimmedHost) {
      setError(t('mailAccountsModal.errorMissing'))
      return
    }
    // Filet côté logique : le bouton est déjà désactivé sans accord, mais
    // l'exigence de divulgation ne doit pas reposer sur le seul rendu.
    if (!consented) {
      setError(t('mailAccountsModal.errorConsent'))
      return
    }
    ticket.busy = true; setSubmitting(true)
    try {
      const res = await addMailAccount({
        provider: providerId,
        label: preset.label,
        host: trimmedHost,
        email: trimmedEmail,
        password,
      })
      if (!current(ticket)) return
      // Le mot de passe ne vit qu'ici, en transit vers le Keystore natif —
      // on vide le champ immédiatement après l'ajout.
      setPassword('')
      setEmail('')
      // L'accord vaut pour CETTE boîte : la case se redemande pour la suivante.
      setConsented(false)
      setSuccess(t('mailAccountsModal.success', { count: res.messageCount }))
      await reload(ticket)
    } catch (err) {
      if (!current(ticket)) return
      const code = err instanceof Error ? err.message : ''
      if (code.includes('auth_failed')) {
        setError(t('mailAccountsModal.errorAuth'))
        // Le plugin suffixe la réponse du serveur : "auth_failed: <détail>".
        const detail = code.replace(/^.*auth_failed:?\s*/, '').trim()
        if (detail) setErrorDetail(t('mailAccountsModal.errorAuthDetail', { detail }))
      } else if (code.includes('connect_failed')) setError(t('mailAccountsModal.errorConnect'))
      else if (code.includes('too_many_accounts')) setError(t('mailAccountsModal.errorTooMany'))
      else if (code.includes('invalid_host')) setError(t('mailAccountsModal.errorInvalidHost'))
      else if (code.includes('invalid_email')) setError(t('mailAccountsModal.errorInvalidEmail'))
      else if (code.includes('invalid_password')) setError(t('mailAccountsModal.errorInvalidPassword'))
      else setError(t('mailAccountsModal.errorGeneric'))
    } finally {
      if (current(ticket)) { ticket.busy = false; setSubmitting(false) }
    }
  }

  const handleRemove = async (account: MailAccountMeta) => {
    const ticket = opening.current
    if (!admitted || !current(ticket) || ticket.busy) return
    if (!window.confirm(t('mailAccountsModal.confirmRemove', { email: account.email }))) return
    if (!current(ticket) || ticket.busy) return
    ticket.busy = true; setSubmitting(true)
    try {
      await removeMailAccount(account.id)
    } catch {
      if (current(ticket)) setError(t('mailAccountsModal.errorGeneric'))
    } finally {
      if (current(ticket)) {
        await reload(ticket)
        if (current(ticket)) { ticket.busy = false; setSubmitting(false) }
      }
    }
  }

  const inputClass =
    'w-full border border-theme-border bg-theme-bg px-3 py-2.5 text-sm text-theme-ink placeholder:text-theme-muted focus:border-theme-accent focus:outline-none'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-theme-ink/50"
      onClick={close}
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
            onClick={close}
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
                    disabled={!admitted || submitting}
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
              <div className="relative">
                <input
                  className={`${inputClass} pr-20`}
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('mailAccountsModal.passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 px-3 text-xs text-theme-muted hover:text-theme-ink"
                >
                  {showPassword ? t('mailAccountsModal.hidePassword') : t('mailAccountsModal.showPassword')}
                </button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              {errorDetail && <p className="text-xs text-theme-muted">{errorDetail}</p>}
              {success && <p className="text-sm text-theme-accent-text">{success}</p>}
              <div className="border border-theme-ink/30 bg-theme-ink/5 p-3">
                <p className="text-sm text-theme-ink">{t('mailAccountsModal.securityNote')}</p>
                <label className="mt-3 flex items-start gap-2 text-sm text-theme-ink">
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={consented}
                    onChange={(e) => setConsented(e.target.checked)}
                  />
                  <span>{t('mailAccountsModal.consentLabel')}</span>
                </label>
              </div>
              <button
                onClick={handleAdd}
                disabled={!admitted || submitting || !consented}
                className="w-full border border-theme-ink bg-theme-ink px-4 py-3 text-sm font-medium text-theme-bg hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? t('mailAccountsModal.testing') : t('mailAccountsModal.addButton')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
