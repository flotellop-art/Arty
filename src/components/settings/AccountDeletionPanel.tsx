import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteAccount, getAccountErasureState, wipeLocalAccount } from '../../services/accountService'
import type { ProjectErasureState } from '../../services/projects/store'
import { getActiveUserId, getActiveSessionEpoch } from '../../services/userSession'

export function AccountDeletionPanel({ open, onComplete }: { open: boolean; onComplete: () => void }) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState<'account' | 'local' | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(false)
  const [status, setStatus] = useState<ProjectErasureState | 'loading' | 'read-failed'>('loading')
  const [revision, setRevision] = useState(0)
  const owner = getActiveUserId(), epoch = getActiveSessionEpoch()
  const scope = useRef<{ owner: string; epoch: number } | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (!open && !busy) { scope.current = null; setConfirm(null); setError(false) } }, [open, busy])
  useEffect(() => {
    if (!open) return
    let current = true
    setStatus('loading')
    void getAccountErasureState().then(value => {
      if (current && owner === getActiveUserId() && epoch === getActiveSessionEpoch()) setStatus(value)
    }, () => { if (current) setStatus('read-failed') })
    return () => { current = false }
  }, [open, owner, epoch, revision])
  const recovery = status === 'uncertain' || status === 'confirmed'
  const actionKey = status === 'uncertain' ? 'account.verifyAndFinish' : status === 'confirmed' ? 'account.finishLocal' : 'account.confirmCta'
  const arm = (mode: 'account' | 'local' = 'account') => {
    const owner = getActiveUserId()
    if (!owner) return
    scope.current = { owner, epoch: getActiveSessionEpoch() }; setError(false); setConfirm(mode)
  }
  const run = async () => {
    const captured = scope.current
    if (!captured || captured.owner !== getActiveUserId() || captured.epoch !== getActiveSessionEpoch()) {
      scope.current = null; setConfirm(null); setError(true); return
    }
    setBusy(true); setError(false)
    try {
      if (confirm === 'local') await wipeLocalAccount()
      else await deleteAccount()
      if (mounted.current) onComplete()
    } catch {
      if (!mounted.current) return
      // Even A→B→A is a new session. A changed epoch requires a NEW explicit
      // arm; never infer that it changed only because cleanup invalidated work.
      if (captured.owner !== getActiveUserId() || captured.epoch !== getActiveSessionEpoch()) { scope.current = null; setConfirm(null) }
      setError(true)
    } finally { if (mounted.current) { setBusy(false); setRevision(v => v + 1) } }
  }
  return <section className="border-t border-theme-border pt-5" aria-label={t('account.dangerZone')}>
    <p className="font-display text-base text-red-600 dark:text-red-400">⚠️ {t('account.dangerZone')}</p>
    {status === 'loading' ? <p role="status" className="mt-3 text-sm">{t('account.reading')}</p>
      : status === 'read-failed' ? <div role="alert" className="mt-3 text-sm">
        <p>{t('account.readFailed')}</p><button className="min-h-11" onClick={() => setRevision(v => v + 1)}>{t('account.retryRead')}</button>
      </div> : !confirm ? <>
      <p className="font-display italic text-xs text-theme-muted mt-0.5">{t('account.deleteDescription')}</p>
      {status === 'legacy-unknown' ? <p role="status" className="mt-3 text-sm">{t('account.legacyUnknown')}</p>
        : <button onClick={() => arm(status === 'local-only' ? 'local' : 'account')} className="mt-3 px-3 py-2 border border-red-500/50 text-red-600 text-sm">
          {t(status === 'local-only' ? 'account.localChoice' : recovery ? actionKey : 'account.delete')}</button>}
      {status === 'uncertain' && <p role="status" className="mt-2 text-xs">{t('account.uncertain')}</p>}
    </> : <div className="mt-3 border border-red-500/50 bg-red-500/5 p-3">
      <p className="font-display text-sm text-theme-ink font-medium">{t(confirm === 'local' ? 'account.localTitle' : recovery ? actionKey : 'account.confirmTitle')}</p>
      <p className="text-xs text-theme-muted mt-1">{t(confirm === 'local' ? 'account.localBody' : status === 'confirmed' ? 'account.authorizedCleanupBody' : recovery ? 'account.recoveryBody' : 'account.confirmBody')}</p>
      <div className="flex gap-2 mt-3">
        <button onClick={() => void run()} disabled={busy} className="flex-1 min-h-11 py-2 bg-red-600 text-white text-sm disabled:opacity-50">
          {t(busy ? 'account.deleting' : confirm === 'local' ? 'account.localConfirm' : actionKey)}
        </button>
        <button onClick={() => { setConfirm(null); setError(false); scope.current = null }} disabled={busy} className="min-h-11 px-4 py-2 border border-theme-border text-sm">{t(recovery ? 'account.closeConfirmation' : 'account.cancel')}</button>
      </div>
    </div>}
    {(error || status === 'uncertain' || status === 'legacy-unknown') && <div className="mt-2 text-xs text-red-600" role="alert">
      {error && <p>{t('account.error')}</p>}
      {confirm !== 'local' && <>
        <p className="mt-2">{t('account.localRecovery')}</p>
        <button onClick={() => arm('local')} disabled={busy} className="mt-2 min-h-11 border border-red-500/50 px-3 py-2">{t('account.localChoice')}</button>
      </>}
    </div>}
  </section>
}
