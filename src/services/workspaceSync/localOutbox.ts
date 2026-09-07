import type { IDBPTransaction } from 'idb'
import { captureLocalReadScope } from '../projects/store'
import { assertDocumentWorkspace, documentWorkspaceSignal, getDocumentStorageLayout, guardDocumentTransaction } from '../workspaceWriter/runtime'
import { openDeclaredDatabase } from '../workspaceWriter/declaredDatabase'
import { rawEncoding } from '../workspaceWriter/migrationInventory'
import { onLocalDataInvalidated } from '../localDataInvalidation'
import { beginConversationWork } from '../conversationWork'
import { beginLocalSyncWrite } from '../workspaceWriter/localSyncActivity'
import { inspectSyncInventory } from './localInventory'
import { assertSyncPair, parseSyncStorageRow, syncStorageContext, syncStateBinding, syncBytesToBase64, syncBase64ToBytes,
  type SyncStateRow, type SyncOperationRow } from './localFormat'
import { createSyncVaultSession, prepareSyncUpdate, resumeSyncUpdate, openSyncUpdate, openSyncLocalState, sealSyncLocalState,
  type UnlockedSyncVault } from './encryption'
import { envelopeFail as fail, envelopeScope, assertEnvelopeScope, SYNC_ENVELOPE_LIMITS } from './envelopeFormat'
import { parseSyncManifest } from './schema'
import { parseSyncPrivateState, assertSyncPrivateHead, assertSyncMappingExtension, type SyncLocalBinding, type SyncPrivateState } from './privateState'
import type { SyncManifest } from './types'
import type { SyncCaptureSelection, SyncCaptureReport } from './capture'
import { copySyncCaptureSelection } from './captureProjection'

type Pair = { state: SyncStateRow | null; operation: SyncOperationRow | null }
type Mode = 'readonly' | 'readwrite'
type Transaction<M extends Mode = Mode> = IDBPTransaction<unknown, ['meta'], M>
const equal = (a: Pair, b: Pair) => rawEncoding(a.state) === rawEncoding(b.state) && rawEncoding(a.operation) === rawEncoding(b.operation)

/** Internal, local-only service. No enrollment endpoint, background scanner,
 * ACK, remote deletion or UI activation. Scope input does not attest a server.
 * Owner/layout/fences are captured here, never supplied by a caller. */
export function createLocalSyncOutbox() {
  assertDocumentWorkspace()
  const layout = getDocumentStorageLayout(), lifetime = new AbortController()
  const scope = captureLocalReadScope(lifetime.signal)
  if (layout.kind !== 'isolated-v1' || layout.projects.version !== 2) return fail('scope')
  const context = { generation: layout.generation }, owner = scope.owner, stateKey = ['sync-state', owner]
  const session = createSyncVaultSession()
  let vault: UnlockedSyncVault | null = null, view: SyncPrivateState | null = null, expected: Pair | null = null
  let localHead: SyncManifest | null = null
  let unlockedGeneration = 0
  const lock = () => { unlockedGeneration++; session.lock(); vault = null; view = null; expected = null; localHead = null }
  const assert = () => {
    try {
      scope.assertCurrent(); assertDocumentWorkspace()
      if (lifetime.signal.aborted || documentWorkspaceSignal.aborted || layout !== getDocumentStorageLayout()) fail('cancelled')
    } catch (error) { lock(); throw error }
  }
  let unsubscribe = () => {}
  const close = () => { lifetime.abort(); lock(); unsubscribe(); documentWorkspaceSignal.removeEventListener('abort', close) }
  documentWorkspaceSignal.addEventListener('abort', close, { once: true })
  unsubscribe = onLocalDataInvalidated(() => { try { assert() } catch { close() } })
  async function transaction<M extends Mode, T>(mode: M, action: (tx: Transaction<M>) => Promise<T>): Promise<T> {
    assert()
    const db = await openDeclaredDatabase(layout.projects, () => {})
    try {
      assert()
      if (!syncStorageContext(layout, db)) return fail('scope')
      const tx = guardDocumentTransaction(db.transaction(['meta'] as ['meta'], mode))
      const abort = () => { try { tx.abort() } catch { /* completed */ } }
      lifetime.signal.addEventListener('abort', abort, { once: true }); void tx.done.catch(() => {})
      try {
        const [fenceKey, fence, erasing] = await Promise.all([tx.store.getKey('erasure-fence'), tx.store.get('erasure-fence'), tx.store.getKey(['erasing', owner])])
        assert()
        if (erasing !== undefined || (fenceKey === undefined ? 'initial' : fence) !== scope.fence) { close(); return fail('cancelled') }
        const result = await action(tx)
        assert(); await tx.done; assert(); return result
      } catch (error) { abort(); await tx.done.catch(() => {}); throw error }
      finally { lifetime.signal.removeEventListener('abort', abort) }
    } finally { db.close() }
  }
  const guard = { signal: lifetime.signal, assertCurrent: assert, validateReadOnly: () => transaction('readonly', async () => {}) }
  async function readPair<M extends Mode>(tx: Transaction<M>): Promise<Pair> {
    const pairs = await inspectSyncInventory(tx.store, context, assert)
    const identity = pairs.get(owner)
    if (!identity) return { state: null, operation: null }
    const state = parseSyncStorageRow(stateKey, await tx.store.get(stateKey), context) as SyncStateRow
    const operation = state.pending ? parseSyncStorageRow(['sync-operation', owner, state.pending.operationId],
      await tx.store.get(['sync-operation', owner, state.pending.operationId]), context) as SyncOperationRow : null
    assertSyncPair(state, operation); return { state, operation }
  }
  function authenticated() {
    assert()
    if (!vault || !view || !expected?.state) return fail('locked')
    return { key: vault, privateState: view, pair: expected, generation: unlockedGeneration }
  }
  function assertUnlocked(generation: number) { authenticated(); if (generation !== unlockedGeneration) fail('locked') }
  function assertAttempt(generation: number) { assert(); if (generation !== unlockedGeneration) fail('locked') }
  async function cas(before: Pair, after: Pair, generation: number) {
    assertAttempt(generation)
    const release = beginLocalSyncWrite(), finishWork = beginConversationWork('workspace-sync-adoption')
    try {
      await transaction('readwrite', async tx => {
        assertAttempt(generation)
        const current = await readPair(tx)
        // An uncertain commit can only recognize its own exact paired candidate.
        if (equal(current, after)) return
        if (!equal(current, before)) return fail('base')
        assertAttempt(generation)
        if (after.operation) await tx.store.add(after.operation, ['sync-operation', owner, after.operation.reference.operationId])
        await tx.store.put(after.state, stateKey)
        assertAttempt(generation)
      })
      assertAttempt(generation)
    } finally { finishWork(); release() }
  }
  const outbox = Object.freeze({ lock, close,
    /** Explicit new local enrollment requires a supplied scope. Existing rows
     * can ONLY be unlocked, never reset after a wrong code or incomplete pair. */
    async unlock(code: string, initialScope?: unknown) {
      lock(); assert()
      const generation = unlockedGeneration, before = await transaction('readonly', readPair)
      if (generation !== unlockedGeneration) return fail('locked')
      const bound = before.state ? { vaultId: before.state.vaultId, epoch: before.state.epoch } : envelopeScope(initialScope)
      if (before.state && initialScope !== undefined && JSON.stringify(envelopeScope(initialScope)) !== JSON.stringify(bound)) return fail('scope')
      try {
        const key = await session.unlock(code, bound, guard)
        if (generation !== unlockedGeneration) return fail('locked')
        if (before.state) {
          const opened = await openSyncLocalState(key, syncStateBinding(before.state), before.state.ciphertext)
          const bytes = new Uint8Array(await opened.plaintext.arrayBuffer())
          let parsed: SyncPrivateState
          try { parsed = parseSyncPrivateState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) }
          finally { bytes.fill(0) }
          assertEnvelopeScope(parsed.base, bound)
          const next = before.operation ? (await openSyncUpdate(key, before.operation.reference,
            new Blob([syncBase64ToBytes(before.operation.ciphertext, 130, SYNC_ENVELOPE_LIMITS.ciphertextBytes)]), parsed.base)).manifest : parsed.base
          assertSyncPrivateHead(parsed, next)
          if (!equal(before, await transaction('readonly', readPair)) || generation !== unlockedGeneration) return fail('base')
          await opened.validate()
          if (generation !== unlockedGeneration) return fail('locked')
          vault = key; view = parsed; expected = before; localHead = next
        } else {
          const parsed = parseSyncPrivateState({ format: 'arty-sync-private-state', version: 1,
            base: { format: 'arty-sync-causal', version: 1, ...bound, records: [] }, bindings: [] })
          const binding = { ...bound, owner, generation: layout.generation, enrollmentId: crypto.randomUUID(), revision: 1, pending: null }
          const row: SyncStateRow = { format: 'arty-sync-local-state', version: 1, ...binding,
            ciphertext: await sealSyncLocalState(key, binding, new Blob([JSON.stringify(parsed)])) }
          if (generation !== unlockedGeneration) return fail('locked')
          const after: Pair = { state: row, operation: null }
          await cas(before, after, generation); assertAttempt(generation)
          vault = key; view = parsed; expected = after; localHead = parsed.base
        }
        assertUnlocked(generation)
      } catch (error) { if (generation === unlockedGeneration) lock(); throw error }
    },
    get snapshot() {
      const current = authenticated()
      return { base: parseSyncManifest(current.privateState.base), localHead: parseSyncManifest(localHead), bindings: structuredClone(current.privateState.bindings), pending: current.pair.state!.pending }
    },
    /** Actual local capture into the existing paired CAS. A pending historical A
     * stays byte-identical while real chat data changes to B. No pretend ACK or
     * clearing A to make room: callers receive an explicit pending-changes state.
     * Cancellation retires this handle, including any in-flight IDB adoption. */
    async capture(selection: SyncCaptureSelection, signal?: AbortSignal): Promise<{ status: 'adopted' | 'unchanged' | 'pending-changes'; report: SyncCaptureReport }> {
      const { pair, generation, privateState } = authenticated()
      const selected = copySyncCaptureSelection(selection)
      if (signal?.aborted) return fail('cancelled')
      signal?.addEventListener('abort', close, { once: true })
      try {
        const { captureLocalSyncSnapshot } = await import('./capture')
        assertUnlocked(generation)
        const captured = await captureLocalSyncSnapshot(localHead, privateState.bindings, selected, signal)
        assertUnlocked(generation); await captured.validate(); assertUnlocked(generation)
        if (expected !== pair || !equal(pair, await transaction('readonly', readPair))) return fail('base')
        assertUnlocked(generation)
        if (!captured.changed) return { status: 'unchanged', report: captured.report }
        if (pair.operation) return { status: 'pending-changes', report: captured.report }
        const candidate = await outbox.prepareSnapshot(captured.next, captured.payloads, captured.bindings)
        await captured.validate(); assertUnlocked(generation)
        await candidate.adopt(); assertUnlocked(generation)
        return { status: 'adopted', report: captured.report }
      } finally { signal?.removeEventListener('abort', close) }
    },
    /** Historical snapshot adoption, not a claim that LS and two IDBs were
     * read atomically or are still current. The future capture/rescan adapter
     * must explicitly label that boundary. No caller Prepared object accepted.
     * While A is pending, chat can save B normally; B cannot overwrite A. */
    async prepareSnapshot(nextInput: unknown, payloads: ReadonlyMap<string, Blob>, bindingsInput: SyncLocalBinding[]) {
      const { key, privateState, pair: before, generation } = authenticated()
      if (before.operation || before.state!.revision === Number.MAX_SAFE_INTEGER) return fail('base')
      const next = parseSyncManifest(nextInput)
      const proposed = parseSyncPrivateState({ ...privateState, bindings: bindingsInput })
      assertSyncMappingExtension(privateState.bindings, proposed.bindings)
      assertSyncPrivateHead(proposed, next)
      const capture = { assertCurrent: () => assertUnlocked(generation), validate: guard.validateReadOnly }
      const packet = await prepareSyncUpdate(key, privateState.base, next, payloads, capture)
      const reference = packet.reference, binding = { ...syncStateBinding(before.state!), revision: before.state!.revision + 1, pending: reference }
      const ciphertext = syncBytesToBase64(new Uint8Array(await packet.ciphertext.arrayBuffer()), 130, SYNC_ENVELOPE_LIMITS.ciphertextBytes)
      const state: SyncStateRow = { format: 'arty-sync-local-state', version: 1, ...binding,
        ciphertext: await sealSyncLocalState(key, binding, new Blob([JSON.stringify(proposed)])) }
      const { pending: _pending, ...identity } = binding
      const operation: SyncOperationRow = { format: 'arty-sync-local-operation', version: 1, ...identity, reference, ciphertext }
      const after: Pair = { state, operation }
      assertSyncPair(state, operation); await packet.validate(); assertUnlocked(generation)
      return Object.freeze({ reference, async adopt() {
        assertUnlocked(generation); await cas(before, after, generation)
        assertUnlocked(generation)
        // Publish RAM only after successful atomic commit. Exact retry remains
        // possible if acknowledgement of this commit was lost.
        expected = after; view = proposed; localHead = next
      } })
    },
    async resume() {
      const { key, privateState, pair, generation } = authenticated()
      if (!pair.operation) return null
      if (!equal(pair, await transaction('readonly', readPair))) return fail('base')
      const resumed = await resumeSyncUpdate(key, pair.operation.reference,
        new Blob([syncBase64ToBytes(pair.operation.ciphertext, 130, SYNC_ENVELOPE_LIMITS.ciphertextBytes)]), privateState.base)
      assertUnlocked(generation); return resumed
    },
  })
  return outbox
}
