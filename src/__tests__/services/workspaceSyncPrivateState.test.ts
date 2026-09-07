import { expect, it, vi } from 'vitest'
import { parseSyncPrivateState, syncPrivateLocalHead, syncPrivatePendingBase } from '../../services/workspaceSync/privateState'
import { parseSyncManifest, recordHeads } from '../../services/workspaceSync/schema'
import { reconcileSyncManifests, stageSyncChange } from '../../services/workspaceSync/causal'
import { SYNC_STATE_BYTES } from '../../services/workspaceSync/localFormat'
import type { SyncManifest } from '../../services/workspaceSync/types'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const scope = { vaultId: id(1), epoch: id(2) }
const empty = parseSyncManifest({ format: 'arty-sync-causal', version: 1, ...scope, records: [] })
const publication = (n: number) => ({ protocol: 1, status: 'published', sequence: n, head: id(10 + n), previousHead: n === 1 ? null : id(9 + n),
  reference: { format: 'arty-sync-envelope-ref', version: 1, ...scope, operationId: id(10 + n), bytes: 256, sha256: 'a'.repeat(64) } })
function edit(base: SyncManifest, n: number, recordId = id(100)) {
  const record = base.records.find(r => r.id === recordId)
  return stageSyncChange(base, { ...scope, recordId, kind: 'conversation', revision: { id: id(1000 + n), intent: record ? 'edit' : 'create',
    parents: record ? recordHeads(record).map(r => r.id) : [], value: { state: 'live', payloadId: id(2000 + n), sha256: 'b'.repeat(64), bytes: 256 } } })
}
const m = edit(empty, 1), r = edit(m, 2), c = edit(m, 3)
const bindings = (base: SyncManifest) => base.records.map(record => ({ kind: record.kind, logicalId: record.id, localId: `local-${record.id}`, parentLocalId: null, presence: 'record' }))
const state = (base = r, materialized = m, pendingBase: unknown = null) => ({ format: 'arty-sync-private-state', version: 3, base, materialized, pendingBase,
  bindings: bindings(materialized), admission: { kind: 'create', challenge: { protocol: 1, ...scope, enrollmentId: id(3), generation: id(4) } },
  checkpoint: publication(3), selection: { conversationIds: ['local-chat'], projectIds: [] } })

it('v3 maps only the represented branch; transport-only records need no physical addresses', () => {
  const t = edit(r, 4, id(101)), parsed = parseSyncPrivateState(state(t))
  expect(syncPrivateLocalHead(parsed, null)).toEqual(m)
  expect(parsed.base.records).toHaveLength(2); expect(parsed.bindings).toHaveLength(1)
  expect(syncPrivateLocalHead(parseSyncPrivateState(state(t, empty)), null)).toEqual(empty)
})

it('v3 preserves a physical branch instead of choosing a transport winner', () => {
  const union = reconcileSyncManifests(m, r, c), parsed = parseSyncPrivateState(state(union, c))
  expect(recordHeads(union.records[0]!)).toHaveLength(2)
  expect(syncPrivateLocalHead(parsed, null)).toEqual(c)
  expect(() => parseSyncPrivateState(state(union, union))).toThrow('base')
})

it('pending M must be covered by the opened A, not just the private JSON declaration', () => {
  const parsed = parseSyncPrivateState(state(r, c, { base: r, checkpoint: publication(3) }))
  expect(syncPrivatePendingBase(parsed)).toEqual(r)
  const union = reconcileSyncManifests(m, r, c)
  expect(syncPrivateLocalHead(parsed, union)).toEqual(c)
  expect(() => syncPrivateLocalHead(parsed, r)).toThrow('rebase')
  expect(() => syncPrivateLocalHead(parsed, null)).toThrow('missing')
  expect(() => syncPrivateLocalHead(parseSyncPrivateState(state()), union)).toThrow('missing')
})

it('pending origin may be historical, but T must retain it exactly with a monotone complete checkpoint', () => {
  const parsed = parseSyncPrivateState(state(r, m, { base: m, checkpoint: publication(2) }))
  expect(syncPrivatePendingBase(parsed)).toEqual(m)
  expect(syncPrivateLocalHead(parsed, c)).toEqual(m)
  for (const pending of [
    { base: c, checkpoint: publication(2) },
    { base: m, checkpoint: publication(3) },
    { base: r, checkpoint: publication(4) },
    { base: r, checkpoint: { ...publication(3), reference: { ...publication(3).reference, sha256: 'c'.repeat(64) } } },
    { base: r, checkpoint: null },
    { base: { ...r, epoch: id(99) }, checkpoint: publication(3) },
  ]) expect(() => parseSyncPrivateState(state(r, m, pending))).toThrow()
})

it('no absent ancestor, invented revision or equivocation becomes a represented baseline', () => {
  const changed = structuredClone(m); changed.records[0]!.revisions[0]!.value = { state: 'live', payloadId: id(2001), sha256: 'c'.repeat(64), bytes: 256 }
  expect(() => parseSyncPrivateState(state(r, changed))).toThrow('equivocation')
  expect(() => parseSyncPrivateState(state(r, c))).toThrow('rebase')
  const pruned = structuredClone(r); pruned.records[0]!.revisions.shift()
  expect(() => parseSyncPrivateState(state(r, pruned))).toThrow()
  expect(() => parseSyncPrivateState({ ...state(), bindings: [] })).toThrow('missing')
  expect(() => parseSyncPrivateState({ ...state(), bindings: [...bindings(m), { ...bindings(m)[0], logicalId: id(500), localId: 'extra' }] })).toThrow('missing')
})

it('unresolved/embedded bindings may not alias a different record domain retained only by T', () => {
  const t = edit(r, 4, id(101)), parsed = parseSyncPrivateState({ ...state(t), bindings: [
    ...bindings(m), { kind: 'group', logicalId: id(101), localId: 'weak-group', parentLocalId: null, presence: 'reference' },
  ] })
  expect(() => syncPrivateLocalHead(parsed, null)).toThrow('integrity')
})

it('genesis permits only an empty captured branch and its frozen empty origin', () => {
  const genesis = { ...state(empty, empty, { base: empty, checkpoint: null }), checkpoint: null }
  expect(syncPrivateLocalHead(parseSyncPrivateState(genesis), empty)).toEqual(empty)
  expect(() => parseSyncPrivateState({ ...genesis, base: m })).toThrow('base')
  expect(() => parseSyncPrivateState({ ...genesis, pendingBase: null })).toThrow('base')
  expect(() => parseSyncPrivateState({ ...genesis, admission: { kind: 'join', generation: id(4) } })).toThrow('base')
  expect(() => syncPrivateLocalHead(parseSyncPrivateState({ ...genesis, materialized: m, bindings: bindings(m) }), empty)).toThrow('rebase')
})

it('closed v3 does not execute discriminators, nested origin getters or silently upgrade v1/v2', () => {
  const getter = vi.fn(() => r), accessed = { base: r, checkpoint: publication(3) }
  Object.defineProperty(accessed, 'base', { enumerable: true, get: getter })
  expect(() => parseSyncPrivateState(state(r, m, accessed))).toThrow(); expect(getter).not.toHaveBeenCalled()
  for (const invalid of [{ ...state(), extra: true }, { ...state(), version: 4 }, { ...state(), materialized: undefined }, state(r, m, { base: r, checkpoint: publication(3), extra: true })]) {
    expect(() => parseSyncPrivateState(invalid)).toThrow()
  }
  const { materialized: _m, pendingBase: _p, ...v2 } = state(m, m)
  const parsed = parseSyncPrivateState({ ...v2, version: 2 })
  expect(parsed.version).toBe(2); expect(parsed).not.toHaveProperty('materialized')
  expect(syncPrivateLocalHead(parsed, r)).toEqual(r)
})

it('the complete private state can exceed 8 MiB even when every manifest passes; never trim to fit', () => {
  const records = Array.from({ length: 2000 }, (_, row) => ({ id: id(100_000 + row), kind: 'conversation',
    revisions: Array.from({ length: 5 }, (_, rev) => ({ id: id(200_000 + row * 5 + rev), intent: rev ? 'edit' : 'create',
      parents: rev ? [id(200_000 + row * 5 + rev - 1)] : [], value: { state: 'live', payloadId: id(300_000 + row * 5 + rev), sha256: 'd'.repeat(64), bytes: 1024 } })) }))
  const large = parseSyncManifest({ ...empty, records }), input = state(large, large, { base: large, checkpoint: publication(3) })
  expect(new TextEncoder().encode(JSON.stringify(input)).length).toBeGreaterThan(SYNC_STATE_BYTES)
  expect(() => parseSyncPrivateState(input)).toThrow('limit')
  expect(input.base.records).toHaveLength(2000); expect(input.base.records[0]!.revisions).toHaveLength(5)
})
