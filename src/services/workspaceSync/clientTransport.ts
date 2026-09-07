import { captureGoogleGrant, onGoogleGrantInvalidated } from '../googleAuth'
import { captureLocalReadScope } from '../projects/store'
import { onLocalDataInvalidated } from '../localDataInvalidation'
import { documentWorkspaceSignal } from '../workspaceWriter/runtime'
import { apiUrl } from '../apiBase'
import { assertEnvelopeScope, envelopeFields, envelopeScope, parseSyncEnvelopeReference,
  type SyncEnvelopeReference, type SyncVaultScope } from './envelopeFormat'
import { SYNC_TRANSPORT_PATH, SYNC_TRANSPORT_LIMITS as L, parseSyncDiscovery, parseSyncEnrollment,
  parseSyncHeadSnapshot, parseSyncChainPage, parseSyncOperationStatus,
  type SyncEnrollment, type SyncHeadSnapshot } from './transportFormat'

export class SyncTransportError extends Error {
  constructor(readonly reason: 'unavailable' | 'not-admitted' | 'revoked' | 'protocol' | 'cancelled', readonly httpStatus?: number) {
    super(`sync_transport_${reason}`); this.name = 'SyncTransportError'
  }
}
/** Internal controller guard. The user-facing actor never accepts a Prepared,
 * receipt DTO, URL, token, source manifest or caller-supplied guard. */
export interface SyncDispatchGuard { signal?: AbortSignal; assertCurrent(): void; validateReadOnly(): Promise<void> }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function waitLocally<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => { cleanup(); reject(new SyncTransportError('cancelled')) }
    if (signal.aborted) { void promise.catch(() => {}); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}
function bounded(signals: (AbortSignal | undefined)[]) {
  const controller = new AbortController(), abort = () => controller.abort()
  const present = signals.filter((s): s is AbortSignal => !!s)
  for (const signal of present) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }) }
  const timer = setTimeout(abort, 45_000)
  return { signal: controller.signal, dispose() { abort(); clearTimeout(timer); for (const signal of present) signal.removeEventListener('abort', abort) } }
}

/** Capture synchronously, before discovery, consent, KDF or any await. The
 * transport owns this grant until close; it never captures a replacement to
 * repair an old action. It does not own or cancel the shared token refresh. */
export function createWorkspaceSyncTransport(signal?: AbortSignal) {
  const grant = captureGoogleGrant(), lifetime = new AbortController(), scope = captureLocalReadScope(lifetime.signal)
  if (!grant) throw new SyncTransportError('unavailable')
  let stopGrant = () => {}, stopLocal = () => {}
  const close = () => {
    lifetime.abort(); stopGrant(); stopLocal()
    signal?.removeEventListener('abort', close); documentWorkspaceSignal.removeEventListener('abort', close)
  }
  const assertCurrent = () => {
    try { scope.assertCurrent(); if (!grant.isCurrent() || lifetime.signal.aborted || signal?.aborted || documentWorkspaceSignal.aborted) throw new Error() }
    catch { close(); throw new SyncTransportError('cancelled') }
  }
  const validateReadOnly = async () => { assertCurrent(); await scope.validateReadOnly(); assertCurrent() }
  stopGrant = onGoogleGrantInvalidated(() => { if (!grant.isCurrent()) close() })
  stopLocal = onLocalDataInvalidated(() => { try { assertCurrent() } catch { close() } })
  signal?.addEventListener('abort', close, { once: true }); documentWorkspaceSignal.addEventListener('abort', close, { once: true })
  assertCurrent()

  async function request(params: Record<string, string>, method: 'GET' | 'POST' | 'PUT', body: string | Blob | undefined,
    extra: SyncDispatchGuard, binaryBytes?: number, unknownOperation = false): Promise<unknown> {
    const limit = binaryBytes ?? L.responseBytes, operation = bounded([lifetime.signal, extra.signal]), requestSignal = operation.signal
    const assert = () => { assertCurrent(); extra.assertCurrent(); if (requestSignal.aborted) throw new SyncTransportError('cancelled') }
    const validate = async () => { assert(); await waitLocally(extra.validateReadOnly(), requestSignal); await waitLocally(validateReadOnly(), requestSignal); assert() }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      assert()
      const token = await waitLocally(grant!.getAccessToken(), requestSignal)
      assert(); if (!token || token === 'native') throw new SyncTransportError('unavailable')
      await validate(); assert()
      const response = await waitLocally(fetch(apiUrl(`${SYNC_TRANSPORT_PATH}?${new URLSearchParams(params)}`), {
        method, headers: { Authorization: `Bearer ${token}`, 'x-google-token': token,
          ...(body === undefined ? {} : { 'Content-Type': typeof body === 'string' ? 'application/json' : 'application/octet-stream' }) },
        ...(body === undefined ? {} : { body }), signal: requestSignal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      }), requestSignal)
      assert()
      const binary = binaryBytes !== undefined && response.ok
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      if (contentType !== (binary ? 'application/octet-stream' : 'application/json') || response.redirected) throw new SyncTransportError('protocol')
      const length = response.headers.get('content-length'), maximum = binary ? limit : L.responseBytes
      if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maximum)) throw new SyncTransportError('protocol')
      if (!response.body) throw new SyncTransportError('protocol')
      reader = response.body.getReader()
      // Bound allocation as well as bytes: arbitrarily small network chunks
      // must not create an unbounded list of retained objects.
      const bytes = new Uint8Array(maximum); let received = 0
      for (;;) {
        const next = await waitLocally(reader.read(), requestSignal); assert()
        if (next.done) break
        if (!(next.value instanceof Uint8Array) || received + next.value.byteLength > maximum) throw new SyncTransportError('protocol')
        bytes.set(next.value, received); received += next.value.byteLength
      }
      reader.releaseLock(); reader = undefined
      await validate(); assert()
      const blob = new Blob([bytes.subarray(0, received)], { type: binary ? 'application/octet-stream' : 'application/json' })
      if (binary) {
        if (received !== binaryBytes) throw new SyncTransportError('protocol')
        return blob
      }
      let json: unknown
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await waitLocally(blob.arrayBuffer(), requestSignal))) }
      catch { assert(); throw new SyncTransportError('protocol') }
      assert(); await validate(); assert()
      if (!response.ok) {
        const error = envelopeFields(json, ['error']).error
        if (unknownOperation && response.status === 404 && error === 'operation_unknown') return null
        if (response.status === 404 && error === 'Sync starts unavailable') throw new SyncTransportError('not-admitted', 404)
        if (response.status === 410 && error === 'vault_revoked') throw new SyncTransportError('revoked', 410)
        // No generic 409 is interpreted as a definitive publication conflict.
        throw new SyncTransportError('unavailable', response.status)
      }
      return json
    } catch (error) {
      if (error instanceof SyncTransportError) throw error
      try { assert() } catch { throw new SyncTransportError('cancelled') }
      throw new SyncTransportError('unavailable')
    } finally { if (reader) void reader.cancel().catch(() => {}); operation.dispose() }
  }
  const json = (v: object) => {
    const body = JSON.stringify(v)
    if (new TextEncoder().encode(body).length > L.jsonBytes) throw new SyncTransportError('protocol')
    return body
  }
  const scopeParams = (input: SyncVaultScope) => envelopeScope({ vaultId: input.vaultId, epoch: input.epoch })
  const opParams = (input: SyncEnvelopeReference) => {
    const ref = parseSyncEnvelopeReference(input)
    return { vaultId: ref.vaultId, epoch: ref.epoch, operationId: ref.operationId }
  }
  async function statusResult(value: unknown, reference: SyncEnvelopeReference, expectedHead: string | null) {
    const result = parseSyncOperationStatus(value)
    if (!equal(result.reference, reference) || (result.status === 'published' ? result.previousHead : result.expectedHead) !== expectedHead) throw new SyncTransportError('protocol')
    return result
  }
  return Object.freeze({ close, assertCurrent, validateReadOnly, signal: lifetime.signal,
    owner: scope.owner, epoch: scope.epoch, fence: scope.fence,
    async discover(guard: SyncDispatchGuard) { return parseSyncDiscovery(await request({ action: 'discover' }, 'GET', undefined, guard)) },
    async challenge(enrollmentId: string, guard: SyncDispatchGuard) {
      const result = parseSyncEnrollment(await request({ action: 'challenge' }, 'POST', json({ enrollmentId }), guard))
      if (result.enrollmentId !== enrollmentId) throw new SyncTransportError('protocol')
      return result
    },
    async enroll(challenge: SyncEnrollment, guard: SyncDispatchGuard) {
      const result = parseSyncEnrollment(await request({ action: 'enroll' }, 'POST', json({ enrollmentId: challenge.enrollmentId, generation: challenge.generation, consent: true }), guard))
      if (!equal(challenge, result)) throw new SyncTransportError('protocol')
      return result
    },
    async join(discovered: Extract<ReturnType<typeof parseSyncDiscovery>, { status: 'active' }>, guard: SyncDispatchGuard) {
      const result = parseSyncDiscovery(await request({ action: 'join' }, 'POST', json({ generation: discovered.generation,
        vaultId: discovered.vaultId, epoch: discovered.epoch, consent: true }), guard))
      if (result.status !== 'active' || result.generation !== discovered.generation) throw new SyncTransportError('protocol')
      assertEnvelopeScope(result, discovered); return result
    },
    async head(bound: SyncVaultScope, guard: SyncDispatchGuard) {
      const result = parseSyncHeadSnapshot(await request({ action: 'head', ...scopeParams(bound) }, 'GET', undefined, guard))
      assertEnvelopeScope(bound, result); return result
    },
    async chain(anchor: SyncHeadSnapshot, after: number, guard: SyncDispatchGuard) {
      const result = parseSyncChainPage(await request({ action: 'chain', ...scopeParams(anchor), head: anchor.head ?? '', after: String(after) }, 'GET', undefined, guard))
      assertEnvelopeScope(anchor, result)
      if (result.head !== anchor.head || result.after !== after || after + result.entries.length > anchor.sequence ||
        (result.next === null) !== (after + result.entries.length === anchor.sequence)) throw new SyncTransportError('protocol')
      return result
    },
    async object(reference: SyncEnvelopeReference, guard: SyncDispatchGuard) {
      return await request({ action: 'object', ...opParams(reference) }, 'GET', undefined, guard, reference.bytes) as Blob
    },
    async status(reference: SyncEnvelopeReference, expectedHead: string | null, guard: SyncDispatchGuard) {
      const value = await request({ action: 'status', ...opParams(reference) }, 'GET', undefined, guard, undefined, true)
      return value === null ? null : statusResult(value, reference, expectedHead)
    },
    async reserve(reference: SyncEnvelopeReference, expectedHead: string | null, guard: SyncDispatchGuard) {
      return statusResult(await request({ action: 'reserve' }, 'POST', json({ reference, expectedHead }), guard), reference, expectedHead)
    },
    async upload(reference: SyncEnvelopeReference, expectedHead: string | null, ciphertext: Blob, guard: SyncDispatchGuard) {
      return statusResult(await request({ action: 'upload', ...opParams(reference) }, 'PUT', ciphertext, guard), reference, expectedHead)
    },
    async commit(reference: SyncEnvelopeReference, expectedHead: string | null, guard: SyncDispatchGuard) {
      return statusResult(await request({ action: 'commit', ...opParams(reference) }, 'POST', undefined, guard), reference, expectedHead)
    },
  })
}
