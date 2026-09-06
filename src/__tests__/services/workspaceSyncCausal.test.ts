import { describe, expect, it } from 'vitest'
import { reconcileSyncManifests as merge, stageSyncChange as stage, syncVariants } from '../../services/workspaceSync/causal'
import { decodeSyncManifest, encodeSyncManifest, parseSyncManifest } from '../../services/workspaceSync/schema'
import { SYNC_LIMITS as L, SyncProtocolError, type SyncManifest, type SyncChange, type SyncRevision, type SyncValue } from '../../services/workspaceSync/types'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const vaultId = id(1), epoch = id(2), recordId = id(3)
const empty = (): SyncManifest => ({ format: 'arty-sync-causal', version: 1, vaultId, epoch, records: [] })
const live = (n: number, hash = n): SyncValue => ({ state: 'live', payloadId: id(100_000 + n), sha256: hash.toString(16).padStart(64, '0'), bytes: 20 })
const change = (n: number, parents: number[] = [], value = live(n), intent: SyncRevision['intent'] = parents.length ? 'edit' : 'create', objectId = recordId): SyncChange =>
  ({ vaultId, epoch, recordId: objectId, kind: 'conversation', revision: { id: id(n), intent, parents: parents.map(id), value } })
const start = () => stage(empty(), change(10))
const heads = (m: SyncManifest, objectId = recordId) => syncVariants(m).find(v => v.recordId === objectId)!.heads.map(h => h.id)
const codes = (run: () => unknown, code: SyncProtocolError['code']) => {
  try { run(); throw new Error('expected protocol error') }
  catch (error) { expect(error).toBeInstanceOf(SyncProtocolError); expect((error as SyncProtocolError).code).toBe(code) }
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

describe('sync causal candidate — pure protocol, NOT a delivered sync client', () => {
  it('accepts a canonical closed manifest and detaches every input object', () => {
    const source = start(), encoded = encodeSyncManifest(source), result = decodeSyncManifest(encoded)
    expect(result).toEqual(source)
    source.records[0]!.revisions[0]!.value = { state: 'deleted' }
    expect(encodeSyncManifest(result)).toBe(encoded)
  })

  it('automatically combines disjoint records without recreating identities', () => {
    const base = start(), a = stage(base, change(11, [10])), b = stage(base, change(20, [], live(20), 'create', id(4)))
    const result = merge(base, a, b)
    expect(result.records.map(r => r.id)).toEqual([recordId, id(4)])
    expect(heads(result)).toEqual([id(11)])
    expect(heads(result, id(4))).toEqual([id(20)])
    expect(syncVariants(result).some(v => v.conflict)).toBe(false)
    expect(merge(result, result, result)).toEqual(result)
  })

  it('keeps both concurrent edits, even if their plaintext commitments match', () => {
    const base = start(), a = stage(base, change(11, [10], live(11, 7))), b = stage(base, change(12, [10], live(12, 7)))
    const merged = merge(base, a, b)
    expect(heads(merged)).toEqual([id(11), id(12)])
    expect(syncVariants(merged)[0]!.conflict).toBe(true)
    expect(merge(base, b, a)).toEqual(merged)
  })

  it('treats delete versus edit as a visible conflict, not a delete winner', () => {
    const base = start(), deleted = stage(base, change(11, [10], { state: 'deleted' }, 'delete'))
    const edited = stage(base, change(12, [10]))
    const result = merge(base, deleted, edited)
    expect(syncVariants(result)[0]).toMatchObject({ conflict: true })
    expect(syncVariants(result)[0]!.heads.map(h => h.value.state)).toEqual(['deleted', 'live'])
  })

  it('retains indirect ancestors after resolution and ignores their exact replays', () => {
    const base = start(), a = stage(base, change(11, [10])), b = stage(base, change(12, [10]))
    const joined = merge(base, a, b), resolved = stage(joined, change(13, [12, 11], live(13), 'resolve'))
    expect(resolved.records[0]!.revisions).toHaveLength(4)
    for (const old of [base, a, b, joined, resolved]) {
      const result = merge(base, resolved, old)
      expect(result).toEqual(resolved)
      expect(heads(result)).toEqual([id(13)])
    }
    expect(stage(resolved, change(11, [10]))).toEqual(resolved)
    expect(stage(resolved, change(13, [11, 12], live(13), 'resolve'))).toEqual(resolved)
  })

  it('preserves a NEW offline edit from a dominated parent after a resolved deletion', () => {
    const base = start(), a = stage(base, change(11, [10])), b = stage(base, change(12, [10]))
    const joined = merge(base, a, b), resolved = stage(joined, change(13, [11, 12], { state: 'deleted' }, 'resolve'))
    const oldDevice = stage(b, change(14, [12]))
    const result = merge(base, resolved, oldDevice)
    expect(heads(result)).toEqual([id(13), id(14)])
    expect(syncVariants(result)[0]!.conflict).toBe(true)
    expect(merge(base, result, b)).toEqual(result)
  })

  it('does not absorb a third head arriving after the resolution preview', () => {
    const base = start(), a = stage(base, change(11, [10])), b = stage(base, change(12, [10])), c = stage(base, change(14, [10]))
    const joined = merge(base, a, b), resolution = change(13, [11, 12], live(13), 'resolve')
    const resolved = stage(joined, resolution)
    expect(heads(merge(base, resolved, c))).toEqual([id(13), id(14)])
    // If C is already in the local snapshot, the caller must ask again.
    codes(() => stage(merge(base, joined, c), resolution), 'changed')
  })

  it('requires explicit restoration from an observed tombstone', () => {
    const deleted = stage(start(), change(11, [10], { state: 'deleted' }, 'delete'))
    codes(() => stage(deleted, change(12, [11])), 'format')
    codes(() => stage(deleted, change(12)), 'changed')
    const restored = stage(deleted, change(12, [11], live(12), 'restore'))
    expect(heads(restored)).toEqual([id(12)])
    expect(merge(start(), restored, deleted)).toEqual(restored)
    codes(() => stage(start(), change(12, [10], live(12), 'restore')), 'format')
  })

  it('preserves ABA causality even when X is restored byte-for-byte', () => {
    const x = start(), y = stage(x, change(11, [10])), again = stage(y, change(12, [11], live(10)))
    expect(heads(again)).toEqual([id(12)])
    expect(again.records[0]!.revisions).toHaveLength(3)
    expect(merge(x, again, x)).toEqual(again)
  })

  it('requires all observed heads for a resolution and never turns an edit into one', () => {
    const base = start(), joined = merge(base, stage(base, change(11, [10])), stage(base, change(12, [10])))
    codes(() => stage(joined, change(13, [11])), 'changed')
    codes(() => stage(joined, change(13, [11, 12])), 'format')
    codes(() => stage(joined, change(13, [11], live(13), 'resolve')), 'format')
    expect(heads(stage(joined, change(13, [11, 12], live(13), 'resolve')))).toEqual([id(13)])
  })

  it('rejects missing ACK ancestry, not treating an absent record as a deletion', () => {
    const base = start(), updated = stage(base, change(11, [10]))
    codes(() => merge(base, updated, empty()), 'rebase')
    codes(() => merge(base, empty(), updated), 'rebase')
    // A valid standalone root replacing the base is still a pruned checkpoint.
    codes(() => merge(base, updated, stage(empty(), change(12))), 'rebase')
    expect(base).toEqual(start())
  })

  it.each(['vaultId', 'epoch'] as const)('rejects cross-%s manifests AND local intentions', key => {
    const base = start(), foreign = { ...base, [key]: id(200) }
    codes(() => merge(base, base, foreign), 'scope')
    codes(() => merge(base, foreign, base), 'scope')
    codes(() => stage(base, { ...change(11, [10]), [key]: id(200) }), 'scope')
  })

  it('rejects reused operation IDs with different values, parents or kinds', () => {
    const base = start(), a = stage(base, change(11, [10])), b = stage(base, change(11, [10], live(12)))
    codes(() => merge(base, a, b), 'equivocation')
    codes(() => stage(a, change(11, [10], live(12))), 'equivocation')
    codes(() => stage(a, { ...change(11, [10]), kind: 'project' }), 'equivocation')
    codes(() => stage(a, change(11, [], live(11))), 'equivocation')
    const changedBase = copy(base); changedBase.records[0]!.revisions[0]!.value = live(99)
    codes(() => merge(base, a, changedBase), 'equivocation')
  })

  it('detects global revision or payload equivocation introduced only by the union', () => {
    const a = stage(empty(), change(10)), other = change(10, [], live(10), 'create', id(4))
    codes(() => merge(empty(), a, stage(empty(), other)), 'equivocation')
    const payloadReuse = change(11, [], live(10), 'create', id(4))
    codes(() => merge(empty(), a, stage(empty(), payloadReuse)), 'equivocation')
    const payloadMutation = stage(empty(), change(10))
    codes(() => stage(payloadMutation, change(11, [10], { ...live(10), bytes: 21 })), 'equivocation')
  })

  it('keeps prepared intentions detached when callers later mutate their inputs', () => {
    const source = start(), intention = change(11, [10]), before = copy(source), result = stage(source, intention)
    expect(source).toEqual(before)
    intention.revision.parents.push(id(12)); intention.revision.value = { state: 'deleted' }
    source.records.splice(0)
    expect(result.records[0]!.revisions[1]).toEqual(change(11, [10]).revision)
  })

  it('is commutative, associative and idempotent for bounded independent branches', () => {
    const base = start()
    const branches = [stage(base, change(11, [10])), stage(base, change(12, [10])), stage(base, change(13, [10], { state: 'deleted' }, 'delete'))]
    const expected = encodeSyncManifest(merge(base, merge(base, branches[0], branches[1]), branches[2]))
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      const x = merge(base, merge(base, branches[a!], branches[b!]), branches[c!])
      const y = merge(base, branches[a!], merge(base, branches[b!], branches[c!]))
      expect(encodeSyncManifest(x)).toBe(expected)
      expect(encodeSyncManifest(y)).toBe(expected)
      expect(merge(base, x, x)).toEqual(x)
    }
  })

  it('converges under repeated out-of-order delivery, after multiple offline edits', () => {
    const base = start(), devices = [base, base, base]
    for (let round = 0; round < 7; round++) {
      for (let device = 0; device < 3; device++) {
        const parent = heads(devices[device]!)[0]!
        devices[device] = stage(devices[device], change(100 + round * 3 + device, [parseInt(parent.slice(-12), 16)]))
      }
    }
    const wire = devices.map(encodeSyncManifest)
    const all = merge(base, merge(base, devices[0], devices[1]), devices[2])
    for (const order of [[2, 0, 1, 2, 0], [0, 2, 0, 1, 1], [1, 0, 2, 1, 2]]) {
      let current = base
      for (const index of order) current = merge(base, current, decodeSyncManifest(wire[index]!))
      expect(current).toEqual(all)
      expect(syncVariants(current)[0]!.heads).toHaveLength(3)
    }
  })
})

describe('sync manifest candidate — hostile and bounded data', () => {
  it.each([
    ['unknown version', (m: any) => { m.version = 2 }],
    ['unknown root key', (m: any) => { m.owner = 'forged' }],
    ['non-v4 UUID', (m: any) => { m.vaultId = '00000000-0000-1000-8000-000000000001' }],
    ['UUID with trailing LF', (m: any) => { m.vaultId += '\n' }],
    ['UUID with trailing CR', (m: any) => { m.records[0].id += '\r' }],
    ['hash with trailing LF', (m: any) => { m.records[0].revisions[0].value.sha256 += '\n' }],
    ['hash with trailing line separator', (m: any) => { m.records[0].revisions[0].value.sha256 += '\u2028' }],
    ['unknown kind', (m: any) => { m.records[0].kind = 'oauth-token' }],
    ['unknown revision key', (m: any) => { m.records[0].revisions[0].resolved = true }],
    ['empty record', (m: any) => { m.records[0].revisions = [] }],
    ['unknown state', (m: any) => { m.records[0].revisions[0].value.state = 'missing' }],
    ['zero bytes', (m: any) => { m.records[0].revisions[0].value.bytes = 0 }],
    ['fraction bytes', (m: any) => { m.records[0].revisions[0].value.bytes = 1.5 }],
    ['invalid commitment', (m: any) => { m.records[0].revisions[0].value.sha256 = 'not-a-hash' }],
    ['payload URL', (m: any) => { m.records[0].revisions[0].value.payloadId = 'https://example.com/steal' }],
    ['root tombstone', (m: any) => { m.records[0].revisions[0].intent = 'delete'; m.records[0].revisions[0].value = { state: 'deleted' } }],
    ['tombstone hidden payload', (m: any) => { m.records[0].revisions[1].value = { state: 'deleted', payloadId: id(400) }; m.records[0].revisions[1].intent = 'delete' }],
    ['missing parent', (m: any) => { m.records[0].revisions[1].parents = [id(999)] }],
    ['self parent', (m: any) => { m.records[0].revisions[1].parents = [id(11)] }],
    ['duplicate parent', (m: any) => { m.records[0].revisions[1].parents = [id(10), id(10)]; m.records[0].revisions[1].intent = 'resolve' }],
    ['two-node cycle', (m: any) => { m.records[0].revisions[0].intent = 'edit'; m.records[0].revisions[0].parents = [id(11)] }],
    ['missing field', (m: any) => { delete m.records[0].kind }],
  ])('refuses %s', (_name, mutate) => {
    const m = stage(start(), change(11, [10])); mutate(m)
    codes(() => parseSyncManifest(m), 'format')
  })

  it('rejects a redundant parent that is already dominated by another parent', () => {
    const m = stage(start(), change(11, [10]))
    m.records[0]!.revisions.push(change(12, [10, 11], live(12), 'resolve').revision)
    codes(() => parseSyncManifest(m), 'format')
  })

  it('rejects a parent belonging to a different logical object', () => {
    const m = stage(start(), change(20, [], live(20), 'create', id(4)))
    m.records[1]!.revisions.push(change(21, [10]).revision)
    codes(() => parseSyncManifest(m), 'format')
  })

  it.each(['root', 'array', 'record', 'revision', 'parents', 'value'])('does not invoke accessors on %s', target => {
    const m = start(); let called = 0
    const lookup: Record<string, [object, string]> = {
      root: [m, 'records'], array: [m.records, '0'], record: [m.records[0]!, 'kind'],
      revision: [m.records[0]!.revisions[0]!, 'id'], parents: [m.records[0]!.revisions[0]!, 'parents'], value: [m.records[0]!.revisions[0]!.value, 'state'],
    }
    const [object, key] = lookup[target]!
    Object.defineProperty(object, key, { enumerable: true, get() { called++; throw new Error('must not run') } })
    codes(() => parseSyncManifest(m), 'format'); expect(called).toBe(0)
  })

  it.each(['symbol', 'hidden', 'prototype', 'sparse', 'cycle'])('refuses non-JSON %s data', type => {
    const m = start()
    if (type === 'symbol') Object.defineProperty(m, Symbol('hidden'), { value: true })
    if (type === 'hidden') Object.defineProperty(m, 'secret', { value: true })
    if (type === 'prototype') Object.setPrototypeOf(m, { secret: true })
    if (type === 'sparse') delete m.records[0]
    if (type === 'cycle') (m.records[0] as unknown) = m
    codes(() => parseSyncManifest(m), 'format')
  })

  it('rejects noncanonical JSON including duplicate keys and malformed bytes', () => {
    const encoded = encodeSyncManifest(start())
    for (const raw of ['', '{', `${encoded} `, encoded.replace('"version":1', '"version":2,"version":1'), encoded.replace('"version":1', '"version":1.0')]) {
      codes(() => decodeSyncManifest(raw), 'format')
    }
    codes(() => decodeSyncManifest(' '.repeat(L.manifestBytes + 1)), 'limit')
    codes(() => decodeSyncManifest('é'.repeat(L.manifestBytes)), 'limit')
  })

  it('canonicalizes only graph set order, never uses UUIDs as causal clocks', () => {
    const base = start(), a = stage(base, change(9, [10])), b = stage(base, change(8, [10]))
    const joined = merge(base, a, b), resolved = stage(joined, change(7, [8, 9], live(7), 'resolve'))
    const permuted = copy(resolved)
    permuted.records.reverse(); permuted.records[0]!.revisions.reverse()
    permuted.records[0]!.revisions.forEach(r => r.parents.reverse())
    expect(encodeSyncManifest(permuted)).toBe(encodeSyncManifest(resolved))
    expect(heads(resolved)).toEqual([id(7)])
  })

  it('rejects head overflow only introduced by a merge without truncating either side', () => {
    const base = start()
    const branches = Array.from({ length: 17 }, (_, i) => stage(base, change(20 + i, [10])))
    let accumulated = base
    for (const branch of branches.slice(0, 16)) accumulated = merge(base, accumulated, branch)
    const before = encodeSyncManifest(accumulated), incoming = encodeSyncManifest(branches[16])
    expect(heads(accumulated)).toHaveLength(L.headsPerRecord)
    codes(() => merge(base, accumulated, branches[16]), 'limit')
    expect(encodeSyncManifest(accumulated)).toBe(before)
    expect(encodeSyncManifest(branches[16])).toBe(incoming)
  })

  it('does not collect ancestry to make a long chain fit', () => {
    const m = start()
    for (let i = 1; i < L.revisionsPerRecord; i++) m.records[0]!.revisions.push(change(10 + i, [9 + i]).revision)
    expect(heads(parseSyncManifest(m))).toEqual([id(10 + L.revisionsPerRecord - 1)])
    const before = encodeSyncManifest(m)
    codes(() => stage(m, change(10 + L.revisionsPerRecord, [9 + L.revisionsPerRecord])), 'limit')
    expect(encodeSyncManifest(m)).toBe(before)
  })

  it('can retry a refused 17th head after resolving 16, preserving that offline intention', () => {
    const base = start(), branches = Array.from({ length: 17 }, (_, i) => stage(base, change(20 + i, [10])))
    let pending = base
    for (const branch of branches.slice(0, 16)) pending = merge(base, pending, branch)
    const incomingBefore = encodeSyncManifest(branches[16])
    codes(() => merge(base, pending, branches[16]), 'limit')
    const resolved = stage(pending, change(50, Array.from({ length: 16 }, (_, i) => 20 + i), live(50), 'resolve'))
    const combined = merge(base, resolved, branches[16])
    expect(heads(combined)).toEqual([id(36), id(50)])
    expect(combined.records[0]!.revisions).toHaveLength(19)
    expect(encodeSyncManifest(branches[16])).toBe(incomingBefore)
    expect(combined.records[0]!.revisions.find(r => r.id === id(36))).toEqual(change(36, [10]).revision)
  })

  it('bounds records, aggregate revisions, individual payloads and JSON wire size', () => {
    const m = start(); (m.records as unknown[]) = Array(L.records + 1).fill(null)
    codes(() => parseSyncManifest(m), 'limit')
    const many = empty()
    for (let record = 0; record < 40; record++) {
      const revisions = Array.from({ length: 256 }, (_, i) => change(1000 + record * 256 + i, i ? [999 + record * 256 + i] : []).revision)
      many.records.push({ id: id(50_000 + record), kind: 'conversation', revisions })
    }
    codes(() => parseSyncManifest(many), 'limit')
    const large = start(); (large.records[0]!.revisions[0]!.value as any).bytes = L.objectBytes + 1
    codes(() => parseSyncManifest(large), 'limit')
  })

  it('rejects oversized VALID DAG metadata without dropping revisions or commitments', () => {
    const dense = empty()
    for (let object = 0; object < 20; object++) {
      const revisions: SyncRevision[] = []
      for (let layer = 0; layer < 16; layer++) {
        const parents = layer ? Array.from({ length: 16 }, (_, branch) => 1000 + object * 256 + (layer - 1) * 16 + branch) : []
        for (let branch = 0; branch < 16; branch++) {
          const n = 1000 + object * 256 + layer * 16 + branch
          revisions.push(change(n, parents, live(n), layer ? 'resolve' : 'create').revision)
        }
      }
      dense.records.push({ id: id(60_000 + object), kind: 'conversation', revisions })
    }
    const before = JSON.stringify(dense)
    expect(before.length).toBeGreaterThan(L.manifestBytes)
    expect(dense.records.reduce((sum, r) => sum + r.revisions.length, 0)).toBeLessThan(L.revisions)
    codes(() => parseSyncManifest(dense), 'limit')
    expect(JSON.stringify(dense)).toBe(before)
  })
})
