import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiKeySetup } from './ApiKeySetup'
import type { ApiKeys } from '../../hooks/useApiKeys'
import * as scoped from '../../services/scopedStorage'
import { setActiveKeys } from '../../services/activeApiKey'
import { initCrypto, CryptoContextChanged, waitForCryptoInitialization, isCryptoReady, captureCryptoGenerationGuard } from '../../services/crypto'
import { prepareGoogleKeyChange, type GoogleKeyChange } from '../../services/googleAuth'
import { resumePendingLocalStorage } from '../../services/resumeLocalStorage'
import { toast } from '../../services/toast'
import { getActiveUserId, getActiveSessionEpoch } from '../../services/userSession'
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
export function ApiKeysModal({ open, onClose }: ApiKeysModalProps) {
  const { t } = useTranslation()
  const saveGeneration = useRef(0)
  const openRef = useRef(open)
  openRef.current = open
  const editingScope = useRef<{ owner: string | null; epoch: number } | null>(null)
  const close = () => { saveGeneration.current++; onClose() }
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(open, close)
  const [initialKeys, setInitialKeys] = useState<ApiKeys | null>(null)
  const owner = getActiveUserId(), epoch = getActiveSessionEpoch()

  useEffect(() => {
    if (!open) return
    editingScope.current = { owner, epoch }
    const stored = scoped.getJSON<ApiKeys>('api-keys')
    setInitialKeys(stored ?? null)
    return () => { saveGeneration.current++; editingScope.current = null }
  }, [open]) // One editing identity per opening; never rebind a private draft.

  useEffect(() => {
    const scope = editingScope.current
    if (open && scope && (scope.owner !== owner || scope.epoch !== epoch)) close()
  }, [open, owner, epoch])

  if (!open || (editingScope.current && (editingScope.current.owner !== owner || editingScope.current.epoch !== epoch))) return null

  const handleSave = async (keys: ApiKeys) => {
    keys = Object.freeze({ ...keys })
    const scope = editingScope.current, generation = ++saveGeneration.current
    const assertCurrent = () => {
      if (!scope || !openRef.current || generation !== saveGeneration.current ||
        scope.owner !== getActiveUserId() || scope.epoch !== getActiveSessionEpoch()) throw new CryptoContextChanged()
    }
    assertCurrent()
    // Never supersede a cold initializer before a committed key exists.
    await waitForCryptoInitialization()
    assertCurrent()
    let committed = false
    let transfer: GoogleKeyChange | null = null
    const previousKeysRaw = scoped.getItem('api-keys')
    let expectedKeysRaw = previousKeysRaw
    let attemptCurrent = captureCryptoGenerationGuard()
    const sameOwner = () => {
      try { return !!scope && scope.owner === getActiveUserId() && scope.epoch === getActiveSessionEpoch() }
      catch { return false }
    }
    try {
      try { transfer = await prepareGoogleKeyChange() }
      catch (error) {
        if (sameOwner()) toast(t('apiKeysModal.googleLoadingBeforeSave'), 'info')
        throw error
      }
      assertCurrent()
      if (scoped.getItem('api-keys') !== previousKeysRaw) throw new CryptoContextChanged()
      const initializing = initCrypto(keys.anthropic, {
        assertCurrent,
        commit: () => {
          assertCurrent()
          transfer?.begin()
          scoped.setJSON('api-keys', keys) // quota throws before candidate/active-key publication
          expectedKeysRaw = scoped.getItem('api-keys')
          attemptCurrent = captureCryptoGenerationGuard()
          setActiveKeys(keys.anthropic, keys.gemini, keys.mistral, keys.openai)
          committed = true
        },
      })
      // Also identify this attempt if derivation/commit fails and crypto rolls
      // back. A concurrent init, even failed, cannot be adopted by its finalizer.
      attemptCurrent = captureCryptoGenerationGuard()
      await initializing
    } finally {
      if (transfer) {
        const restored = await transfer.finish(() => sameOwner() && attemptCurrent() &&
          scoped.getItem('api-keys') === expectedKeysRaw)
        if (!restored && committed && sameOwner() && attemptCurrent() && transfer.isCurrent()) toast(t('apiKeysModal.savedGoogleUnavailable'), 'info')
      }
      if (sameOwner() && attemptCurrent() && isCryptoReady()) {
        void resumePendingLocalStorage().then(ok => {
          if (committed && ok === false && sameOwner() && attemptCurrent()) {
            toast(t('apiKeysModal.savedLoadingUnavailable'), 'info')
          }
        })
      }
    }
    // A committed transfer finishes independently of focus; never close a new
    // modal or another owner's view after an old save completes.
    if (sameOwner() && openRef.current && generation === saveGeneration.current) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-theme-ink/50"
      onClick={close}
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
}
