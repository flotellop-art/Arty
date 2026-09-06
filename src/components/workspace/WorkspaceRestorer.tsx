import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ISOLATED_WORKSPACE_ENABLED, WORKSPACE_RESTORE_START_ENABLED } from '../../services/workspaceWriter/activation'
import { isNative } from '../../services/native/platform'
import { getDocumentStorageLayout, documentWorkspaceSignal } from '../../services/workspaceWriter/runtime'
import { getActiveSession } from '../../services/userSession'
import { backupErrorCode } from '../../services/workspaceBackup/capture'
import type { prepareRestorePublication } from '../../services/workspaceBackup/restorePublication'
import { useArchiveLifetime } from './useArchiveLifetime'
import { archiveButton } from './ArchiveVerifier'

type Prepared = Awaited<ReturnType<typeof prepareRestorePublication>>
export function WorkspaceRestorer() {
  const { t } = useTranslation(), operation = useRef<AbortController>(), prepared = useRef<Prepared>(), mounted = useRef(true), committing = useRef(false)
  const [file, setFile] = useState<File | null>(null), [code, setCode] = useState(''), [error, setError] = useState('')
  const [preview, setPreview] = useState<Prepared['preview']>(), [busy, setBusy] = useState(false), [agreed, setAgreed] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const dispose = () => { operation.current?.abort(); operation.current = undefined; prepared.current?.dispose(); prepared.current = undefined }
  const reset = () => { dispose(); committing.current = false; setPreview(undefined); setAgreed(false); setError(''); setBusy(false) }
  const lifetime = useArchiveLifetime(() => { reset(); setCode(''); setFile(null) })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; dispose() } }, [])
  useEffect(() => { heading.current?.focus() }, [preview])
  const prepare = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!ISOLATED_WORKSPACE_ENABLED || !WORKSPACE_RESTORE_START_ENABLED || !file || !code.trim() || operation.current || lifetime.invalid.current || lifetime.demo) return
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError('')
    try {
      const { prepareRestorePublication } = await import('../../services/workspaceBackup/restorePublication')
      if (controller.signal.aborted || !mounted.current) return
      const result = await prepareRestorePublication(file, code, { title: t('workspaceRestore.receiptTitle'), text: t('workspaceRestore.receiptText') }, controller.signal)
      if (controller.signal.aborted || !mounted.current) { result.dispose(); return }
      prepared.current = result; setPreview(result.preview); setCode(''); setFile(null)
    } catch (e) { if (!controller.signal.aborted && mounted.current) { setError(backupErrorCode(e)); operation.current = undefined } }
    finally { if (!controller.signal.aborted && mounted.current) setBusy(false) }
  }
  const commit = async () => {
    if (!prepared.current || !agreed || committing.current || lifetime.invalid.current) return
    committing.current = true; setBusy(true); setError('')
    try { await prepared.current.commit() }
    catch (e) { if (mounted.current && !documentWorkspaceSignal.aborted) setError(backupErrorCode(e)) }
    finally {
      // Service retirement precedes this navigation, including uncertain IDB
      // acknowledgement. No archive/code is persisted or put into a URL.
      if (documentWorkspaceSignal.aborted) window.location.assign('/?start=1')
      else if (mounted.current) { setBusy(false); dispose(); setPreview(undefined) }
    }
  }
  if (lifetime.invalidated) return <p role="alert">{t('workspaceArchive.errors.cancelled')}</p>
  if (isNative) return <p role="note">{t('workspaceRestore.nativeUnavailable')}</p>
  if (!ISOLATED_WORKSPACE_ENABLED || !WORKSPACE_RESTORE_START_ENABLED || lifetime.demo) return <p role="note">{t(lifetime.demo ? 'workspaceArchive.demoUnavailable' : 'workspaceRestore.disabled')}</p>
  if (getDocumentStorageLayout().kind === 'legacy-v1') return <section className="space-y-4">
    <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold">{t('workspaceRestore.title')}</h2>
    <p>{t('workspaceRestore.prepareLegacy')}</p>
    <a className={`${archiveButton} inline-flex items-center`} href="/workspace/prepare">{t('workspaceRestore.setupTitle')}</a>
  </section>
  return <section className="space-y-4 text-sm">
    <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold">{t('workspaceRestore.title')}</h2>
    <p>{t('workspaceRestore.help')}</p>
    <p className="text-theme-muted">{t('workspaceRestore.limits')}</p>
    <p className="break-words">{t('workspaceRestore.target', { name: getActiveSession()?.displayName ?? '' })}</p>
    <p className="break-all text-xs">{t('workspaceRestore.targetId')} <bdi dir="ltr">{JSON.stringify(preview?.targetOwner ?? getActiveSession()?.userId ?? '').replace(/[\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}</bdi></p>
    {!preview && <form onSubmit={e => void prepare(e)} className="space-y-3">
      <label className="block space-y-1"><span>{t('workspaceArchive.file')}</span><input className="block w-full min-w-0" type="file" accept=".artybackup,application/octet-stream" disabled={busy} onChange={e => { reset(); setFile(e.target.files?.[0] ?? null) }} /></label>
      <label className="block space-y-1"><span>{t('workspaceArchive.code')}</span><input className="block w-full rounded-lg border border-theme-border bg-theme-bg p-3" type="password" autoComplete="off" spellCheck={false} maxLength={128} value={code} disabled={busy} onChange={e => { reset(); setCode(e.target.value) }} /></label>
      <button className={archiveButton} disabled={busy || !file || !code.trim()}>{t(busy ? 'workspaceArchive.preparing' : 'workspaceRestore.preview')}</button>
    </form>}
    {preview && <div className="space-y-3 rounded-lg border border-theme-border p-3">
      <p role="status">{t('workspaceRestore.counts', { ...preview })}</p>
      {preview.receiptFiles > 0 && <p role="note">{t('workspaceRestore.receiptNotice', { count: preview.receiptFiles })}</p>}
      {Object.values(preview.diagnostics).some(n => n > 0) && <p role="note">{t('workspaceArchive.references', { ...preview.diagnostics })}</p>}
      <p>{t('workspaceRestore.reloadNotice')}</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={agreed} disabled={busy} onChange={e => setAgreed(e.target.checked)} /><span>{t('workspaceRestore.consent')}</span></label>
      <div className="flex flex-wrap gap-2"><button className={archiveButton} disabled={busy || !agreed} onClick={() => void commit()}>{t(busy ? 'workspaceArchive.preparing' : 'workspaceRestore.commit')}</button>
        <button className={archiveButton} disabled={busy} onClick={reset}>{t('workspaceArchive.restart')}</button></div>
    </div>}
    {error && <p role="alert">{t(`workspaceRestore.errors.${error}`)}</p>}
  </section>
}
