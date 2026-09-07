import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { isolatedWorkspaceLayout } from '../../services/workspaceWriter/layout'
import { syncStorageContext, parseSyncStorageKey, parseSyncStorageRow, syncStateBinding, assertSyncPair, syncBase64Size,
  type SyncStateRow, type SyncOperationRow } from '../../services/workspaceSync/localFormat'
import { parseSyncPrivateState, assertSyncMappingExtension, assertSyncPrivateHead, type SyncLocalBinding } from '../../services/workspaceSync/privateState'
import { createSyncVaultSession, sealSyncLocalState, openSyncLocalState } from '../../services/workspaceSync/encryption'
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const identity = { owner: 'a', generation: id(1), enrollmentId: id(2), vaultId: id(3), epoch: id(4), revision: 1 }
const reference = { format: 'arty-sync-envelope-ref' as const, version: 1 as const, vaultId: id(3), epoch: id(4), operationId: id(5), bytes: 130, sha256: 'a'.repeat(64) }
const state = (): SyncStateRow => ({ format: 'arty-sync-local-state', version: 1, ...identity, pending: reference, ciphertext: btoa('x'.repeat(69)) })
const operation = (): SyncOperationRow => ({ format: 'arty-sync-local-operation', version: 1, ...identity, reference, ciphertext: btoa('y'.repeat(130)) })
const binding = (): SyncLocalBinding => ({ kind: 'conversation', localId: 'chat', parentLocalId: null, logicalId: id(6), presence: 'reference' })
const base = () => ({ format: 'arty-sync-causal', version: 1, vaultId: id(3), epoch: id(4), records: [] })
const privateState = (bindings: unknown[] = []) => ({ format: 'arty-sync-private-state', version: 1, base: base(), bindings })
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('requires exact active physical-2 descriptor, not a legacy witness with the same version', () => {
  const layout = isolatedWorkspaceLayout(id(1), [], 2)
  expect(syncStorageContext(layout, layout.projects)).toEqual({ generation: id(1) })
  expect(syncStorageContext(layout, { name: 'arty-projects', version: 2 })).toBeUndefined()
  expect(syncStorageContext(isolatedWorkspaceLayout(id(1), [], 1), layout.projects)).toBeUndefined()
  expect(() => parseSyncStorageRow(['sync-state', 'a'], state())).toThrow()
  expect(() => parseSyncStorageRow(['sync-state', 'a'], state(), { generation: id(9) })).toThrow()
})
it.each([['sync-state'], ['sync-state', 'a', 'extra'], ['sync-operation', 'a', 'bad'], ['sync-state', ''], ['sync-state', null]])('rejects malformed key %s', (...key) => {
  expect(() => parseSyncStorageKey(key)).toThrow()
})
it('never invokes accessors or accepts extraneous metadata', () => {
  const getter = vi.fn(() => 'a'), key = ['sync-state', 'a']
  Object.defineProperty(key, '1', { get: getter, enumerable: true })
  expect(() => parseSyncStorageKey(key)).toThrow(); expect(getter).not.toHaveBeenCalled()
  expect(() => parseSyncStorageRow(['sync-state', 'a'], { ...state(), extra: undefined }, { generation: id(1) })).toThrow()
})
it.each(['A===', '====', 'AB==', 'AAB=', 'AAA\n', 'AAA', 'AA=A', 'AA-_'])('rejects noncanonical base64 %s', value => {
  expect(() => syncBase64Size(value, 1, 100)).toThrow()
})
it('checks encoded/decoded budgets before decoding; keeps canonical padding', () => {
  expect(syncBase64Size('AA==', 1, 1)).toBe(1); expect(syncBase64Size('AAA=', 2, 2)).toBe(2)
  expect(() => syncBase64Size('AAAA', 1, 2)).toThrow('limit')
  expect(() => syncBase64Size('AAAA'.repeat(100), 1, 1)).toThrow('limit')
})
it('individual orphan ownership is not permission to replay or provision fresh', () => {
  expect(parseSyncStorageRow(['sync-operation', 'a', reference.operationId], operation(), { generation: id(1) }).owner).toBe('a')
  expect(() => assertSyncPair(null, operation())).toThrow('missing')
  expect(() => assertSyncPair(state(), null)).toThrow('missing')
  expect(() => assertSyncPair(state(), { ...operation(), enrollmentId: id(9) })).toThrow('integrity')
  expect(() => assertSyncPair(state(), { ...operation(), reference: { ...reference, sha256: 'b'.repeat(64) } })).toThrow('integrity')
  expect(() => parseSyncStorageRow(['sync-state', 'a-b'], state(), { generation: id(1) })).toThrow('scope')
})
it('admits the received-history state barrier without promoting operation grammar', () => {
  const v2 = { ...state(), version: 2 }
  expect(parseSyncStorageRow(['sync-state', 'a'], v2, { generation: id(1) })).toEqual(v2)
  expect(() => parseSyncStorageRow(['sync-operation', 'a', reference.operationId], { ...operation(), version: 2 }, { generation: id(1) })).toThrow()
  expect(() => parseSyncStorageRow(['sync-state', 'a'], { ...state(), version: 3 }, { generation: id(1) })).toThrow()
})
it('retains unresolved identities without importing records and forbids reassignment/removal', () => {
  const b = binding(), parsed = parseSyncPrivateState(privateState([b]))
  assertSyncPrivateHead(parsed, parsed.base)
  assertSyncMappingExtension([b], [{ ...b, presence: 'record' }])
  expect(() => assertSyncMappingExtension([b], [{ ...b, localId: 'other' }])).toThrow()
  expect(() => assertSyncMappingExtension([b], [{ ...b, logicalId: id(9) }])).toThrow()
  expect(() => assertSyncMappingExtension([b], [])).toThrow()
  expect(() => parseSyncPrivateState(privateState([b, b]))).toThrow()
})

it('real private-state AEAD is fresh and binds every public field, including exact pending ciphertext reference', async () => {
  const session = createSyncVaultSession(), code = 'ARTYSYNC1-00112233-44556677-8899AABB-CCDDEEFF-00112233-44556677-8899AABB-CCDDEEFF'
  const guard = { signal: new AbortController().signal, assertCurrent() {}, async validateReadOnly() {} }
  const key = await session.unlock(code, { vaultId: id(3), epoch: id(4) }, guard), binding = syncStateBinding(state())
  const text = JSON.stringify(privateState()), cipher = await sealSyncLocalState(key, binding, new Blob([text]))
  expect(await sealSyncLocalState(key, binding, new Blob([text]))).not.toBe(cipher)
  expect(await (await openSyncLocalState(key, binding, cipher)).plaintext.text()).toBe(text)
  for (const field of ['owner', 'generation', 'enrollmentId', 'revision'] as const) {
    await expect(openSyncLocalState(key, { ...binding, [field]: field === 'owner' ? 'a-b' : field === 'revision' ? 2 : id(9) }, cipher)).rejects.toThrow('integrity')
  }
  for (const pending of [null, { ...reference, sha256: 'b'.repeat(64) }, { ...reference, bytes: 131 }, { ...reference, operationId: id(9) }]) {
    await expect(openSyncLocalState(key, { ...binding, pending }, cipher)).rejects.toThrow('integrity')
  }
  const opened = await openSyncLocalState(key, binding, cipher); session.lock()
  expect(() => opened.plaintext).toThrow('locked')
})
