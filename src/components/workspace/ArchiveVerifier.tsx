import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { backupErrorCode, verifyWorkspaceArchive, type ArchiveReport } from '../../services/workspaceBackup/capture'
import { BACKUP_LIMITS, BackupError } from '../../services/workspaceBackup/types'
import { useArchiveLifetime } from './useArchiveLifetime'

export const archiveButton = 'min-h-11 px-4 py-2 rounded-lg border border-theme-border disabled:opacity-40'

export function ArchiveReportView({ report }: { report: ArchiveReport }) {
  const { t } = useTranslation()
  return <div className="space-y-2 text-sm break-words">
    <p>{t('workspaceArchive.counts', { ...report })}</p>
    <p className="text-xs text-theme-muted">{t('workspaceArchive.identity', { id: report.archiveId, version: report.version })}</p>
    {(report.diagnostics.unavailableAssociatedProjects + report.diagnostics.unavailableHistoricalSources + report.diagnostics.unavailableCropSources > 0) &&
      <p role="note" className="text-amber-700 dark:text-amber-300">{t('workspaceArchive.references', { ...report.diagnostics })}</p>}
    {report.metadataVariants > 0 && <p role="note" className="text-xs text-theme-muted">{t('workspaceArchive.variants')}</p>}
  </div>
}

/** Inline view, not another modal/focus trap (also used inside Settings). */
export function ArchiveVerifier({ verify }: { verify?: (file: Blob, code: string, signal: AbortSignal) => Promise<ArchiveReport> }) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<ArchiveReport | null>(null)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => () => { operation.current?.abort() }, [])
  const reset = () => { operation.current?.abort(); operation.current = null; setReport(null); setError(''); setBusy(false) }
  const lifetime = useArchiveLifetime(() => { reset(); setCode(''); setFile(null) })
  const check = async (event: React.FormEvent) => {
    event.preventDefault()
    if (lifetime.invalid.current || lifetime.demo || operation.current || !file || !code.trim()) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setReport(null)
    try {
      if (file.size > BACKUP_LIMITS.archiveBytes) throw new BackupError('limit')
      const value = await (verify ?? verifyWorkspaceArchive)(file, code, controller.signal)
      if (!controller.signal.aborted) setReport(value)
    } catch (e) { if (!controller.signal.aborted) setError(backupErrorCode(e)) }
    finally { if (!controller.signal.aborted) { operation.current = null; setBusy(false) } }
  }
  if (lifetime.invalidated) return <p role="alert">{t('workspaceArchive.errors.cancelled')}</p>
  if (lifetime.demo) return <section className="space-y-3 text-sm text-theme-ink">
    <h2 className="text-lg font-semibold">{t('workspaceArchive.verifyTitle')}</h2>
    <p role="note">{t('workspaceArchive.demoUnavailable')}</p>
  </section>
  return <section className="space-y-3 text-sm text-theme-ink">
    <h2 className="text-lg font-semibold">{t('workspaceArchive.verifyTitle')}</h2>
    <p>{t(verify ? 'workspaceArchive.reselect' : 'workspaceArchive.verifyHelp')}</p>
    <form onSubmit={event => void check(event)} className="space-y-3">
      <label className="block space-y-1"><span>{t('workspaceArchive.file')}</span>
        <input className="block w-full min-w-0 text-sm" type="file" accept=".artybackup,application/octet-stream" onChange={e => { reset(); setFile(e.target.files?.[0] ?? null) }} />
      </label>
      <label className="block space-y-1"><span>{t('workspaceArchive.code')}</span>
        <input className="block w-full min-w-0 rounded border border-theme-border bg-theme-bg p-3" type="password" autoComplete="off" spellCheck={false} maxLength={256} value={code} onChange={e => { reset(); setCode(e.target.value) }} />
      </label>
      <button className={archiveButton} type="submit" disabled={busy || !file || !code.trim()}>{t(busy ? 'workspaceArchive.checking' : 'workspaceArchive.verify')}</button>
    </form>
    {error && <p role="alert">{t(`workspaceArchive.errors.${error}`)}</p>}
    {report && <div role="status" className="border border-theme-border rounded-lg p-3 space-y-2">
      <p className="font-semibold">{t(verify ? 'workspaceArchive.verifiedSame' : 'workspaceArchive.verified')}</p>
      <ArchiveReportView report={report} />
    </div>}
    <p className="text-xs text-theme-muted">{t('workspaceArchive.verifyScope')}</p>
  </section>
}
