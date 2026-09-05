import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteAccount, wipeLocalAccount } from '../../services/accountService'
import { getActiveUserId, getActiveSessionEpoch } from '../../services/userSession'

export function AccountDeletionPanel({ open, onComplete }: { open: boolean; onComplete: () => void }) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState<'account' | 'local' | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(false)
  const scope = useRef<{ owner: string; epoch: number } | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (!open && !busy) { scope.current = null; setConfirm(null); setError(false) } }, [open, busy])
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
    } finally { if (mounted.current) setBusy(false) }
  }
  return <section className="border-t border-theme-border pt-5" aria-label={t('account.dangerZone')}>
    <p className="font-display text-base text-red-600 dark:text-red-400">⚠️ {t('account.dangerZone')}</p>
    {!confirm ? <>
      <p className="font-display italic text-xs text-theme-muted mt-0.5">{t('account.deleteDescription')}</p>
      <button onClick={() => arm()} className="mt-3 px-3 py-2 border border-red-500/50 text-red-600 text-sm">{t('account.delete')}</button>
    </> : <div className="mt-3 border border-red-500/50 bg-red-500/5 p-3">
      <p className="font-display text-sm text-theme-ink font-medium">{t(confirm === 'local' ? 'account.localTitle' : 'account.confirmTitle')}</p>
      <p className="text-xs text-theme-muted mt-1">{t(confirm === 'local' ? 'account.localBody' : 'account.confirmBody')}</p>
      <div className="flex gap-2 mt-3">
        <button onClick={() => void run()} disabled={busy} className="flex-1 min-h-11 py-2 bg-red-600 text-white text-sm disabled:opacity-50">
          {t(busy ? 'account.deleting' : confirm === 'local' ? 'account.localConfirm' : 'account.confirmCta')}
        </button>
        <button onClick={() => { setConfirm(null); setError(false); scope.current = null }} disabled={busy} className="min-h-11 px-4 py-2 border border-theme-border text-sm">{t('account.cancel')}</button>
      </div>
    </div>}
    {error && <div className="mt-2 text-xs text-red-600" role="alert">
      <p>{t('account.error')}</p>
      {confirm !== 'local' && <>
        <p className="mt-2">{t('account.localRecovery')}</p>
        <button onClick={() => arm('local')} disabled={busy} className="mt-2 min-h-11 border border-red-500/50 px-3 py-2">{t('account.localChoice')}</button>
      </>}
    </div>}
  </section>
}
