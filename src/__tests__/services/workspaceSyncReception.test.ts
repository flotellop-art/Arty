import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createSyncVaultSession, prepareSyncUpdate } from '../../services/workspaceSync/encryption'
import { stageSyncChange, reconcileSyncManifests } from '../../services/workspaceSync/causal'
import { parseSyncManifest } from '../../services/workspaceSync/schema'
import { parseSyncChainPage, parseSyncPublication, SYNC_TRANSPORT_LIMITS as L } from '../../services/workspaceSync/transportFormat'
import { receiveSyncChain } from '../../services/workspaceSync/reception'
import type { SyncManifest, SyncKind } from '../../services/workspaceSync/types'
import type { SyncDispatchGuard } from '../../services/workspaceSync/clientTransport'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const bound = { vaultId: id(1), epoch: id(2) }
const code = 'ARTYSYNC1-00112233-44556677-8899AABB-CCDDEEFF-00112233-44556677-8899AABB-CCDDEEFF'
const empty = () => parseSyncManifest({ format: 'arty-sync-causal', version: 1, ...bound, records: [] })
const source = () => ({ assertCurrent() {}, async validate() {} })
const hash = async (body: Blob) => Buffer.from(await webcrypto.subtle.digest('SHA-256', await body.arrayBuffer())).toString('hex')
let abort: AbortController, guard: SyncDispatchGuard & { signal: AbortSignal }
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob); abort = new AbortController()
  guard = { signal: abort.signal, assertCurrent() { if (abort.signal.aborted) throw new Error('retired') }, validateReadOnly: vi.fn(async () => {}) }
})
afterEach(() => { abort.abort(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture() {
  const key = await createSyncVaultSession().unlock(code, bound, guard)
  const packets: { publication: ReturnType<typeof parseSyncPublication>; ciphertext: Blob; manifest: SyncManifest }[] = []
  let latest = empty(), counter = 100
  async function append(next = latest, payloads = new Map<string, Blob>()) {
    const packet = await prepareSyncUpdate(key, latest, next, payloads, source())
    const publication = parseSyncPublication({ protocol: 1, status: 'published', reference: packet.reference,
      previousHead: packets.at(-1)?.publication.head ?? null, head: packet.reference.operationId, sequence: packets.length + 1 })
    packets.push({ publication, ciphertext: packet.ciphertext, manifest: next }); latest = next
    return publication
  }
  async function edit(base: SyncManifest, recordId: string, text: string, kind: SyncKind = 'conversation') {
    const body = new Blob([text]), payloadId = id(++counter), revisionId = id(++counter)
    const record = base.records.find(r => r.id === recordId)
    const parents = record ? record.revisions.filter(r => !record.revisions.some(other => other.parents.includes(r.id))).map(r => r.id) : []
    return { next: stageSyncChange(base, { ...bound, recordId, kind, revision: { id: revisionId, intent: record ? 'edit' : 'create', parents,
      value: { state: 'live', payloadId, sha256: await hash(body), bytes: body.size } } }), payloads: new Map([[payloadId, body]]), payloadId, body }
  }
  const wire = { signal: abort.signal,
    head: vi.fn(async () => ({ protocol: 1 as const, ...bound, head: packets.at(-1)!.publication.head, sequence: packets.length })),
    chain: vi.fn(async (anchor: { head: string | null; sequence: number }, after: number) => parseSyncChainPage({ protocol: 1, ...bound, head: anchor.head, after,
      entries: packets.slice(after, Math.min(after + L.page, anchor.sequence)).map(p => p.publication), next: after + L.page < anchor.sequence ? after + L.page : null })),
    object: vi.fn(async (reference: { operationId: string }) => packets.find(p => p.publication.head === reference.operationId)!.ciphertext),
  }
  const genesis = await append()
  return { key, packets, append, edit, wire, genesis, get latest() { return latest } }
}

it('retains original binary bodies across incremental envelopes and validates a non-genesis checkpoint exactly', async () => {
  const f = await fixture(), old = await f.edit(f.latest, id(10), '\u0000original\u00ff', 'file')
  await f.append(old.next, old.payloads)
  const a = await f.edit(f.latest, id(11), 'A'); const checkpoint = await f.append(a.next, a.payloads), base = f.latest
  const b = await f.edit(f.latest, id(11), 'B'); await f.append(b.next, b.payloads)
  const received = await receiveSyncChain(f.key, f.wire, checkpoint, base, guard)
  expect(received.report).toMatchObject({ status: 'received-not-applied', content: 'not-validated', operations: 4, payloads: 3, records: 2 })
  expect(await received.payload(old.payloadId).arrayBuffer()).toEqual(await old.body.arrayBuffer())
  expect(await received.payload(a.payloadId).text()).toBe('A'); expect(await received.payload(b.payloadId).text()).toBe('B')
  expect(f.wire.object).toHaveBeenCalledTimes(4)
  const altered = received.manifest; altered.records.length = 0; expect(received.manifest.records).toHaveLength(2)
  received.dispose(); expect(() => received.payloadIds).toThrow('cancelled'); expect(() => received.manifest).toThrow('cancelled')
})

it('preserves all equal and unequal concurrent payloads without selecting a winner', async () => {
  const f = await fixture(), a = await f.edit(f.latest, id(10), 'A'); await f.append(a.next, a.payloads)
  const base = f.latest, left = await f.edit(base, id(10), 'equal'), right = await f.edit(base, id(10), 'equal')
  await f.append(reconcileSyncManifests(base, left.next, right.next), new Map([...left.payloads, ...right.payloads]))
  const received = await receiveSyncChain(f.key, f.wire, f.genesis, empty(), guard)
  expect(received.report).toMatchObject({ remoteConflicts: 1, payloads: 3 })
  expect(received.payloadIds).toContain(left.payloadId); expect(received.payloadIds).toContain(right.payloadId)
})

it.each(['reference', 'manifest'])('refuses a checkpoint with same sequence but different %s', async mode => {
  const f = await fixture(), a = await f.edit(f.latest, id(10), 'A'), actual = await f.append(a.next, a.payloads)
  const checkpoint = structuredClone(actual)
  if (mode === 'reference') checkpoint.reference.sha256 = 'a'.repeat(64)
  await expect(receiveSyncChain(f.key, f.wire, checkpoint, mode === 'manifest' ? empty() : f.latest, guard)).rejects.toThrow('base')
})

it('ordinary head advancement keeps the original historical anchor, never claims latest/applied', async () => {
  const f = await fixture(), a = await f.edit(f.latest, id(10), 'A'), checkpoint = await f.append(a.next, a.payloads)
  const base = f.latest, read = f.wire.object.getMockImplementation()!; let advanced = false
  f.wire.object.mockImplementation(async reference => {
    const body = await read(reference)
    if (!advanced) { advanced = true; const b = await f.edit(f.latest, id(10), 'B'); await f.append(b.next, b.payloads) }
    return body
  })
  const received = await receiveSyncChain(f.key, f.wire, checkpoint, base, guard)
  expect(received.report).toMatchObject({ remoteAdvanced: true, operations: 2, anchor: checkpoint, content: 'not-validated' })
  expect(received.manifest).toEqual(base); expect(f.packets).toHaveLength(3)
})

it.each(['same-sequence-other-head', 'rollback'])('final head %s invalidates the whole result', async mode => {
  const f = await fixture()
  f.wire.head.mockResolvedValueOnce({ protocol: 1, ...bound, head: f.genesis.head, sequence: 1 })
    .mockResolvedValueOnce({ protocol: 1, ...bound, head: mode === 'rollback' ? null as unknown as string : id(90), sequence: mode === 'rollback' ? 0 : 1 })
  await expect(receiveSyncChain(f.key, f.wire, f.genesis, empty(), guard)).rejects.toThrow('base')
})

it('corruption on the last page rejects after previous bodies were opened, with no partial capability', async () => {
  const f = await fixture(), a = await f.edit(f.latest, id(10), 'A'); await f.append(a.next, a.payloads)
  for (let i = 0; i < 30; i++) await f.append()
  const b = await f.edit(f.latest, id(10), 'B'); await f.append(b.next, b.payloads)
  const last = f.packets.at(-1)!, bytes = new Uint8Array(await last.ciphertext.arrayBuffer()); bytes[bytes.length - 1] ^= 1
  // Even when the outer reference matches the corrupted bytes, AEAD must fail.
  last.ciphertext = new Blob([bytes]); last.publication = parseSyncPublication({ ...last.publication, reference: { ...last.publication.reference, sha256: await hash(last.ciphertext) } })
  await expect(receiveSyncChain(f.key, f.wire, f.genesis, empty(), guard)).rejects.toThrow('integrity')
  expect(f.wire.object).toHaveBeenCalledTimes(33)
})

it('an independently valid second page cannot substitute its first predecessor', async () => {
  const f = await fixture()
  for (let i = 0; i < 32; i++) await f.append()
  const original = f.wire.chain.getMockImplementation()!
  f.wire.chain.mockImplementation(async (anchor, after) => {
    const page = await original(anchor, after)
    return after === 32 ? parseSyncChainPage({ ...page, entries: page.entries.map(entry => ({ ...entry, previousHead: id(90) })) }) : page
  })
  await expect(receiveSyncChain(f.key, f.wire, f.genesis, empty(), guard)).rejects.toThrow('integrity')
  expect(f.wire.object).toHaveBeenCalledTimes(32)
})

it('cumulative page budget rejects before any of its ciphertext downloads', async () => {
  const f = await fixture(), entries = Array.from({ length: 9 }, (_, i) => parseSyncPublication({ protocol: 1, status: 'published', sequence: i + 1,
    head: id(i + 30), previousHead: i ? id(i + 29) : null, reference: { ...f.genesis.reference, operationId: id(i + 30), bytes: 17 * 1024 * 1024 } }))
  f.wire.head.mockResolvedValue({ protocol: 1, ...bound, head: entries.at(-1)!.head, sequence: 9 })
  f.wire.chain.mockResolvedValue(parseSyncChainPage({ protocol: 1, ...bound, head: entries.at(-1)!.head, after: 0, entries, next: null }))
  await expect(receiveSyncChain(f.key, f.wire, f.genesis, empty(), guard)).rejects.toThrow('limit')
  expect(f.wire.object).not.toHaveBeenCalled()
})

it('operation cap refuses before requesting a chain and key retirement invalidates retained data', async () => {
  const f = await fixture()
  f.wire.head.mockResolvedValueOnce({ protocol: 1, ...bound, head: f.genesis.head, sequence: 513 })
  await expect(receiveSyncChain(f.key, f.wire, f.genesis, empty(), guard)).rejects.toThrow(); expect(f.wire.chain).not.toHaveBeenCalled()
  const received = await receiveSyncChain(f.key, f.wire, f.genesis, empty(), guard)
  abort.abort(); expect(() => received.report).toThrow('cancelled'); await expect(received.validate()).rejects.toThrow('cancelled')
})
