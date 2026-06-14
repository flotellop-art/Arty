/**
 * OrchestratorSync — section de paramètres Phase 1.
 *
 * Détecte l'app desktop Orchestrateur en local et permet de lui pousser
 * la clé Anthropic active d'Arty en un clic. Invisible si l'Orchestrateur
 * n'est pas lancé.
 *
 * Dans Appfacade, la clé Anthropic active est exposée par
 * `../../services/activeApiKey` via `getAnthropicKey()` (singleton en
 * mémoire alimenté au login et au save des paramètres).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { detectOrchestrator, syncApiKey } from '../../services/orchestrateurClient'
import { getAnthropicKey } from '../../services/activeApiKey'

type SyncStatus = 'idle' | 'success' | 'error'

export function OrchestratorSync(): JSX.Element | null {
  const { t } = useTranslation()
  const [isDetected, setIsDetected] = useState<boolean>(false)
  const [isSyncing, setIsSyncing] = useState<boolean>(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    void detectOrchestrator().then((detected) => {
      if (!cancelled) {
        setIsDetected(detected)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!isDetected) {
    return null
  }

  const handleSync = async (): Promise<void> => {
    setIsSyncing(true)
    setSyncStatus('idle')
    setErrorMessage('')
    const apiKey = getAnthropicKey()
    if (!apiKey) {
      setSyncStatus('error')
      setErrorMessage(t('orchestratorSync.errors.noKey'))
      setIsSyncing(false)
      return
    }
    const result = await syncApiKey(apiKey)
    if (result.success) {
      setSyncStatus('success')
    } else {
      setSyncStatus('error')
      setErrorMessage(result.error)
    }
    setIsSyncing(false)
  }

  return (
    <section className="mt-6 rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <h3 className="mb-1 text-sm font-semibold text-slate-100">
        {t('orchestratorSync.title')}
      </h3>
      <p className="mb-3 text-xs text-slate-400">
        {t('orchestratorSync.description')}
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void handleSync()
          }}
          disabled={isSyncing}
          className="rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSyncing ? t('orchestratorSync.syncing') : t('orchestratorSync.sync')}
        </button>
        {syncStatus === 'success' && (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            {t('orchestratorSync.success')}
          </span>
        )}
        {syncStatus === 'error' && (
          <span className="text-xs font-medium text-red-400">
            {errorMessage || t('orchestratorSync.errors.syncFailed')}
          </span>
        )}
      </div>
    </section>
  )
}

export default OrchestratorSync
