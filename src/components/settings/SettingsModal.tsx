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
import { DayNightToggle } from '../layout/DayNightToggle'
import {
  getPreference,
  setPreference,
  getTheme,
  type Theme,
  type ThemePreference,
} from '../../services/themeService'
import { Tag, Rule } from '../shared/editorial'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Paramètres — édition des clés API, apparence jour/nuit, notifications, mémoire.
 * BUG 1 : api-keys reste en JSON clair (lecture synchrone via getJSON).
 */
export const SettingsModal = memo(function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [initialKeys, setInitialKeys] = useState<ApiKeys | null>(null)
  const [notifEnabled, setNotifEnabled] = useState(false)
  const [showMemoryHistory, setShowMemoryHistory] = useState(false)
  const [showMemoryViewer, setShowMemoryViewer] = useState(false)
  const [themePref, setThemePref] = useState<ThemePreference>(getPreference)
  const [activeTheme, setActiveTheme] = useState<Theme>(getTheme)

  useEffect(() => {
    if (!open) return
    const stored = scoped.getJSON<ApiKeys>('api-keys')
    setInitialKeys(stored ?? null)
    setNotifEnabled(areNotificationsEnabled())
    setThemePref(getPreference())
    setActiveTheme(getTheme())
  }, [open])

  useEffect(() => {
    const sync = () => {
      setThemePref(getPreference())
      setActiveTheme(getTheme())
    }
    window.addEventListener('theme-changed', sync)
    return () => window.removeEventListener('theme-changed', sync)
  }, [])

  const handleThemePick = (next: Theme) => {
    setPreference(next)
    setThemePref(next)
    setActiveTheme(next)
  }

  const handleAutoToggle = (auto: boolean) => {
    const pref: ThemePreference = auto ? 'auto' : activeTheme
    setPreference(pref)
    setThemePref(pref)
    setActiveTheme(getTheme())
  }

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

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto"
        style={{
          backgroundColor: 'var(--arty-bg)',
          color: 'var(--arty-ink)',
          borderRadius: 4,
          border: '1px solid var(--arty-line)',
          boxShadow: '0 40px 80px -20px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Masthead — sticky */}
        <div
          className="sticky top-0 z-10 px-6 pt-4 pb-2"
          style={{ backgroundColor: 'var(--arty-bg)' }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="text-[20px] leading-none"
              style={{ color: 'var(--arty-ink)' }}
              aria-label="Fermer"
            >
              ←
            </button>
            <Tag>Paramètres</Tag>
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg"
              style={{ color: 'var(--arty-muted)' }}
              aria-label="Fermer"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <Rule className="mt-2" />
        </div>

        {/* Hero */}
        <div className="px-6 pt-5">
          <h1 className="font-display text-[30px] leading-[1.05] font-light tracking-[-0.02em]">
            Règle &
            <br />
            <span className="italic" style={{ color: 'var(--arty-accent)' }}>réglages.</span>
          </h1>
        </div>

        <div className="px-6 pt-5 pb-6 space-y-6">
          {/* I · Clés API */}
          <section>
            <div
              className="flex justify-between items-baseline pb-2 mb-3"
              style={{ borderBottom: '1px solid var(--arty-ink)' }}
            >
              <Tag>I · Clés API</Tag>
            </div>
            <ApiKeySetup onSave={handleSave} initialKeys={initialKeys} embedded />
          </section>

          {/* II · Apparence */}
          <section>
            <div
              className="flex justify-between items-baseline pb-2 mb-3"
              style={{ borderBottom: '1px solid var(--arty-ink)' }}
            >
              <Tag>II · Apparence</Tag>
              <Tag accent>{activeTheme === 'dark' ? '◈ Nocturne' : '◈ Ember'}</Tag>
            </div>
            <div className="flex items-center justify-between gap-4 mb-3">
              <p className="font-serif italic text-[13px] leading-[1.5]" style={{ color: 'var(--arty-ink-soft)' }}>
                Jour au grand jour,<br />nuit à la bougie.
              </p>
              <DayNightToggle theme={activeTheme} onChange={handleThemePick} size="md" />
            </div>
            <div
              className="flex gap-1 p-1"
              style={{ backgroundColor: 'var(--arty-card)', border: '1px solid var(--arty-line)', borderRadius: 2 }}
            >
              {[
                { k: false, l: 'Manuel' },
                { k: true, l: 'Auto · 07→19' },
              ].map((opt) => {
                const active = (themePref === 'auto') === opt.k
                return (
                  <button
                    key={String(opt.k)}
                    onClick={() => handleAutoToggle(opt.k)}
                    className="flex-1 py-2 text-[11px] tracking-[0.1em] uppercase font-semibold"
                    style={{
                      backgroundColor: active ? 'var(--arty-ink)' : 'transparent',
                      color: active ? 'var(--arty-bg)' : 'var(--arty-ink-soft)',
                      borderRadius: 2,
                    }}
                    aria-pressed={active}
                  >
                    {opt.l}
                  </button>
                )
              })}
            </div>
          </section>

          {/* III · Notifications */}
          <section>
            <div
              className="flex justify-between items-baseline pb-2 mb-3"
              style={{ borderBottom: '1px solid var(--arty-ink)' }}
            >
              <Tag>III · Notifications</Tag>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-serif text-[14px]" style={{ color: 'var(--arty-ink)' }}>
                  Rappels silencieux
                </p>
                <p className="font-serif italic text-[12px] mt-0.5" style={{ color: 'var(--arty-muted)' }}>
                  RDV à venir, mails importants.
                </p>
              </div>
              <button
                onClick={handleNotifToggle}
                className="relative inline-flex h-6 w-11 items-center transition-colors"
                style={{
                  backgroundColor: notifEnabled ? 'var(--arty-accent)' : 'var(--arty-card-hi)',
                  border: '1px solid var(--arty-line)',
                  borderRadius: 100,
                }}
                aria-pressed={notifEnabled}
              >
                <span
                  className="inline-block h-4 w-4 transform transition-transform"
                  style={{
                    backgroundColor: 'var(--arty-bg)',
                    borderRadius: 100,
                    transform: notifEnabled ? 'translateX(22px)' : 'translateX(4px)',
                  }}
                />
              </button>
            </div>
          </section>

          {/* IV · Mémoire */}
          <section>
            <div
              className="flex justify-between items-baseline pb-2 mb-3"
              style={{ borderBottom: '1px solid var(--arty-ink)' }}
            >
              <Tag>IV · Mémoire</Tag>
            </div>

            <button
              onClick={() => setShowMemoryViewer(true)}
              className="w-full flex items-center justify-between py-3 px-1 text-left"
              style={{ borderBottom: '1px dotted var(--arty-line)' }}
            >
              <div>
                <p className="font-serif text-[14px]" style={{ color: 'var(--arty-ink)' }}>
                  Ce qu'Arty sait de toi
                </p>
                <p className="font-serif italic text-[12px] mt-0.5" style={{ color: 'var(--arty-muted)' }}>
                  Voir et modifier la mémoire.
                </p>
              </div>
              <span className="font-serif italic text-[13px]" style={{ color: 'var(--arty-accent)' }}>
                ouvrir →
              </span>
            </button>

            <button
              onClick={() => setShowMemoryHistory(true)}
              className="w-full flex items-center justify-between py-3 px-1 text-left"
            >
              <div>
                <p className="font-serif text-[14px]" style={{ color: 'var(--arty-ink)' }}>
                  Historique des changements
                </p>
                <p className="font-serif italic text-[12px] mt-0.5" style={{ color: 'var(--arty-muted)' }}>
                  Annuler une mise à jour.
                </p>
              </div>
              <span className="font-serif italic text-[13px]" style={{ color: 'var(--arty-accent)' }}>
                voir →
              </span>
            </button>
          </section>

          {/* Orchestrateur — caché si pas lancé */}
          <OrchestratorSync />
        </div>
      </div>
      {showMemoryHistory && <MemoryHistoryPanel onClose={() => setShowMemoryHistory(false)} />}
      {showMemoryViewer && <MemoryViewer onClose={() => setShowMemoryViewer(false)} />}
    </div>
  )
})
