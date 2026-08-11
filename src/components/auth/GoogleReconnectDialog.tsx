import { useTranslation } from 'react-i18next'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { GoogleSignInButton } from './GoogleSignInButton'

interface GoogleReconnectDialogProps {
  open: boolean
  loading?: boolean
  onClose: () => void
  onContinue: () => void
}

/**
 * Confirmation intermédiaire entre le badge de plan et Google OAuth.
 * Le badge explique le problème ; seul le bouton Google conforme déclenche
 * ensuite l'autorisation, après la divulgation des données réellement utilisées.
 */
export function GoogleReconnectDialog({
  open,
  loading = false,
  onClose,
  onContinue,
}: GoogleReconnectDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useDialogFocusTrap<HTMLElement>(open, onClose)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="google-reconnect-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-theme-border bg-theme-bg p-5 shadow-2xl"
      >
        <h2 id="google-reconnect-title" className="font-display text-2xl text-theme-ink">
          {t('chat.planBadge.reconnectDialogTitle')}
        </h2>
        <p className="mt-2 font-sans text-sm leading-relaxed text-theme-muted">
          {t('chat.planBadge.reconnectDialogBody')}
        </p>
        <p className="mt-3 rounded-xl bg-theme-surface px-3 py-2 font-sans text-xs leading-relaxed text-theme-muted">
          {t('login.google.disclosure')}
        </p>
        <div className="mt-5 space-y-3">
          <GoogleSignInButton
            label={t('login.google.continue')}
            onClick={onContinue}
            disabled={loading}
          />
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-full rounded-lg font-sans text-sm text-theme-muted hover:bg-theme-surface hover:text-theme-ink"
          >
            {t('common.cancel')}
          </button>
        </div>
      </section>
    </div>
  )
}
