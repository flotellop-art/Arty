import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiKeySetup } from './ApiKeySetup'
import type { ApiKeys } from '../../hooks/useApiKeys'
import * as scoped from '../../services/scopedStorage'
import { setActiveKeys } from '../../services/activeApiKey'
import { initCrypto } from '../../services/crypto'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'

interface ApiKeysModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Modal dédiée à l'édition des clés API (Anthropic, Gemini, Mistral, OpenAI).
 * Extraite de SettingsModal en 1.0.41 pour séparer les clés API (sensibles,
 * techniques) des autres préférences (notifications, géolocalisation, mémoire,
 * historique, quota, version) accessibles via SettingsModal.
 *
 * Réutilise ApiKeySetup (composant embedded inchangé) pour l'UI. Le handleSave
 * est identique à celui qui existait dans SettingsModal : chiffrement via
 * initCrypto(), stockage plain JSON (BUG 1), activation en mémoire via
 * setActiveKeys(), puis fermeture.
 */
export const ApiKeysModal = memo(function ApiKeysModal({ open, onClose }: ApiKeysModalProps) {
  const { t } = useTranslation()
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(open, onClose)
  const [initialKeys, setInitialKeys] = useState<ApiKeys | null>(null)

  useEffect(() => {
    if (!open) return
    const stored = scoped.getJSON<ApiKeys>('api-keys')
    setInitialKeys(stored ?? null)
  }, [open])

  if (!open) return null

  const handleSave = async (keys: ApiKeys) => {
    await initCrypto(keys.anthropic)
    scoped.setJSON('api-keys', {
      anthropic: keys.anthropic,
      gemini: keys.gemini,
      mistral: keys.mistral,
      openai: keys.openai,
    })
    setActiveKeys(keys.anthropic, keys.gemini, keys.mistral, keys.openai)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-theme-ink/50"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-keys-modal-title"
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
            {t('apiKeysModal.kicker')}
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
          <h1 id="api-keys-modal-title" className="font-display font-medium text-[28px] leading-[1.05] -tracking-[0.02em] text-theme-ink">
            {t('apiKeysModal.titleLead')}<span className="italic text-theme-accent-text">{t('apiKeysModal.titleAccent')}</span>
          </h1>
          <p className="font-display italic text-theme-muted text-sm mt-1">
            {t('apiKeysModal.subtitle')}
          </p>
        </div>

        <div className="p-6">
          <ApiKeySetup onSave={handleSave} initialKeys={initialKeys} embedded />
        </div>
      </div>
    </div>
  )
})
