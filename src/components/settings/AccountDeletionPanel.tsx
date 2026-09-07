import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteAccount, getAccountErasureState, wipeLocalAccount, continueAccountErasureCleanup } from '../../services/accountService'
import { ErasureCleanupPendingError } from '../../services/accountErasureReceipt'
import type { ProjectErasureState } from '../../services/projects/store'
import { getActiveUserId, getActiveSessionEpoch } from '../../services/userSession'

type Scope = { owner: string | null; epoch: number }
// A retired document must not throw through an old event handler or promise
// continuation. Distinguish loss of authority from a valid logged-out state.
function currentScope(): Scope | null {
  try { return { owner: getActiveUserId(), epoch: getActiveSessionEpoch() } } catch { return null }
}
function sameScope(expected: Scope): boolean {
  const current = currentScope()
  return !!current && current.owner === expected.owner && current.epoch === expected.epoch
}

export function AccountDeletionPanel({ open, onComplete }: { open: boolean; onComplete: () => void }) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState<'account' | 'local' | 'cleanup' | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(false)
  const [status, setStatus] = useState<ProjectErasureState | 'loading' | 'read-failed'>('loading')
  const [revision, setRevision] = useState(0)
  const current = currentScope(), owner = current?.owner ?? null, epoch = current?.epoch ?? -1
  const scope = useRef<{ owner: string; epoch: number } | null>(null)
  const [pendingScope, setPendingScope] = useState<{ owner: string; epoch: number } | null>(null)
  const running = useRef(false), requestAbort = useRef<AbortController>(), visible = useRef(open)
  const cleanupStatus = useRef<HTMLParagraphElement>(null), confirmationTitle = useRef<HTMLParagraphElement>(null)
  visible.current = open
  const cleanupAvailable = pendingScope?.owner === owner && pendingScope?.epoch === epoch
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestAbort.current?.abort() } }, [])
  useEffect(() => { requestAbort.current?.abort(); setPendingScope(null) }, [open, owner, epoch])
  useEffect(() => {
    if (status === 'confirmed' && confirm === 'cleanup') {
      scope.current = null; setConfirm(null); setPendingScope(null)
    }
  }, [status, confirm])
  useEffect(() => {
    if (!open || status === 'loading') return
    if (confirm) confirmationTitle.current?.focus()
    else if (cleanupAvailable) cleanupStatus.current?.focus()
  }, [open, confirm, cleanupAvailable, status])
  useEffect(() => { if (!open && !busy) { scope.current = null; setConfirm(null); setError(false) } }, [open, busy])
  useEffect(() => {
    if (!open) return
    if (!owner) { setStatus('read-failed'); return }
    let current = true
    setStatus('loading')
    void getAccountErasureState().then(value => {
      if (current && sameScope({ owner, epoch })) setStatus(value)
    }, () => { if (current) setStatus('read-failed') })
    return () => { current = false }
  }, [open, owner, epoch, revision])
  const recovery = status === 'uncertain' || status === 'confirmed'
  const actionKey = status === 'uncertain' ? 'account.verifyAndFinish' : status === 'confirmed' ? 'account.finishLocal' : 'account.confirmCta'
  const arm = (mode: 'account' | 'local' | 'cleanup' = 'account') => {
    if (running.current || !visible.current || !mounted.current || !owner || !sameScope({ owner, epoch }) || mode === 'cleanup' && !cleanupAvailable) return
    scope.current = { owner, epoch }; setError(false); setConfirm(mode)
    if (mode !== 'cleanup') setPendingScope(null)
  }
  const run = async () => {
    if (running.current || !mounted.current || !visible.current) return
    const captured = scope.current
    if (!captured || !sameScope(captured)) {
      scope.current = null; setConfirm(null); setError(true); return
    }
    running.current = true; requestAbort.current = new AbortController()
    setBusy(true); setError(false); setPendingScope(null)
    try {
      const outcome = confirm === 'local' ? await wipeLocalAccount() : confirm === 'cleanup' ? await continueAccountErasureCleanup(requestAbort.current.signal) : await deleteAccount()
      if (outcome === 'reload-required') { window.location.reload(); return }
      // Legacy success clears A before resolving. Never let its late callback
      // reload a newly active B (or a new A session). Handoff above is different.
      if (mounted.current && visible.current && currentScope()?.owner === null) onComplete()
    } catch (failure) {
      if (!mounted.current) return
      // Even A→B→A is a new session. A changed epoch requires a NEW explicit
      // arm; never infer that it changed only because cleanup invalidated work.
      const same = visible.current && sameScope(captured)
      if (!same) { scope.current = null; setConfirm(null) }
      if (same && failure instanceof ErasureCleanupPendingError) { setPendingScope(captured); setConfirm(null); scope.current = null }
      else setError(true)
    } finally { running.current = false; if (mounted.current) { setBusy(false); setRevision(v => v + 1) } }
  }
  return <section className="border-t border-theme-border pt-5" aria-label={t('account.dangerZone')}>
    <p className="font-display text-base text-red-600 dark:text-red-400">⚠️ {t('account.dangerZone')}</p>
    {status === 'loading' ? <p role="status" className="mt-3 text-sm">{t('account.reading')}</p>
      : status === 'read-failed' ? <div role="alert" className="mt-3 text-sm">
        <p>{t('account.readFailed')}</p><button className="min-h-11" onClick={() => setRevision(v => v + 1)}>{t('account.retryRead')}</button>
      </div> : !confirm ? <>
      <p className="font-display italic text-xs text-theme-muted mt-0.5">{t(status === 'local-only' ? 'account.localDescription' : 'account.deleteDescription')}</p>
      {status === 'legacy-unknown' ? <p role="status" className="mt-3 text-sm">{t('account.legacyUnknown')}</p>
        : <button onClick={() => arm(status === 'local-only' ? 'local' : 'account')} className="mt-3 px-3 py-2 border border-red-500/50 text-red-600 text-sm">
          {t(status === 'local-only' ? 'account.localChoice' : recovery ? actionKey : 'account.delete')}</button>}
      {status === 'uncertain' && <p role="status" className="mt-2 text-xs">{t('account.uncertain')}</p>}
    </> : <div className="mt-3 border border-red-500/50 bg-red-500/5 p-3">
      <p ref={confirmationTitle} tabIndex={-1} className="font-display text-sm text-theme-ink font-medium">{t(confirm === 'cleanup' ? 'account.cleanupTitle' : confirm === 'local' ? 'account.localTitle' : recovery ? actionKey : 'account.confirmTitle')}</p>
      <p className="text-xs text-theme-muted mt-1">{t(confirm === 'cleanup' ? 'account.cleanupBody' : confirm === 'local' ? 'account.localBody' : status === 'confirmed' ? 'account.authorizedCleanupBody' : recovery ? 'account.recoveryBody' : 'account.confirmBody')}</p>
      <div className="flex gap-2 mt-3">
        <button onClick={() => void run()} disabled={busy} className="flex-1 min-h-11 py-2 bg-red-600 text-white text-sm disabled:opacity-50">
          {t(busy ? 'account.deleting' : confirm === 'cleanup' ? 'account.cleanupConfirm' : confirm === 'local' ? 'account.localConfirm' : actionKey)}
        </button>
        <button onClick={() => { setConfirm(null); setError(false); scope.current = null }} disabled={busy} className="min-h-11 px-4 py-2 border border-theme-border text-sm">{t(recovery ? 'account.closeConfirmation' : 'account.cancel')}</button>
      </div>
    </div>}
    {cleanupAvailable && confirm !== 'local' && <div role="status" className="mt-3 text-sm">
      <p ref={cleanupStatus} tabIndex={-1}>{t('account.cleanupPending')}</p>
      {!confirm && <button className="mt-2 min-h-11 border border-red-500/50 px-3 py-2" disabled={busy} onClick={() => arm('cleanup')}>{t('account.cleanupChoice')}</button>}
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
