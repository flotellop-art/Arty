import { memo, useEffect, useState } from 'react'
import { ApiKeySetup } from './ApiKeySetup'
import type { ApiKeys } from '../../hooks/useApiKeys'
import { loadApiKeys, saveApiKeys } from '../../services/apiKeyStorage'
import { setActiveKeys } from '../../services/activeApiKey'
import { initCryptoForApiKey } from '../../services/cryptoPassphrase'

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
 * initCryptoForApiKey(), stockage chiffré strict, activation en mémoire via
 * setActiveKeys(), puis fermeture.
 */
export const ApiKeysModal = memo(function ApiKeysModal({ open, onClose }: ApiKeysModalProps) {
  const [initialKeys, setInitialKeys] = useState<ApiKeys | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    loadApiKeys()
      .then((stored) => {
        if (!cancelled) setInitialKeys(stored ?? null)
      })
      .catch(() => {
        if (!cancelled) setInitialKeys(null)
      })
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const handleSave = async (keys: ApiKeys) => {
    await initCryptoForApiKey(keys.anthropic)
    await saveApiKeys({
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
        className="bg-theme-bg text-theme-ink rounded-sm shadow-xl w-full max-w-md overflow-y-auto border border-theme-border"
        style={{ maxHeight: 'min(90vh, calc(var(--viewport-h, 100dvh) - 32px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 py-4 sticky top-0 bg-theme-bg z-10"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}
        >
          <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
            Clés API
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-theme-ink/5 text-theme-ink"
            aria-label="Fermer"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mx-6 h-[2px] bg-theme-ink" />
        <div className="mx-6 mt-[3px] h-px bg-theme-ink" />

        <div className="px-6 pt-6 pb-2">
          <h1 className="font-display font-medium text-[28px] leading-[1.05] -tracking-[0.02em] text-theme-ink">
            Tes <span className="italic text-theme-accent">clés.</span>
          </h1>
          <p className="font-display italic text-theme-muted text-sm mt-1">
            Chiffrées en AES-256 et stockées uniquement sur ton appareil.
          </p>
        </div>

        <div className="p-6">
          <ApiKeySetup onSave={handleSave} initialKeys={initialKeys} embedded />
        </div>
      </div>
    </div>
  )
})
