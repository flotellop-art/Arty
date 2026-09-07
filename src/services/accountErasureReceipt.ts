/** Credential-free transport is safe to import before private workspace admission. */
import { apiUrl } from './apiBase'
import { ACCOUNT_ERASURE_PATH, ACCOUNT_ERASURE_CLEANUP_PATH, ERASURE_OPERATION_HEADER, ERASURE_CAPABILITY_HEADER, type RemoteErasureIntent } from './accountErasureProtocol'

export class ErasureCleanupPendingError extends Error {
  constructor() { super('erasure_cleanup_pending'); this.name = 'ErasureCleanupPendingError' }
}
export type ErasureReceiptStatus = 'confirmed' | 'cleanup-pending'
export async function readErasureReceiptStatus(res: Response, operationId: string, subjectHash: string): Promise<ErasureReceiptStatus> {
  if (!res.ok) throw new Error(`Erasure not confirmed (${res.status})`)
  const reader = res.body?.getReader()
  if (!reader) throw new Error('Erasure receipt unavailable')
  let text = '', bytes = 0
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 512) throw new Error('Erasure receipt invalid')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const receipt: unknown = JSON.parse(text)
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('Erasure receipt invalid')
  const r = receipt as Record<string, unknown>
  if (Object.keys(r).length !== 4 || r.protocol !== 1 || r.operationId !== operationId || r.subjectHash !== subjectHash ||
    (r.status !== 'confirmed' && r.status !== 'cleanup-pending')) throw new Error('Erasure outcome remains unknown')
  return r.status
}
export async function readConfirmedErasureReceipt(res: Response, operationId: string, subjectHash: string): Promise<void> {
  if (await readErasureReceiptStatus(res, operationId, subjectHash) === 'cleanup-pending') throw new ErasureCleanupPendingError()
}
async function requestReceipt(method: 'GET' | 'POST', operationId: string, intent: RemoteErasureIntent, signal: AbortSignal, beforeSend: () => void) {
  const controller = new AbortController(), cancel = () => controller.abort()
  signal.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(cancel, 30_000)
  try {
    if (signal.aborted) throw new Error('Erasure consultation cancelled')
    beforeSend()
    const res = await fetch(apiUrl(method === 'GET' ? ACCOUNT_ERASURE_PATH : ACCOUNT_ERASURE_CLEANUP_PATH), { method, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
      headers: { [ERASURE_OPERATION_HEADER]: operationId, [ERASURE_CAPABILITY_HEADER]: intent.capability } })
    const status = await readErasureReceiptStatus(res, operationId, intent.subjectHash)
    if (signal.aborted || controller.signal.aborted) throw new Error('Erasure consultation cancelled')
    return status
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel) }
}
export const consultErasureStatus = (operationId: string, intent: RemoteErasureIntent, signal: AbortSignal) => requestReceipt('GET', operationId, intent, signal, () => {})
/** Must be invoked by a distinct explicit cleanup command, after its readonly
 * preflight. The synchronous guard runs immediately before fetch. */
export const resumeErasureCleanup = (operationId: string, intent: RemoteErasureIntent, signal: AbortSignal, beforeSend: () => void) => requestReceipt('POST', operationId, intent, signal, beforeSend)
export async function consultErasureReceipt(operationId: string, intent: RemoteErasureIntent, signal: AbortSignal): Promise<void> {
  if (await consultErasureStatus(operationId, intent, signal) === 'cleanup-pending') throw new ErasureCleanupPendingError()
}
