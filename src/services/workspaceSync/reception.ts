import { openSyncUpdate, type UnlockedSyncVault } from './encryption'
import { envelopeFail as fail, assertEnvelopeScope } from './envelopeFormat'
import { parseSyncManifest, encodeSyncManifest, recordHeads } from './schema'
import { parseSyncPublication, SYNC_TRANSPORT_LIMITS as L, type SyncPublication } from './transportFormat'
import type { createWorkspaceSyncTransport, SyncDispatchGuard } from './clientTransport'

type ReadTransport = Pick<ReturnType<typeof createWorkspaceSyncTransport>, 'head' | 'chain' | 'object' | 'signal'>
export interface SyncReceptionReport {
  status: 'received-not-applied'
  integrity: 'envelope-chain-verified'
  content: 'not-validated'
  anchor: SyncPublication
  remoteAdvanced: boolean
  operations: number
  records: number
  remoteConflicts: number
  payloads: number
  retainedPayloadBytes: number
  ciphertextBytes: number
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Internal read capability, not a public import/ACK input. The local actor
 * owns the real transport, key and exact durable-pair guard. Start at genesis:
 * its successors contain only new payloads, not all files of their manifest.
 * This verifies the complete envelope chain, NOT application DTO semantics.
 * No storage write, target lookup, merge, local capture or operation cleanup. */
export async function receiveSyncChain(key: UnlockedSyncVault, wire: ReadTransport,
  checkpointInput: SyncPublication, baseInput: unknown, guard: SyncDispatchGuard) {
  const checkpoint = parseSyncPublication(checkpointInput), localBase = parseSyncManifest(baseInput)
  assertEnvelopeScope(localBase, checkpoint.reference); assertEnvelopeScope(key, localBase)
  let disposed = false, manifest = parseSyncManifest({ ...localBase, records: [] })
  const bound = { vaultId: localBase.vaultId, epoch: localBase.epoch }
  let report: SyncReceptionReport | null = null, publication: SyncPublication | null = null, ids: readonly string[] = Object.freeze([])
  const payloads = new Map<string, Blob>(), operationIds = new Set<string>(), lifetime = new AbortController()
  const dispose = () => {
    disposed = true; payloads.clear(); operationIds.clear(); lifetime.abort()
    manifest = { format: 'arty-sync-causal', version: 1, ...bound, records: [] }; report = null; publication = null; ids = Object.freeze([])
    guard.signal?.removeEventListener('abort', dispose); wire.signal.removeEventListener('abort', dispose)
  }
  const assertCurrent = () => {
    if (disposed || guard.signal?.aborted || wire.signal.aborted) { dispose(); return fail('cancelled') }
    try { guard.assertCurrent() } catch (error) { dispose(); throw error }
  }
  const validate = async () => {
    assertCurrent()
    try { await guard.validateReadOnly(); assertCurrent() } catch (error) { dispose(); throw error }
  }
  guard.signal?.addEventListener('abort', dispose, { once: true }); wire.signal.addEventListener('abort', dispose, { once: true })
  let ciphertextBytes = 0, retainedPayloadBytes = 0, after = 0, last: SyncPublication | null = null, matchedCheckpoint = false
  try {
    await validate()
    const anchor = await wire.head(localBase, guard); assertCurrent()
    if (anchor.head === null || anchor.sequence < checkpoint.sequence || anchor.sequence > L.operations) return fail('base')
    while (after < anchor.sequence) {
      const page = await wire.chain(anchor, after, guard); assertCurrent()
      if (!page.entries.length || page.entries[0]!.previousHead !== (last?.head ?? null)) return fail('integrity')
      // Preflight the WHOLE page before allocating/downloading its objects.
      for (const entry of page.entries) {
        if (operationIds.has(entry.head) || operationIds.size >= L.operations) return fail('integrity')
        operationIds.add(entry.head); ciphertextBytes += entry.reference.bytes
        if (ciphertextBytes > L.vaultBytes) return fail('limit')
      }
      for (const entry of page.entries) {
        assertCurrent()
        if (entry.sequence !== after + 1 || entry.previousHead !== (last?.head ?? null)) return fail('integrity')
        const ciphertext = await wire.object(entry.reference, guard); assertCurrent()
        const opened = await openSyncUpdate(key, entry.reference, ciphertext, manifest)
        await opened.validate(); assertCurrent()
        const next = opened.manifest
        if (entry.sequence === 1 && (next.records.length || opened.payloadIds.length)) return fail('integrity')
        if (entry.sequence === checkpoint.sequence) {
          if (!equal(entry, checkpoint) || encodeSyncManifest(next) !== encodeSyncManifest(localBase)) return fail('base')
          matchedCheckpoint = true
        }
        for (const id of opened.payloadIds) {
          if (payloads.has(id)) return fail('integrity')
          const payload = opened.payload(id)
          retainedPayloadBytes += payload.size
          if (retainedPayloadBytes > L.vaultBytes) return fail('limit')
          payloads.set(id, payload)
        }
        // Keep only the latest manifest and immutable payload Blobs, not an
        // opened-envelope closure (and a full manifest) for every operation.
        manifest = next; last = entry; after++
      }
      if (page.next !== (after < anchor.sequence ? after : null)) return fail('integrity')
    }
    if (!matchedCheckpoint || !last || last.head !== anchor.head || last.sequence !== anchor.sequence) return fail('base')
    // All retained ancestry's live commitments must have their original body,
    // including dominated variants. A tombstone does not authorize GC here.
    for (const record of manifest.records) for (const revision of record.revisions) {
      if (revision.value.state === 'live' && payloads.get(revision.value.payloadId)?.size !== revision.value.bytes) return fail('missing')
    }
    const fresh = await wire.head(localBase, guard); assertCurrent()
    if (fresh.sequence < anchor.sequence || fresh.sequence === anchor.sequence && fresh.head !== anchor.head) return fail('base')
    await validate()
    publication = parseSyncPublication(last); ids = Object.freeze([...payloads.keys()])
    report = { status: 'received-not-applied', integrity: 'envelope-chain-verified', content: 'not-validated',
      anchor: publication, remoteAdvanced: fresh.sequence > anchor.sequence, operations: after, records: manifest.records.length,
      remoteConflicts: manifest.records.filter(r => recordHeads(r).length > 1).length, payloads: payloads.size, retainedPayloadBytes, ciphertextBytes }
    return Object.freeze({ dispose, assertCurrent, validate, signal: lifetime.signal,
      get report() { assertCurrent(); return structuredClone(report!) },
      get manifest() { assertCurrent(); return parseSyncManifest(manifest) },
      get publication() { assertCurrent(); return structuredClone(publication!) },
      get payloadIds() { assertCurrent(); return ids },
      payload(id: string) { assertCurrent(); const body = payloads.get(id); if (!body) return fail('missing'); return body },
    })
  } catch (error) { dispose(); throw error }
}

export type ReceivedSyncChain = Awaited<ReturnType<typeof receiveSyncChain>>
