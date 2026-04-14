import { memo, useEffect, useState } from 'react'
import { ApiKeySetup } from './ApiKeySetup'
import type { ApiKeys } from '../../hooks/useApiKeys'
import * as scoped from '../../services/scopedStorage'
import { setActiveKeys } from '../../services/activeApiKey'
import { initCrypto } from '../../services/crypto'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Settings modal — lets the logged-in user edit their API keys in-app.
 * Reads the current keys from scoped storage, saves back (encrypted via
 * secureSet for the crypto check, plain JSON for sync reads per BUG 1).
 */
export const SettingsModal = memo(function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [initialKeys, setInitialKeys] = useState<ApiKeys | null>(null)

  useEffect(() => {
    if (!open) return
    const stored = scoped.getJSON<ApiKeys>('api-keys')
    setInitialKeys(stored ?? null)
  }, [open])

  // Close on Escape
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
    // Re-initialize crypto with the (possibly new) anthropic key
    await initCrypto(keys.anthropic)

    // Store as plain JSON (see BUG 1 in CLAUDE.md — must stay readable via getJSON)
    scoped.setJSON('api-keys', {
      anthropic: keys.anthropic,
      gemini: keys.gemini,
      mistral: keys.mistral,
      openai: keys.openai,
    })

    // Update in-memory active keys so AI clients pick up the new values immediately
    setActiveKeys(keys.anthropic, keys.gemini, keys.mistral, keys.openai)

    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="font-serif text-lg font-semibold text-bubble-user">
            Paramètres — Clés API
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            aria-label="Fermer"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          <ApiKeySetup onSave={handleSave} initialKeys={initialKeys} embedded />
        </div>
      </div>
    </div>
  )
})
