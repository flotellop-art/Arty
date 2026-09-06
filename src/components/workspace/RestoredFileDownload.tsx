import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useArchiveLifetime } from './useArchiveLifetime'

export function RestoredFileDownload({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation(), operation = useRef<AbortController>()
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const lifetime = useArchiveLifetime(() => { operation.current?.abort(); setBusy(false); setFailed(false) })
  useEffect(() => () => { operation.current?.abort() }, [])
  const download = async () => {
    if (operation.current || lifetime.invalid.current || lifetime.demo) return
    const controller = new AbortController(); operation.current = controller; setBusy(true); setFailed(false)
    try {
      const { downloadRestoredFile } = await import('../../services/workspaceBackup/downloadRestoredFile')
      if (!controller.signal.aborted) await downloadRestoredFile(id, controller.signal)
    } catch { if (!controller.signal.aborted) setFailed(true) }
    finally { if (!controller.signal.aborted) { operation.current = undefined; setBusy(false) } }
  }
  return <div className="max-w-[220px] text-xs">
    <button type="button" className="min-h-11 max-w-full break-words px-2 py-2 underline disabled:opacity-40" disabled={busy || lifetime.invalidated || lifetime.demo} onClick={() => void download()}>{t('workspaceRestore.downloadFile', { name })}</button>
    {failed && <p role="alert">{t('workspaceRestore.downloadFailed')}</p>}
  </div>
}
