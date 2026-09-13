import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getLocalSmsStatus, isLocalSmsAvailable, offerLocalSmsOnStartup, onLocalSmsChanged,
  openLocalSmsInbox, requestLocalSmsAccess, revokeLocalSmsAccess, type LocalSmsStatus,
} from '../../services/native/localSms'
import { onLocalDataInvalidated } from '../../services/localDataInvalidation'
import { getActiveSessionEpoch } from '../../services/userSession'

export function LocalSmsStartup({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (!ready || !isLocalSmsAvailable()) return
    // Defer until existing onboarding dialogs have closed. Native consent has
    // its own single-flight gate; declining never blocks the rest of Arty.
    let offered = false
    let epoch = getActiveSessionEpoch()
    const offer = () => {
      if (offered) return
      if (!document.querySelector('[role="dialog"], [aria-modal="true"]')) {
        offered = true
        observer.disconnect()
        void offerLocalSmsOnStartup().catch(() => {})
      }
    }
    const observer = new MutationObserver(offer)
    const timer = setTimeout(() => {
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-modal'] })
      offer()
    }, 500)
    const off = onLocalSmsChanged(() => {
      const next = getActiveSessionEpoch()
      if (next === epoch) return
      epoch = next
      offered = false
      // Session retirement can occur before its auth writer has finished.
      queueMicrotask(offer)
    })
    return () => { offered = true; off(); clearTimeout(timer); observer.disconnect() }
  }, [ready])
  return null
}

export function LocalSmsAccess({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<LocalSmsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const available = isLocalSmsAvailable()
  useEffect(() => {
    if (!available) return
    let alive = true, request = 0
    const refresh = () => {
      const ticket = ++request
      setStatus(null)
      void getLocalSmsStatus().then(value => { if (alive && ticket === request) setStatus(value) }).catch(() => {})
    }
    refresh()
    const off = onLocalSmsChanged(refresh)
    const invalidate = onLocalDataInvalidated(() => {
      ++request; setStatus(null)
      queueMicrotask(() => { if (alive) refresh() })
    })
    window.addEventListener('focus', refresh)
    return () => { alive = false; ++request; off(); invalidate(); window.removeEventListener('focus', refresh) }
  }, [available])
  if (!available) return null
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(false)
    try { await action(); setStatus(await getLocalSmsStatus()) }
    catch { setError(true) }
    finally { setBusy(false) }
  }
  const enabled = status?.decision === 'allowed' && status.permission
  const button = 'min-h-11 border border-theme-border px-4 py-2 text-sm disabled:opacity-50'
  return <article className="min-w-0 border border-theme-border p-5 space-y-3" aria-labelledby="local-sms-title">
    <h2 id="local-sms-title" className="font-display text-2xl">{t('localSms.title')}</h2>
    <p className="text-sm text-theme-muted">{t('localSms.description')}</p>
    <p role="status" className="text-sm">{t(enabled ? 'localSms.enabled' : 'localSms.disabled')}</p>
    {error && <p role="alert">{t('localSms.error')}</p>}
    <div className="flex flex-wrap gap-2">
      {enabled
        ? <button className={button} disabled={disabled || busy} onClick={() => void act(openLocalSmsInbox)}>{t('localSms.open')}</button>
        : <button className={button} disabled={disabled || busy || !status} onClick={() => void act(requestLocalSmsAccess)}>{t('localSms.allow')}</button>}
      {status?.decision === 'allowed' && <button className={button} disabled={disabled || busy} onClick={() => void act(revokeLocalSmsAccess)}>{t('localSms.revoke')}</button>}
    </div>
    <p className="text-xs text-theme-muted">{t('localSms.sessionNotice')}</p>
  </article>
}
