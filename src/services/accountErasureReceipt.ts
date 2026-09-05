/** Credential-free transport is safe to import before private workspace admission. */
import { apiUrl } from './apiBase'
import { ACCOUNT_ERASURE_PATH, ERASURE_OPERATION_HEADER, ERASURE_CAPABILITY_HEADER, type RemoteErasureIntent } from './accountErasureProtocol'

export async function readConfirmedErasureReceipt(res: Response, operationId: string, subjectHash: string): Promise<void> {
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
  if (Object.keys(r).length !== 4 || r.protocol !== 1 || r.operationId !== operationId || r.subjectHash !== subjectHash || r.status !== 'confirmed') throw new Error('Erasure outcome remains unknown')
}
export async function consultErasureReceipt(operationId: string, intent: RemoteErasureIntent, signal: AbortSignal): Promise<void> {
  const controller = new AbortController(), cancel = () => controller.abort()
  signal.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(cancel, 30_000)
  try {
    if (signal.aborted) throw new Error('Erasure consultation cancelled')
    const res = await fetch(apiUrl(ACCOUNT_ERASURE_PATH), { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
      headers: { [ERASURE_OPERATION_HEADER]: operationId, [ERASURE_CAPABILITY_HEADER]: intent.capability } })
    await readConfirmedErasureReceipt(res, operationId, intent.subjectHash)
    if (signal.aborted || controller.signal.aborted) throw new Error('Erasure consultation cancelled')
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel) }
}
