import { captureLocalReadScope } from '../projects/store'
import { readOwnedFileSnapshot } from '../secureFileStorage'
import { decrypt } from '../crypto'
import { downloadOrShareFile } from '../native/shareFile'
import { BACKUP_LIMITS, BackupError } from './types'
import { rawEncoding } from '../workspaceWriter/migrationInventory'

/** Explicit owner-scoped download, not a URL/open action from archive text. */
export async function downloadRestoredFile(id: string, signal: AbortSignal): Promise<void> {
  const scope = captureLocalReadScope(signal)
  const records = await readOwnedFileSnapshot([id], scope.assertCurrent, signal), record = records.get(id)
  if (!record) throw new BackupError('missing')
  const snapshot = rawEncoding(record)
  const base64 = await decrypt(record.encryptedData); scope.assertCurrent()
  if (base64.length > 4 * Math.ceil(BACKUP_LIMITS.objectBytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new BackupError('format')
  const binary = atob(base64)
  if (binary.length > BACKUP_LIMITS.objectBytes || btoa(binary) !== base64) throw new BackupError('format')
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: record.mimeType || 'application/octet-stream' }); bytes.fill(0)
  const validate = async () => {
    scope.assertCurrent(); await scope.validateReadOnly()
    const current = await readOwnedFileSnapshot([id], scope.assertCurrent, signal)
    if (rawEncoding(current.get(id)) !== snapshot) throw new BackupError('changed')
    await scope.validateReadOnly(); scope.assertCurrent()
  }
  const filename = record.name.replace(/[\\/\u0000-\u001f\u007f]/g, '_') || 'arty-file'
  await downloadOrShareFile(blob, filename, { assertCurrent: scope.assertCurrent, validate })
}
