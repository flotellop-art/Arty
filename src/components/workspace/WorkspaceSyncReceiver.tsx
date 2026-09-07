import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKSPACE_SYNC_APPLY_START_ENABLED } from '../../services/workspaceSync/activation'
import { getDocumentStorageLayout } from '../../services/workspaceWriter/runtime'
import { isNative } from '../../services/native/platform'
import type { createLocalSyncOutbox } from '../../services/workspaceSync/localOutbox'
import { useArchiveLifetime } from './useArchiveLifetime'

type Box = ReturnType<typeof createLocalSyncOutbox>
type Actor = ReturnType<Box['connect']>
type Preview = Awaited<ReturnType<Actor['prepareApply']>>
type Reconciled = Awaited<ReturnType<Actor['reconcilePending']>>
// Reversible display, not normalization: invisible/bidi/space characters must
// not make two distinct historical IDs look identical in the consent preview.
const displayIdentity = (id: string) => JSON.stringify(id).replace(/[^\x21-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
/** An explicit RECEIVE flow, not background sync or a new-vault publisher.
 * Starts stay OFF until the complete two-way/browser/mobile release is proven. */
export function WorkspaceSyncReceiver() {
  const { t } = useTranslation(), box = useRef<Box>(), actor = useRef<Actor>(), mounted = useRef(true), committing = useRef(false)
  const busy = useRef(false), attempt = useRef(0)
  const [state, setState] = useState<'closed' | 'busy' | 'code' | 'preview' | 'reload' | 'failed' | 'historyNotDurable' | 'unavailable' |
    'pending' | 'conflict' | 'reconciled' | 'receiveAgain' | 'published'>('closed')
  const [code, setCode] = useState(''), [preview, setPreview] = useState<Preview>(), [confirmed, setConfirmed] = useState(false)
  const [reconciled, setReconciled] = useState<Reconciled>()
  const dispose = () => { actor.current?.close(); box.current?.close(); actor.current = undefined; box.current = undefined }
  const lifetime = useArchiveLifetime(() => { if (!committing.current) { ++attempt.current; busy.current = false; dispose(); setCode(''); setPreview(undefined); setState('failed') } })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++attempt.current; dispose() } }, [])
  if (!WORKSPACE_SYNC_APPLY_START_ENABLED || isNative || lifetime.demo) return null
  const eligible = (ticket = attempt.current) => {
    if (ticket !== attempt.current || lifetime.invalid.current || !mounted.current) throw new Error('cancelled')
    const layout = getDocumentStorageLayout()
    if (layout.kind !== 'isolated-v1' || layout.projects.version !== 2) throw new Error('unavailable')
  }
  const inspect = async () => {
    if (busy.current || committing.current) return
    busy.current = true; const ticket = ++attempt.current; setState('busy')
    try {
      eligible(ticket); dispose()
      const { createLocalSyncOutbox } = await import('../../services/workspaceSync/localOutbox'); eligible(ticket)
      box.current = createLocalSyncOutbox(); actor.current = box.current.connect()
      const discovery = await actor.current.inspect(); eligible(ticket)
      setState(discovery.status === 'active' ? 'code' : 'unavailable')
    } catch { if (mounted.current && ticket === attempt.current) { dispose(); setState('failed') } }
    finally { if (ticket === attempt.current) busy.current = false }
  }
  const receive = async (current: Actor, ticket: number) => {
    setPreview(undefined); setReconciled(undefined); setConfirmed(false)
    const reception = await current.receive(); eligible(ticket)
    if (reception.localPending) {
      // Never call resume merely to inspect: that would publish on its own.
      const status = await current.pendingStatus(); eligible(ticket)
      if (!status) throw new Error('changed')
      setState(status.status === 'conflict' ? 'conflict' : 'pending')
    } else {
      const next = await current.prepareApply(); eligible(ticket)
      setPreview(next); setState('preview')
    }
  }
  const prepare = async (event: React.FormEvent) => {
    event.preventDefault()
    if (state !== 'code' || !code.trim() || busy.current || committing.current) return
    busy.current = true; const ticket = ++attempt.current
    const secret = code.trim(); setCode(''); setState('busy')
    try {
      eligible(ticket); const current = actor.current
      if (!current) throw new Error('missing')
      await current.unlockOrJoin(secret); eligible(ticket)
      await receive(current, ticket)
    } catch (error) { if (mounted.current && ticket === attempt.current) {
      dispose(); setState(error instanceof Error && error.message === 'history-not-durable' ? 'historyNotDurable' : 'failed')
    } }
    finally { if (ticket === attempt.current) busy.current = false }
  }
  const pendingAction = async (action: 'reconcile' | 'send' | 'receive') => {
    if (busy.current || committing.current ||
      action === 'reconcile' && (state !== 'conflict' || !confirmed) ||
      action === 'send' && state !== 'pending' && state !== 'reconciled' ||
      action === 'receive' && state !== 'receiveAgain' && state !== 'preview') return
    busy.current = true; const ticket = ++attempt.current; setState('busy')
    try {
      eligible(ticket); const current = actor.current
      if (!current) throw new Error('missing')
      if (action === 'receive') await receive(current, ticket)
      else if (action === 'reconcile') {
        const next = await current.reconcilePending(); eligible(ticket)
        setReconciled(next); setConfirmed(false); setState('reconciled')
      } else {
        const result = await current.resume(); eligible(ticket)
        setReconciled(undefined); setConfirmed(false)
        setState(result.status === 'conflict' ? 'receiveAgain' : 'published')
      }
    } catch { if (mounted.current && ticket === attempt.current) { dispose(); setState('failed') } }
    finally { if (ticket === attempt.current) busy.current = false }
  }
  const commit = async () => {
    if (state !== 'preview' || !confirmed || busy.current || committing.current || preview?.status === 'existing-update-reviewed' && !preview.canApply) return
    committing.current = true; setState('busy')
    try { eligible(); await actor.current!.applyReceived(); if (mounted.current) setState('reload') }
    catch { if (mounted.current) setState('failed') }
    // Never retry this incarnation after an uncertain adoption. Reload only.
  }
  const button = 'min-h-11 rounded-lg border border-theme-border px-5 py-3'
  return <section className="space-y-3" aria-label={t('workspaceSyncApply.title')}>
    <h2 className="font-display text-lg">{t('workspaceSyncApply.title')}</h2>
    <p className="text-sm text-theme-muted">{t('workspaceSyncApply.description')}</p>
    <p role="status">{t(`workspaceSyncApply.warm.${state}`)}</p>
    {state === 'closed' && <button className={button} onClick={() => void inspect()}>{t('workspaceSyncApply.inspect')}</button>}
    {state === 'code' && <form onSubmit={prepare} className="space-y-3">
      <label className="block">{t('workspaceSyncApply.code')}<input type="password" autoComplete="off" maxLength={128} spellCheck={false} value={code} onChange={e => setCode(e.target.value)} className="block w-full border border-theme-border p-3" /></label>
      <button className={button} type="submit" disabled={!code.trim()}>{t('workspaceSyncApply.prepare')}</button>
    </form>}
    {state === 'preview' && preview && <div className="space-y-3">
      <p role="status">{t(preview.status === 'existing-update-reviewed' ? 'workspaceSyncApply.update.summary' : 'workspaceSyncApply.summary', { ...preview })}</p>
      {preview.status === 'existing-update-reviewed' && <>
        {!preview.canApply && <p>{t('workspaceSyncApply.update.none')}</p>}
        {preview.targets.length > 0 && <section aria-label={t('workspaceSyncApply.update.targets')} className="min-w-0 space-y-2">
          <h3>{t('workspaceSyncApply.update.targets')}</h3>
          <ul className="space-y-3">{preview.targets.map(item => <li key={`${item.kind}:${item.localId}`} className="min-w-0 break-words">
            <p>{t(`workspaceSyncApply.update.kind.${item.kind}`)}</p>
            <p>{t('workspaceSyncApply.update.before')}{' : '}<span className="whitespace-pre-wrap">{item.before || t('workspaceSyncApply.update.untitled')}</span></p>
            <p>{t('workspaceSyncApply.update.after')}{' : '}<span className="whitespace-pre-wrap">{item.after || t('workspaceSyncApply.update.untitled')}</span></p>
            <p>{t('workspaceSyncApply.update.identity')}{' : '}<code className="break-all" dir="ltr">{displayIdentity(item.localId)}</code></p>
          </li>)}</ul>
        </section>}
        {preview.retained.length > 0 && <section aria-label={t('workspaceSyncApply.update.retained')}>
          <h3>{t('workspaceSyncApply.update.retained')}</h3>
          <ul className="list-disc pl-5">{preview.retained.map(item => <li key={item.recordId} className="break-words">
          {item.label || t('workspaceSyncApply.update.item')}{' : '}{t(`workspaceSyncApply.update.reason.${item.reason}`)}
        </li>)}</ul></section>}
      </>}
      {(preview.status !== 'existing-update-reviewed' || preview.canApply) && <>
        <label className="flex gap-3"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t(preview.status === 'existing-update-reviewed' ? 'workspaceSyncApply.update.consent' : 'workspaceSyncApply.consent')}</label>
        <button className={button} disabled={!confirmed} onClick={() => void commit()}>{t(preview.status === 'existing-update-reviewed' ? 'workspaceSyncApply.update.apply' : 'workspaceSyncApply.apply')}</button>
      </>}
      <button className={button} onClick={() => void pendingAction('receive')}>{t('workspaceSyncApply.receiveAgain')}</button>
    </div>}
    {state === 'conflict' && <div className="space-y-3">
      <label className="flex gap-3"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t('workspaceSyncApply.reconcileConsent')}</label>
      <button className={button} disabled={!confirmed} onClick={() => void pendingAction('reconcile')}>{t('workspaceSyncApply.reconcile')}</button>
    </div>}
    {state === 'reconciled' && reconciled && <p>{t('workspaceSyncApply.reconciledSummary', { conflicts: reconciled.conflicts })}</p>}
    {(state === 'pending' || state === 'reconciled') && <button className={button} onClick={() => void pendingAction('send')}>{t('workspaceSyncApply.sendPending')}</button>}
    {state === 'receiveAgain' && <button className={button} onClick={() => void pendingAction('receive')}>{t('workspaceSyncApply.receiveAgain')}</button>}
    {(state === 'reload' || state === 'failed' || state === 'published') && <button className={button} onClick={() => window.location.reload()}>{t('workspaceWindow.reload')}</button>}
  </section>
}
