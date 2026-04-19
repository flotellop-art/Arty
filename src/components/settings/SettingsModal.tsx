import { memo, useEffect, useState } from 'react'
import { ApiKeySetup } from './ApiKeySetup'
import type { ApiKeys } from '../../hooks/useApiKeys'
import * as scoped from '../../services/scopedStorage'
import { setActiveKeys } from '../../services/activeApiKey'
import { initCrypto } from '../../services/crypto'
import {
  areNotificationsEnabled,
  setNotificationsEnabled,
  requestPermission as requestNotifPermission,
} from '../../services/notificationService'
import { MemoryHistoryPanel } from './MemoryHistoryPanel'
import { MemoryViewer } from './MemoryViewer'
import { OrchestratorSync } from './OrchestratorSync'

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
  const [notifEnabled, setNotifEnabled] = useState(false)
  const [showMemoryHistory, setShowMemoryHistory] = useState(false)
  const [showMemoryViewer, setShowMemoryViewer] = useState(false)

  useEffect(() => {
    if (!open) return
    const stored = scoped.getJSON<ApiKeys>('api-keys')
    setInitialKeys(stored ?? null)
    setNotifEnabled(areNotificationsEnabled())
  }, [open])

  const handleNotifToggle = async () => {
    if (!notifEnabled) {
      const perm = await requestNotifPermission()
      if (perm !== 'granted') return
      setNotificationsEnabled(true)
      setNotifEnabled(true)
    } else {
      setNotificationsEnabled(false)
      setNotifEnabled(false)
    }
  }

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-theme-ink/50"
      onClick={onClose}
    >
      <div
        className="bg-theme-bg text-theme-ink rounded-sm shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto border border-theme-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 sticky top-0 bg-theme-bg z-10">
          <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
            Paramètres
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
            Stockées chiffrées sur cet appareil.
          </p>
        </div>

        <div className="p-6 space-y-6">
          <ApiKeySetup onSave={handleSave} initialKeys={initialKeys} embedded />

          {/* Notifications toggle */}
          <div className="border-t border-theme-border pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-base text-theme-ink">🔔 Notifications</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  Rappels RDV, emails importants
                </p>
              </div>
              <button
                onClick={handleNotifToggle}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  notifEnabled ? 'bg-theme-accent' : 'bg-theme-ink/20'
                }`}
                aria-pressed={notifEnabled}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-theme-bg transition-transform ${
                    notifEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Memory viewer */}
          <div className="border-t border-theme-border pt-5">
            <button
              onClick={() => setShowMemoryViewer(true)}
              className="w-full flex items-center justify-between text-left"
            >
              <div>
                <p className="font-display text-base text-theme-ink">🧠 Mémoire d'Arty</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  Voir et modifier ce qu'Arty sait sur vous
                </p>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-theme-accent">
                <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Memory history */}
          <div className="border-t border-theme-border pt-5">
            <button
              onClick={() => setShowMemoryHistory(true)}
              className="w-full flex items-center justify-between text-left"
            >
              <div>
                <p className="font-display text-base text-theme-ink">📜 Historique mémoire</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  Voir et annuler les changements de mémoire
                </p>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-theme-accent">
                <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Orchestrateur sync (Phase 1) — invisible si l'app desktop n'est pas lancée */}
          <OrchestratorSync />
        </div>
      </div>
      {showMemoryHistory && <MemoryHistoryPanel onClose={() => setShowMemoryHistory(false)} />}
      {showMemoryViewer && <MemoryViewer onClose={() => setShowMemoryViewer(false)} />}
    </div>
  )
})
