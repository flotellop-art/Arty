import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  getGeolocationPermissionState,
  type UserLocation,
  type GeolocationPermissionState,
} from '../../services/native/location'
import { isNative } from '../../services/native/platform'
import {
  getLastLocationDebugSnapshot,
  type LocationDebugSnapshot,
} from '../../services/locationContext'
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
import {
  getFactCheckMode,
  setFactCheckMode,
  type FactCheckMode,
} from '../../services/factChecker'
import {
  isProactiveBriefEnabled,
  setProactiveBriefEnabled,
} from '../../services/proactiveBriefSettings'
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
  const { t } = useTranslation()
  const [notifEnabled, setNotifEnabled] = useState(false)
  const [locationEnabled, setLocationEnabled] = useState(false)
  const [locationFix, setLocationFix] = useState<UserLocation | null>(null)
  const [locationChecking, setLocationChecking] = useState(false)
  const [locationDebug, setLocationDebug] = useState<LocationDebugSnapshot | null>(null)
  const [showLocationDebug, setShowLocationDebug] = useState(false)
  const [enhanceEnabled, setEnhanceEnabled] = useState(false)
  const [enhanceModel, setEnhanceModelState] = useState<EnhancerModel>('haiku')
  const [briefEnabled, setBriefEnabled] = useState(false)
  const [factCheckMode, setFactCheckModeState] = useState<FactCheckMode>(getFactCheckMode)
  const [showMemoryHistory, setShowMemoryHistory] = useState(false)
  const [showMemoryViewer, setShowMemoryViewer] = useState(false)
  const [proLicense, setProLicense] = useState<ProLicenseState | null>(getProLicense)
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseEmail, setLicenseEmail] = useState('')
  const [licenseSubmitting, setLicenseSubmitting] = useState(false)
  const [licenseError, setLicenseError] = useState('')
  const [licenseSuccess, setLicenseSuccess] = useState('')

  const [browserPermState, setBrowserPermState] =
    useState<GeolocationPermissionState | null>(null)

  // H-React-3 (audit étape 8) — mounted ref pour éviter les setState
  // post-unmount dans handleActivateLicense (le fetch peut prendre
  // plusieurs secondes, l'user peut fermer la modal entre temps).
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

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
    setBriefEnabled(isProactiveBriefEnabled())
    // L'état réel de la permission browser géoloc — peut être 'denied' alors
    // que le toggle Arty est ON (cas Chrome qui bloque silencieusement).
    if (!isNative) {
      getGeolocationPermissionState().then(setBrowserPermState)
    }
  }, [open])

  const handleActivateLicense = async (e: React.FormEvent) => {
    e.preventDefault()
    if (licenseSubmitting) return
    setLicenseError('')
    setLicenseSuccess('')
    setLicenseSubmitting(true)
    const result = await activateLicense(licenseKey, licenseEmail)
    // H-React-3 — guard contre setState post-unmount (modal fermée pendant
    // la requête réseau). Le résultat est perdu si user a fermé entre temps,
    // c'est OK : la licence sera lue depuis le storage à la prochaine ouverture.
    if (!isMountedRef.current) return
    setLicenseSubmitting(false)
    if (result.ok) {
      setProLicense(result.state)
      setLicenseSuccess(t('settings.license.success'))
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
      // Sur natif (APK Capacitor), un refus système est définitif tant que
      // l'utilisateur n'ouvre pas les Paramètres Android — on garde le
      // toggle OFF pour refléter l'état réel.
      // Sur web, en revanche, getCurrentPosition() peut retourner false
      // silencieusement (timeout, permission Chrome dans un état ambigu)
      // sans qu'on puisse distinguer un vrai refus d'un blip réseau —
      // bloquer le toggle dans ce cas crée un cul-de-sac (le user clique
      // ON, ça reste OFF). On active le consent applicatif quand même :
      // si le navigateur a réellement bloqué, le user peut réautoriser
      // via l'icône cadenas Chrome.
      if (!granted && isNative) return
      setLocationConsent(true)
      setLocationEnabled(true)
    } else {
      setLocationConsent(false)
      clearLocationCache()
      setLocationEnabled(false)
    }
    // Re-query l'état réel après l'action pour mettre à jour le warning UI.
    if (!isNative) {
      const state = await getGeolocationPermissionState()
      setBrowserPermState(state)
    }
  }

  const handleEnhanceToggle = () => {
    const next = !enhanceEnabled
    setPromptEnhancementEnabled(next)
    setEnhanceEnabled(next)
  }

  const handleBriefToggle = async () => {
    const next = !briefEnabled
    setProactiveBriefEnabled(next)
    setBriefEnabled(next)
    // À l'activation, on propose les notifs pour que le rappel quotidien
    // (nudge 8h) puisse fonctionner. Refus = le brief marche quand même,
    // juste sans notification.
    if (next && !notifEnabled) {
      const perm = await requestNotifPermission()
      if (perm === 'granted') {
        setNotificationsEnabled(true)
        setNotifEnabled(true)
      }
    }
  }

  const handleEnhanceModelChange = (model: EnhancerModel) => {
    setEnhancerModel(model)
    setEnhanceModelState(model)
  }

  const handleFactCheckModeChange = (mode: FactCheckMode) => {
    setFactCheckMode(mode)
    setFactCheckModeState(mode)
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
            {t('settings.kicker')}
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-theme-ink/5 text-theme-ink"
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
          <h1 className="font-display font-medium text-[28px] leading-[1.05] -tracking-[0.02em] text-theme-ink">
            {t('settings.titleMain')} <span className="italic text-theme-accent">{t('settings.titleAccent')}</span>
          </h1>
          <p className="font-display italic text-theme-muted text-sm mt-1">
            {t('settings.subtitle')}
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Notifications toggle */}
          <div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-base text-theme-ink">🔔 {t('settings.notifications.title')}</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  {t('settings.notifications.description')}
                </p>
              </div>
              <button
                onClick={handleNotifToggle}
                aria-label={t('settings.notifications.toggleAria')}
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

          {/* Proactive brief toggle */}
          <div className="border-t border-theme-border pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-base text-theme-ink">🗞️ {t('settings.proactiveBrief.title')}</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  {t('settings.proactiveBrief.description')}
                </p>
              </div>
              <button
                onClick={handleBriefToggle}
                aria-label={t('settings.proactiveBrief.toggleAria')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  briefEnabled ? 'bg-theme-accent' : 'bg-theme-ink/20'
                }`}
                aria-pressed={briefEnabled}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-theme-bg transition-transform ${
                    briefEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Location toggle */}
          <div className="border-t border-theme-border pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-base text-theme-ink">📍 {t('settings.location.title')}</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  {t('settings.location.description')}
                </p>
              </div>
              <button
                onClick={handleLocationToggle}
                aria-label={t('settings.location.toggleAria')}
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
                      ? t('settings.location.measuring')
                      : locationFix
                        ? locationFix.accuracy <= 50
                          ? t('settings.location.accuracyGps', { m: Math.round(locationFix.accuracy) })
                          : locationFix.accuracy <= 5000
                            ? t('settings.location.accuracyMedium', { m: Math.round(locationFix.accuracy) })
                            : t('settings.location.accuracyPoor', { km: Math.round(locationFix.accuracy / 1000) })
                        : t('settings.location.accuracyUnknown')}
                  </p>
                  <button
                    onClick={checkLocationAccuracy}
                    disabled={locationChecking}
                    className="font-display italic text-xs text-theme-accent hover:underline disabled:opacity-50"
                  >
                    {t('settings.location.test')}
                  </button>
                </div>
                {locationFix && !locationChecking && (
                  <p className="font-display italic text-[11px] text-theme-muted">
                    {t('settings.location.coords', { lat: locationFix.latitude.toFixed(5), lon: locationFix.longitude.toFixed(5) })}
                  </p>
                )}
                {!isNative && locationEnabled && browserPermState === 'denied' && (
                  <div className="mt-2 p-3 rounded-sm bg-red-500/10 border border-red-500/30">
                    <p className="font-display italic text-xs text-red-700 dark:text-red-400">
                      {t('settings.location.blockedLine1')}
                    </p>
                    <p className="font-display italic text-[11px] text-red-600/90 dark:text-red-300/80 mt-1.5">
                      {t('settings.location.blockedLine2')}
                    </p>
                  </div>
                )}
                <button
                  onClick={() => {
                    setLocationDebug(getLastLocationDebugSnapshot())
                    setShowLocationDebug(true)
                  }}
                  className="font-display italic text-[11px] text-theme-accent/80 hover:underline mt-1"
                >
                  {t('settings.location.viewLastPosition')}
                </button>
              </div>
            )}
          </div>

          {/* Prompt enhancement toggle (1.0.14) */}
          <div className="border-t border-theme-border pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-base text-theme-ink">✨ {t('settings.enhance.title')}</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  {t('settings.enhance.description')}
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
                <label className="font-display italic text-xs text-theme-muted">{t('settings.enhance.modelLabel')}</label>
                <select
                  value={enhanceModel}
                  onChange={(e) => handleEnhanceModelChange(e.target.value as EnhancerModel)}
                  className="text-xs bg-theme-surface border border-theme-border rounded px-2 py-1 text-theme-ink focus:outline-none focus:border-theme-accent"
                >
                  <option value="haiku">Claude Haiku (US)</option>
                  <option value="mistral">Mistral Medium 3.5 (EU)</option>
                </select>
              </div>
            )}
          </div>

          {/* Fact-checker toggle */}
          <div className="border-t border-theme-border pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-base text-theme-ink">🔎 Fact-checker</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  {t('settings.factChecker.description')}
                </p>
              </div>
              <select
                value={factCheckMode}
                onChange={(e) => handleFactCheckModeChange(e.target.value as FactCheckMode)}
                className="text-xs bg-theme-surface border border-theme-border rounded px-2 py-1 text-theme-ink focus:outline-none focus:border-theme-accent shrink-0"
              >
                <option value="off">{t('settings.factChecker.off')}</option>
                <option value="auto">{t('settings.factChecker.auto')}</option>
                <option value="haiku">{t('settings.factChecker.haiku')}</option>
                <option value="sonnet">{t('settings.factChecker.sonnet')}</option>
              </select>
            </div>
            {factCheckMode !== 'off' && (
              <p className="font-display italic text-[11px] text-theme-muted mt-2">
                {factCheckMode === 'auto'
                  ? t('settings.factChecker.costAuto')
                  : factCheckMode === 'haiku'
                  ? t('settings.factChecker.costHaiku')
                  : t('settings.factChecker.costSonnet')}
              </p>
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
                  {t('settings.upgrade.description')}
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
                <p className="font-display text-base text-theme-ink">🧠 {t('settings.memory.title')}</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  {t('settings.memory.description')}
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
                <p className="font-display text-base text-theme-ink">📜 {t('settings.memoryHistory.title')}</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  {t('settings.memoryHistory.description')}
                </p>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-theme-accent">
                <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Dashboard coûts — agrégé serveur (table `quota_model`) avec
              fallback local. Remplace l'ancien "Mon quota du jour" qui faisait
              double emploi avec le panel sidebar de l'écran d'accueil. */}
          <div className="border-t border-theme-border pt-5">
            <button
              onClick={() => {
                onClose()
                window.dispatchEvent(new CustomEvent('arty-open-costs'))
              }}
              className="w-full flex items-center justify-between text-left"
            >
              <div>
                <p className="font-display text-base text-theme-ink">💸 {t('settings.costs.title')}</p>
                <p className="font-display italic text-xs text-theme-muted mt-0.5">
                  {t('settings.costs.description')}
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
            <p className="font-display text-base text-theme-ink">⭐ {t('settings.license.title')}</p>
            <p className="font-display italic text-xs text-theme-muted mt-0.5">
              {proLicense
                ? t('settings.license.activatedFor', { email: proLicense.email })
                : t('settings.license.prompt')}
            </p>
            {proLicense ? (
              <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-pill bg-theme-accent text-theme-bg font-sans text-[10px] font-semibold uppercase tracking-kicker">
                {t('settings.license.badge')}
              </div>
            ) : (
              <form onSubmit={handleActivateLicense} className="mt-3 space-y-2">
                <input
                  type="email"
                  value={licenseEmail}
                  onChange={(e) => setLicenseEmail(e.target.value)}
                  placeholder={t('settings.license.emailPlaceholder')}
                  autoComplete="email"
                  className="w-full bg-transparent border border-theme-border rounded-sm px-3 py-2 font-sans text-sm text-theme-ink placeholder:text-theme-muted focus:outline-none focus:border-theme-accent transition-colors"
                />
                <input
                  type="text"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder={t('settings.license.keyPlaceholder')}
                  autoComplete="off"
                  className="w-full bg-transparent border border-theme-border rounded-sm px-3 py-2 font-mono text-sm text-theme-ink placeholder:text-theme-muted focus:outline-none focus:border-theme-accent transition-colors"
                />
                <button
                  type="submit"
                  disabled={licenseSubmitting || !licenseKey.trim() || !licenseEmail.trim()}
                  className="w-full py-2.5 font-display italic text-sm font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {licenseSubmitting ? t('settings.license.activating') : t('settings.license.activate')}
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
      {showLocationDebug && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-theme-ink/50"
          onClick={() => setShowLocationDebug(false)}
        >
          <div
            className="bg-theme-bg text-theme-ink rounded-sm shadow-xl w-full max-w-md border border-theme-border p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-base text-theme-ink">{t('settings.debug.title')}</p>
            {locationDebug ? (
              <>
                <p className="font-display italic text-xs text-theme-muted">
                  {t('settings.debug.snapshot', { seconds: Math.round((Date.now() - locationDebug.at) / 1000), message: locationDebug.message.slice(0, 60) + (locationDebug.message.length > 60 ? '…' : '') })}
                </p>
                {locationDebug.position ? (
                  <p className="font-mono text-xs text-theme-ink">
                    {locationDebug.position.latitude.toFixed(5)}° N, {locationDebug.position.longitude.toFixed(5)}° E
                    <br />
                    {t('settings.debug.accuracy', { m: Math.round(locationDebug.position.accuracy) })}
                  </p>
                ) : (
                  <p className="font-display italic text-xs text-theme-muted">{t('settings.debug.noPosition')}</p>
                )}
                {locationDebug.position && (
                  locationDebug.geocoded?.city ? (
                    <p className="font-display text-xs text-theme-ink">
                      {t('settings.debug.geocodedLabel')} <strong>{locationDebug.geocoded.city}</strong>
                      {locationDebug.geocoded.county && ` (${locationDebug.geocoded.county}${locationDebug.geocoded.countyCode ? `, ${locationDebug.geocoded.countyCode}` : ''})`}
                      {locationDebug.geocoded.country && `, ${locationDebug.geocoded.country}`}
                    </p>
                  ) : (
                    <p className="font-display italic text-xs text-theme-muted">{t('settings.debug.geocodingFailed')}</p>
                  )
                )}
                <details className="text-[11px] text-theme-muted">
                  <summary className="cursor-pointer">{t('settings.debug.viewBlock')}</summary>
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-[10px] leading-tight max-h-60 overflow-y-auto bg-theme-ink/5 p-2 rounded">
                    {locationDebug.injectedText || t('settings.debug.emptyInjected')}
                  </pre>
                </details>
              </>
            ) : (
              <p className="font-display italic text-xs text-theme-muted">{t('settings.debug.noQuery')}</p>
            )}
            <button
              onClick={() => setShowLocationDebug(false)}
              className="font-display italic text-xs text-theme-accent hover:underline"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
})
