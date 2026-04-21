import { memo, useEffect, useState } from 'react'
import {
  areNotificationsEnabled,
  setNotificationsEnabled,
  requestPermission as requestNotifPermission,
} from '../../services/notificationService'
import {
  isLocationConsentEnabled,
  setLocationConsent,
  requestLocationPermission,
  clearLocationCache,
  getUserLocation,
  type UserLocation,
} from '../../services/native/location'
import {
  getLastLocationDebugSnapshot,
  type LocationDebugSnapshot,
} from '../../services/locationContext'
import { fetchQuotaStatus, type QuotaStatus } from '../../services/quotaStatus'
import {
  activateLicense,
  getProLicense,
  type ProLicenseState,
} from '../../services/proLicense'
import {
  isPromptEnhancementEnabled,
  setPromptEnhancementEnabled,
  getEnhancerModel,
  setEnhancerModel,
  type EnhancerModel,
} from '../../services/promptEnhancerSettings'
import { MemoryHistoryPanel } from './MemoryHistoryPanel'
import { MemoryViewer } from './MemoryViewer'
import { OrchestratorSync } from './OrchestratorSync'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Modal Paramètres — notifications, géolocalisation, mémoire, historique,
 * quota, sync orchestrateur, version du bundle.
 *
 * Depuis 1.0.41, les clés API sont dans une modal séparée (ApiKeysModal).
 */
export const SettingsModal = memo(function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [notifEnabled, setNotifEnabled] = useState(false)
  const [locationEnabled, setLocationEnabled] = useState(false)
  const [locationFix, setLocationFix] = useState<UserLocation | null>(null)
  const [locationChecking, setLocationChecking] = useState(false)
  const [locationDebug, setLocationDebug] = useState<LocationDebugSnapshot | null>(null)
  const [showLocationDebug, setShowLocationDebug] = useState(false)
  const [enhanceEnabled, setEnhanceEnabled] = useState(false)
  const [enhanceModel, setEnhanceModelState] = useState<EnhancerModel>('haiku')
  const [showMemoryHistory, setShowMemoryHistory] = useState(false)
  const [showMemoryViewer, setShowMemoryViewer] = useState(false)
  const [showQuota, setShowQuota] = useState(false)
  const [quotaStatus, setQuotaStatus] = useState<QuotaStatus | null>(null)
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [proLicense, setProLicense] = useState<ProLicenseState | null>(getProLicense)
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseEmail, setLicenseEmail] = useState('')
  const [licenseSubmitting, setLicenseSubmitting] = useState(false)
  const [licenseError, setLicenseError] = useState('')
  const [licenseSuccess, setLicenseSuccess] = useState('')

  useEffect(() => {
    if (!open) return
    setNotifEnabled(areNotificationsEnabled())
    setLocationEnabled(isLocationConsentEnabled())
    setLocationFix(null)
    setProLicense(getProLicense())
    setLicenseError('')
    setLicenseSuccess('')
    setEnhanceEnabled(isPromptEnhancementEnabled())
    setEnhanceModelState(getEnhancerModel())
  }, [open])

  const handleActivateLicense = async (e: React.FormEvent) => {
    e.preventDefault()
    if (licenseSubmitting) return
    setLicenseError('')
    setLicenseSuccess('')
    setLicenseSubmitting(true)
    const result = await activateLicense(licenseKey, licenseEmail)
    setLicenseSubmitting(false)
    if (result.ok) {
      setProLicense(result.state)
      setLicenseSuccess(
        'Licence activée ! Tu as maintenant accès à Arty Pro.'
      )
      setLicenseKey('')
    } else {
      setLicenseError(result.error)
    }
  }

  const checkLocationAccuracy = async () => {
    setLocationChecking(true)
    clearLocationCache()
    const fix = await getUserLocation()
    setLocationFix(fix)
    setLocationChecking(false)
  }

  const openQuotaModal = async () => {
    setShowQuota(true)
    setQuotaLoading(true)
    const status = await fetchQuotaStatus()
    setQuotaStatus(status)
    setQuotaLoading(false)
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

  const handleLocationToggle = async () => {
    if (!locationEnabled) {
      const granted = await requestLocationPermission()
      if (!granted) return
      setLocationConsent(true)
      setLocationEnabled(true)
    } else {
      setLocationConsent(false)
      clearLocationCache()
      setLocationEnabled(false)
    }
  }

  const handleEnhanceToggle = () => {
    const next = !enhanceEnabled
    setPromptEnhancementEnabled(next)
    setEnhanceEnabled(next)
  }

  const handleEnhanceModelChange = (model: EnhancerModel) => {
    setEnhancerModel(model)
    setEnhanceModelState(model)
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
            Tes <span className="italic text-theme-accent">préférences.</span>
          </h1>
          <p className="font-display italic text-theme-muted text-sm mt-1">
            Notifications, localisation, mémoire, quota.
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Notifications toggle */}
          <div>
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

          {/* Location toggle */}
          <div className="border-t border-theme-border pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-base text-theme-ink">📍 Localisation</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  Recherches de proximité (restaurants, itinéraires, météo)
                </p>
              </div>
              <button
                onClick={handleLocationToggle}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  locationEnabled ? 'bg-theme-accent' : 'bg-theme-ink/20'
                }`}
                aria-pressed={locationEnabled}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-theme-bg transition-transform ${
                    locationEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            {locationEnabled && (
              <div className="mt-3 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-display italic text-xs text-theme-muted">
                    {locationChecking
                      ? 'Mesure en cours (peut prendre 10s)…'
                      : locationFix
                        ? locationFix.accuracy <= 50
                          ? `Précision : ${Math.round(locationFix.accuracy)} m (GPS) ✓`
                          : locationFix.accuracy <= 5000
                            ? `Précision : ${Math.round(locationFix.accuracy)} m (moyen)`
                            : `Précision : ~${Math.round(locationFix.accuracy / 1000)} km (Wi-Fi/IP) — imprécis`
                        : 'Précision non mesurée'}
                  </p>
                  <button
                    onClick={checkLocationAccuracy}
                    disabled={locationChecking}
                    className="font-display italic text-xs text-theme-accent hover:underline disabled:opacity-50"
                  >
                    Tester
                  </button>
                </div>
                {locationFix && !locationChecking && (
                  <p className="font-display italic text-[11px] text-theme-muted/80">
                    Coords : {locationFix.latitude.toFixed(5)}° N, {locationFix.longitude.toFixed(5)}° E
                  </p>
                )}
                <button
                  onClick={() => {
                    setLocationDebug(getLastLocationDebugSnapshot())
                    setShowLocationDebug(true)
                  }}
                  className="font-display italic text-[11px] text-theme-accent/80 hover:underline mt-1"
                >
                  Voir dernière position envoyée à Arty
                </button>
              </div>
            )}
          </div>

          {/* Prompt enhancement toggle (1.0.14) */}
          <div className="border-t border-theme-border pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-base text-theme-ink">✨ Amélioration du prompt</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  Reformule ton message avant l'envoi
                </p>
              </div>
              <button
                onClick={handleEnhanceToggle}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  enhanceEnabled ? 'bg-theme-accent' : 'bg-theme-ink/20'
                }`}
                aria-pressed={enhanceEnabled}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-theme-bg transition-transform ${
                    enhanceEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            {enhanceEnabled && (
              <div className="mt-3 flex items-center justify-between gap-4">
                <label className="font-display italic text-xs text-theme-muted">Modèle</label>
                <select
                  value={enhanceModel}
                  onChange={(e) => handleEnhanceModelChange(e.target.value as EnhancerModel)}
                  className="text-xs bg-theme-surface border border-theme-border rounded px-2 py-1 text-theme-ink focus:outline-none focus:border-theme-accent"
                >
                  <option value="haiku">Claude Haiku (US)</option>
                  <option value="mistral">Mistral Small (EU)</option>
                </select>
              </div>
            )}
          </div>

          {/* Upgrade entry */}
          <div className="border-t border-theme-border pt-5">
            <button
              onClick={() => {
                onClose()
                window.dispatchEvent(new CustomEvent('arty-open-upgrade'))
              }}
              className="w-full flex items-center justify-between text-left"
            >
              <div>
                <p className="font-display text-base text-theme-ink">⭐ Upgrade</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  Pro à vie, abonnement, pack +100 messages
                </p>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-theme-accent">
                <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
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

          {/* Quota journalier par modèle (uniquement pour users whitelistés
              qui utilisent la clé serveur) */}
          <div className="border-t border-theme-border pt-5">
            <button
              onClick={openQuotaModal}
              className="w-full flex items-center justify-between text-left"
            >
              <div>
                <p className="font-display text-base text-theme-ink">📊 Mon quota du jour</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  Appels par modèle et coût estimé
                </p>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-theme-accent">
                <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Dashboard coûts — local, basé sur les tokens réels capturés
              côté client (cf. costTracker.ts). */}
          <div className="border-t border-theme-border pt-5">
            <button
              onClick={() => {
                onClose()
                window.dispatchEvent(new CustomEvent('arty-open-costs'))
              }}
              className="w-full flex items-center justify-between text-left"
            >
              <div>
                <p className="font-display text-base text-theme-ink">💸 Mes coûts</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  Dashboard mensuel, par modèle, alerte budget, export CSV
                </p>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-theme-accent">
                <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Orchestrateur sync (Phase 1) — invisible si l'app desktop n'est pas lancée */}
          <OrchestratorSync />

          {/* Licence Pro */}
          <div className="border-t border-theme-border pt-5 keyboard-aware">
            <p className="font-display text-base text-theme-ink">⭐ Licence Pro</p>
            <p className="font-display italic text-xs text-theme-muted mt-0.5">
              {proLicense
                ? `Activée pour ${proLicense.email}`
                : 'Active une clé Arty Pro pour débloquer l’accès illimité.'}
            </p>
            {proLicense ? (
              <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-pill bg-theme-accent text-theme-bg font-sans text-[10px] font-semibold uppercase tracking-kicker">
                Pro · activée
              </div>
            ) : (
              <form onSubmit={handleActivateLicense} className="mt-3 space-y-2">
                <input
                  type="email"
                  value={licenseEmail}
                  onChange={(e) => setLicenseEmail(e.target.value)}
                  placeholder="ton.email@exemple.com"
                  autoComplete="email"
                  className="w-full bg-transparent border border-theme-border rounded-sm px-3 py-2 font-sans text-sm text-theme-ink placeholder:text-theme-muted/60 focus:outline-none focus:border-theme-accent transition-colors"
                />
                <input
                  type="text"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="Clé de licence"
                  autoComplete="off"
                  className="w-full bg-transparent border border-theme-border rounded-sm px-3 py-2 font-mono text-sm text-theme-ink placeholder:text-theme-muted/60 focus:outline-none focus:border-theme-accent transition-colors"
                />
                <button
                  type="submit"
                  disabled={licenseSubmitting || !licenseKey.trim() || !licenseEmail.trim()}
                  className="w-full py-2.5 font-display italic text-sm font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {licenseSubmitting ? 'Activation…' : 'Activer'}
                </button>
                {licenseError && (
                  <p className="font-sans text-xs text-theme-accent">{licenseError}</p>
                )}
                {licenseSuccess && (
                  <p className="font-sans text-xs text-emerald-600 dark:text-emerald-400">
                    {licenseSuccess}
                  </p>
                )}
              </form>
            )}
          </div>

          {/* Version du bundle JS — séparée du versionName Android (qui vient
              de build.gradle). Si les deux divergent, cowork n'a pas refait
              `npm run build` avant `npx cap sync` lors du build APK. */}
          <div className="border-t border-theme-border pt-5 text-center">
            <p className="font-mono text-[10px] text-theme-muted">
              Arty v{__APP_VERSION__} · build {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}
            </p>
          </div>
        </div>
      </div>
      {showMemoryHistory && <MemoryHistoryPanel onClose={() => setShowMemoryHistory(false)} />}
      {showMemoryViewer && <MemoryViewer onClose={() => setShowMemoryViewer(false)} />}
      {showQuota && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-theme-ink/50"
          onClick={() => setShowQuota(false)}
        >
          <div
            className="bg-theme-bg text-theme-ink rounded-sm shadow-xl w-full max-w-md border border-theme-border p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-base text-theme-ink">📊 Mon quota du jour</p>
            {quotaLoading ? (
              <p className="font-display italic text-xs text-theme-muted">Chargement…</p>
            ) : quotaStatus ? (
              <>
                <p className="font-display italic text-xs text-theme-muted">
                  {quotaStatus.day} (UTC) — reset à minuit UTC
                </p>
                <div className="border border-theme-border rounded-sm p-3 bg-theme-ink/5">
                  <p className="font-display text-sm text-theme-ink">
                    <strong>{quotaStatus.total}</strong> / {quotaStatus.limit} appels aujourd'hui
                  </p>
                  <div className="mt-2 h-2 bg-theme-ink/10 rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-theme-accent transition-all"
                      style={{
                        width: `${Math.min(100, (quotaStatus.total / Math.max(1, quotaStatus.limit)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="font-mono text-xs text-theme-ink mt-2">
                    Coût : ${quotaStatus.totalCostUsd.toFixed(4)} (tokens réels)
                  </p>
                </div>
                {quotaStatus.byModel.length > 0 ? (
                  <div className="space-y-2">
                    <p className="font-display text-xs text-theme-muted">Détail par modèle :</p>
                    {quotaStatus.byModel.map((m) => {
                      const pct = Math.min(100, (m.count / Math.max(1, m.limit)) * 100)
                      const nearLimit = pct >= 80
                      return (
                        <div key={m.model} className="space-y-0.5">
                          <div className="flex items-center justify-between font-mono text-xs text-theme-ink">
                            <span className="truncate pr-2">{m.model}</span>
                            <span className={nearLimit ? 'text-theme-accent' : ''}>
                              {m.count} / {m.limit} · ${m.costUsd.toFixed(4)}
                            </span>
                          </div>
                          <div className="h-1.5 bg-theme-ink/10 rounded-sm overflow-hidden">
                            <div
                              className={`h-full transition-all ${nearLimit ? 'bg-red-500' : 'bg-theme-accent'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="font-display italic text-xs text-theme-muted">
                    Aucun appel facturé aujourd'hui (ou tu utilises une clé BYOK, non comptée).
                  </p>
                )}
                <p className="font-display italic text-[10px] text-theme-muted">
                  Coûts calculés serveur-side à partir des tokens réels capturés dans chaque stream
                  (précision ~3%). Facture officielle : Anthropic Console / OpenAI Platform /
                  Mistral / Google AI Studio.
                </p>
              </>
            ) : (
              <p className="font-display italic text-xs text-theme-muted">
                Quota non disponible (tu n'es peut-être pas whitelisté pour la clé serveur, ou tu
                utilises une clé BYOK).
              </p>
            )}
            <button
              onClick={() => setShowQuota(false)}
              className="font-display italic text-xs text-theme-accent hover:underline"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
      {showLocationDebug && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-theme-ink/50"
          onClick={() => setShowLocationDebug(false)}
        >
          <div
            className="bg-theme-bg text-theme-ink rounded-sm shadow-xl w-full max-w-md border border-theme-border p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-base text-theme-ink">Dernière position envoyée à Arty</p>
            {locationDebug ? (
              <>
                <p className="font-display italic text-xs text-theme-muted">
                  Il y a {Math.round((Date.now() - locationDebug.at) / 1000)}s — question : « {locationDebug.message.slice(0, 60)}{locationDebug.message.length > 60 ? '…' : ''} »
                </p>
                {locationDebug.position ? (
                  <p className="font-mono text-xs text-theme-ink">
                    {locationDebug.position.latitude.toFixed(5)}° N, {locationDebug.position.longitude.toFixed(5)}° E
                    <br />
                    Précision : {Math.round(locationDebug.position.accuracy)} m
                  </p>
                ) : (
                  <p className="font-display italic text-xs text-theme-muted">Position non disponible (GPS indisponible ou trigger non matché)</p>
                )}
                {locationDebug.position && (
                  locationDebug.geocoded?.city ? (
                    <p className="font-display text-xs text-theme-ink">
                      Ville reverse-geocodée : <strong>{locationDebug.geocoded.city}</strong>
                      {locationDebug.geocoded.county && ` (${locationDebug.geocoded.county}${locationDebug.geocoded.countyCode ? `, ${locationDebug.geocoded.countyCode}` : ''})`}
                      {locationDebug.geocoded.country && `, ${locationDebug.geocoded.country}`}
                    </p>
                  ) : (
                    <p className="font-display italic text-xs text-theme-muted">Reverse geocoding : non résolu (Google Maps indisponible ou coords en mer) — Arty reçoit juste les coords</p>
                  )
                )}
                <details className="text-[11px] text-theme-muted">
                  <summary className="cursor-pointer">Voir le bloc complet injecté dans le prompt</summary>
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-[10px] leading-tight max-h-60 overflow-y-auto bg-theme-ink/5 p-2 rounded">
                    {locationDebug.injectedText || '(vide — aucun texte injecté)'}
                  </pre>
                </details>
              </>
            ) : (
              <p className="font-display italic text-xs text-theme-muted">Aucune question de localisation posée depuis le démarrage de l'app.</p>
            )}
            <button
              onClick={() => setShowLocationDebug(false)}
              className="font-display italic text-xs text-theme-accent hover:underline"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  )
})
