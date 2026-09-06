import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation } from '../../types'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { prepareConversationArchive, backupErrorCode, type PreparedConversationArchive, type ArchiveReport } from '../../services/workspaceBackup/capture'
import { downloadOrShareFile } from '../../services/native/shareFile'
import { ArchiveVerifier, ArchiveReportView, archiveButton } from './ArchiveVerifier'
import { useArchiveLifetime } from './useArchiveLifetime'

export function ConversationArchiveModal({ conversation, isBusy, onClose }: {
  conversation: Conversation; isBusy(id: string): boolean; onClose(): void
}) {
  const { t } = useTranslation()
  const [includeProject, setIncludeProject] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ code: string; report: ArchiveReport } | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [engaged, setEngaged] = useState(false)
  const prepared = useRef<PreparedConversationArchive | null>(null)
  const controller = useRef<AbortController | null>(null)
  const working = useRef(false)
  const closed = useRef(false)
  const currentBusy = useRef(isBusy); currentBusy.current = isBusy
  const dispose = () => { controller.current?.abort(); prepared.current?.dispose(); prepared.current = null }
  const close = () => { closed.current = true; dispose(); onClose() }
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(true, close)
  const lifetime = useArchiveLifetime(() => { closed.current = true; dispose(); setPreview(null); setAgreed(false); setEngaged(false); setError('') })
  useEffect(() => { dialogRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus() }, [preview?.report.archiveId, lifetime.invalidated, dialogRef])
  useEffect(() => { closed.current = false; return () => { closed.current = true; dispose() } }, [])

  const prepare = async () => {
    if (working.current || closed.current || lifetime.invalid.current || lifetime.demo) return
    working.current = true; dispose()
    const abort = new AbortController(); controller.current = abort
    setBusy(true); setError(''); setPreview(null); setAgreed(false); setEngaged(false)
    try {
      const result = await prepareConversationArchive(conversation.id, { includeProject, isBusy: id => currentBusy.current(id), signal: abort.signal })
      if (closed.current || abort.signal.aborted) { result.dispose(); return }
      prepared.current = result
      // Read guarded fields here, never during render after a session change.
      setPreview({ code: result.recoveryCode, report: result.report })
    } catch (e) { if (!closed.current && !abort.signal.aborted) setError(backupErrorCode(e)) }
    finally { working.current = false; if (!closed.current) setBusy(false) }
  }
  const deliver = async () => {
    const value = prepared.current
    if (!value || !agreed || working.current || closed.current) return
    working.current = true; setBusy(true); setError('')
    try {
      await downloadOrShareFile(value.archive, value.filename, { title: t('workspaceArchive.title'),
        assertCurrent: value.assertCurrent, validate: value.validate, onEngaged: () => { if (!closed.current) setEngaged(true) } })
    } catch (e) { if (!closed.current) setError(backupErrorCode(e)) }
    finally { working.current = false; if (!closed.current) setBusy(false) }
  }
  return <div className="fixed inset-0 z-[100] bg-theme-ink/40 flex items-center justify-center p-3" onClick={close}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="conversation-archive-title" tabIndex={-1}
      className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-theme-surface text-theme-ink p-5 space-y-4" onClick={e => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3">
        <h2 id="conversation-archive-title" className="text-lg font-semibold">{t('workspaceArchive.title')}</h2>
        <button className={archiveButton} onClick={close}>{t('common.close')}</button>
      </div>
      {lifetime.invalidated ? <p role="alert">{t('workspaceArchive.errors.cancelled')}</p> : lifetime.demo ? <p role="note">{t('workspaceArchive.demoUnavailable')}</p> : <>
      <p className="text-sm">{t('workspaceArchive.scope')}</p>
      {conversation.comparison && <p className="text-sm" role="note">{t('compare.context.exportNotice')}</p>}
      <p className="text-xs text-theme-muted">{t('workspaceArchive.exclusions')}</p>
      <p className="text-xs text-theme-muted">{t('workspaceArchive.limits')}</p>
      {!preview && <>
        {conversation.projectId && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={includeProject} disabled={busy} onChange={e => setIncludeProject(e.target.checked)} /><span>{t('workspaceArchive.includeProject')}</span></label>}
        <button className={archiveButton} disabled={busy} onClick={() => void prepare()}>{t(busy ? 'workspaceArchive.preparing' : 'workspaceArchive.prepare')}</button>
      </>}
      {preview && <>
        <ArchiveReportView report={preview.report} />
        <label className="block text-sm space-y-2"><span className="font-semibold">{t('workspaceArchive.code')}</span>
          <textarea readOnly autoComplete="off" spellCheck={false} value={preview.code} className="w-full min-w-0 font-mono text-sm break-all p-3 bg-theme-bg border border-theme-border rounded-lg" rows={3} />
        </label>
        <p className="text-sm">{t('workspaceArchive.keepCode')}</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={busy} checked={agreed} onChange={e => setAgreed(e.target.checked)} /><span>{t('workspaceArchive.agree')}</span></label>
        <div className="flex flex-wrap gap-2">
          <button className={archiveButton} disabled={busy || !agreed} onClick={() => void deliver()}>{t(busy ? 'workspaceArchive.preparing' : 'workspaceArchive.download')}</button>
          <button className={archiveButton} disabled={busy} onClick={() => { dispose(); setPreview(null); setError(''); setAgreed(false); setEngaged(false) }}>{t('workspaceArchive.restart')}</button>
        </div>
        {engaged && <p role="status" className="text-sm">{t('workspaceArchive.engaged')}</p>}
        {!busy && <ArchiveVerifier key={preview.report.archiveId} verify={(file, code, signal) => prepared.current!.verify(file, code, signal)} />}
      </>}
      {error && <p role="alert" className="text-sm">{t(`workspaceArchive.errors.${error}`)}</p>}
      </>}
    </div>
  </div>
}
