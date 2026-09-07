import { expect, it, vi } from 'vitest'
import { parseSyncPublication, parseSyncOperationStatus, parseSyncHeadSnapshot, parseSyncChainPage, SYNC_TRANSPORT_LIMITS } from '../../services/workspaceSync/transportFormat'
import { parseSyncPrivateState } from '../../services/workspaceSync/privateState'
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const scope = { vaultId: id(1), epoch: id(2) }
const reference = (n: number) => ({ format: 'arty-sync-envelope-ref', version: 1, ...scope, operationId: id(n + 10), bytes: 256, sha256: 'a'.repeat(64) })
const publication = (n: number) => ({ protocol: 1, status: 'published', reference: reference(n), sequence: n, head: id(n + 10), previousHead: n === 1 ? null : id(n + 9) })
const base = { format: 'arty-sync-causal', version: 1, ...scope, records: [] }
const state = () => ({ format: 'arty-sync-private-state', version: 2, base, bindings: [],
  admission: { kind: 'create', challenge: { protocol: 1, ...scope, enrollmentId: id(3), generation: id(4) } }, checkpoint: null,
  selection: { conversationIds: [] as string[], projectIds: [] as string[] } })

it('closed operation status and head grammars bind genesis, sequence and independent reference', () => {
  expect(parseSyncPublication(publication(1))).toEqual(publication(1))
  expect(parseSyncOperationStatus({ protocol: 1, status: 'reserved', reference: reference(1), expectedHead: null })).toMatchObject({ status: 'reserved' })
  for (const invalid of [{ ...publication(1), sequence: 2 }, { ...publication(2), previousHead: null }, { ...publication(1), head: id(7) }, { ...publication(1), extra: true }]) expect(() => parseSyncPublication(invalid)).toThrow()
  expect(() => parseSyncOperationStatus({ protocol: 1, status: 'uploaded', reference: reference(1), expectedHead: id(11) })).toThrow()
  expect(parseSyncHeadSnapshot({ protocol: 1, ...scope, sequence: 0, head: null })).toMatchObject({ head: null })
  expect(() => parseSyncHeadSnapshot({ protocol: 1, ...scope, sequence: 1, head: null })).toThrow()
})

it('32-entry page stays below the response bound; holes, links, foreign scopes, extras and getters refuse', () => {
  const entries = Array.from({ length: 32 }, (_, i) => publication(i + 1)), page = { protocol: 1, ...scope, head: id(42), after: 0, entries, next: null }
  expect(parseSyncChainPage(page).entries).toHaveLength(32)
  const size = new TextEncoder().encode(JSON.stringify(page)).length
  expect(size).toBeGreaterThan(SYNC_TRANSPORT_LIMITS.jsonBytes); expect(size).toBeLessThan(SYNC_TRANSPORT_LIMITS.responseBytes)
  for (const invalid of [
    { ...page, entries: entries.slice(0, 31) }, { ...page, next: 31 }, { ...page, after: 1 },
    { ...page, entries: [...entries, publication(33)] },
    { ...page, entries: entries.map((p, i) => i === 3 ? { ...p, previousHead: id(100) } : p) },
    { ...page, entries: entries.map((p, i) => i === 3 ? { ...p, reference: { ...p.reference, epoch: id(100) } } : p) },
  ]) expect(() => parseSyncChainPage(invalid)).toThrow()
  const getter = vi.fn(() => publication(1)), accessed = [...entries]
  Object.defineProperty(accessed, '0', { enumerable: true, get: getter })
  expect(() => parseSyncChainPage({ ...page, entries: accessed })).toThrow(); expect(getter).not.toHaveBeenCalled()
  const sparse = [...entries]; delete sparse[2]
  expect(() => parseSyncChainPage({ ...page, entries: sparse })).toThrow()
})

it('private v1 remains closed while v2 explicitly binds admission, checkpoint and copied selection', () => {
  expect(parseSyncPrivateState({ format: 'arty-sync-private-state', version: 1, base, bindings: [] }).version).toBe(1)
  const input = state(), parsed = parseSyncPrivateState(input)
  expect(parsed.version).toBe(2); input.selection.conversationIds.push('caller-mutation')
  expect(parsed).toMatchObject({ selection: { conversationIds: [] } })
  for (const invalid of [
    { ...state(), version: 1 }, { ...state(), unexpected: true },
    { ...state(), admission: { kind: 'join', generation: id(4) } },
    { ...state(), checkpoint: { ...publication(1), reference: { ...reference(1), epoch: id(100) } } },
    { ...state(), admission: { kind: 'create', challenge: { ...state().admission.challenge, vaultId: id(100) } } },
  ]) expect(() => parseSyncPrivateState(invalid)).toThrow()
  const getter = vi.fn(() => 2), accessed = state(); Object.defineProperty(accessed, 'version', { enumerable: true, get: getter })
  expect(() => parseSyncPrivateState(accessed)).toThrow(); expect(getter).not.toHaveBeenCalled()
})
