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
import { parseSyncManifest, recordHeads } from './schema'
import { parseSyncPrivateState, syncPrivateLocalHead, syncPrivatePendingBase, assertSyncMappingExtension, type SyncLocalBinding, type SyncPrivateState, type SyncPrivateStateV3 } from './privateState'
import { assertSyncManifestRetains, reconcileSyncManifests } from './causal'
import { createWorkspaceSyncTransport, SyncTransportError, type SyncDispatchGuard } from './clientTransport'
import { parseSyncPublication, type SyncDiscovery, type SyncPublication } from './transportFormat'
import type { SyncManifest } from './types'
import type { SyncCaptureSelection, SyncCaptureReport } from './capture'
import { copySyncCaptureSelection } from './captureProjection'
import { receiveSyncChain, type ReceivedSyncChain } from './reception'
import { reviewReceivedSyncContent, type ReviewedSyncContent } from './receivedContent'

type Pair = { state: SyncStateRow | null; operation: SyncOperationRow | null }
type Mode = 'readonly' | 'readwrite'
type Transaction<M extends Mode = Mode> = IDBPTransaction<unknown, ['meta'], M>
const equal = (a: Pair, b: Pair) => rawEncoding(a.state) === rawEncoding(b.state) && rawEncoding(a.operation) === rawEncoding(b.operation)

/** Local durability and its owned remote controller. No background scanner,
 * remote deletion or UI activation. Legacy scope input does not attest a server.
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
  let unlockedGeneration = 0, keyLifetime = new AbortController()
  const lock = () => { unlockedGeneration++; keyLifetime.abort(); keyLifetime = new AbortController(); session.lock(); vault = null; view = null; expected = null; localHead = null }
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
  async function transaction<M extends Mode, T>(mode: M, action: (tx: Transaction<M>) => Promise<T>, signals: readonly AbortSignal[] = []): Promise<T> {
    assert()
    const db = await openDeclaredDatabase(layout.projects, () => {})
    try {
      assert()
      if (!syncStorageContext(layout, db)) return fail('scope')
      const tx = guardDocumentTransaction(db.transaction(['meta'] as ['meta'], mode))
      const abort = () => { try { tx.abort() } catch { /* completed */ } }
      const lifetimes = new Set([lifetime.signal, ...signals])
      for (const signal of lifetimes) signal.addEventListener('abort', abort, { once: true })
      void tx.done.catch(() => {})
      try {
        if ([...lifetimes].some(signal => signal.aborted)) return fail('cancelled')
        const [fenceKey, fence, erasing] = await Promise.all([tx.store.getKey('erasure-fence'), tx.store.get('erasure-fence'), tx.store.getKey(['erasing', owner])])
        assert()
        if (erasing !== undefined || (fenceKey === undefined ? 'initial' : fence) !== scope.fence) { close(); return fail('cancelled') }
        const result = await action(tx)
        assert(); await tx.done; assert(); return result
      } catch (error) { abort(); await tx.done.catch(() => {}); throw error }
      finally { for (const signal of lifetimes) signal.removeEventListener('abort', abort) }
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
  async function cas(before: Pair, after: Pair, generation: number, authority?: SyncDispatchGuard) {
    assertAttempt(generation); authority?.assertCurrent(); assertSyncPair(after.state, after.operation)
    if (before.state?.version === 2 && after.state?.version !== 2) return fail('base')
    const release = beginLocalSyncWrite(), finishWork = beginConversationWork('workspace-sync-adoption')
    try {
      await transaction('readwrite', async tx => {
        assertAttempt(generation); authority?.assertCurrent()
        const current = await readPair(tx)
        if (current.state?.version === 2 && after.state?.version !== 2) return fail('base')
        // An uncertain commit can only recognize its own exact paired candidate.
        if (equal(current, after)) return
        if (!equal(current, before)) return fail('base')
        assertAttempt(generation)
        if (after.operation) {
          const key = ['sync-operation', owner, after.operation.reference.operationId]
          if (before.operation?.reference.operationId === after.operation.reference.operationId) await tx.store.put(after.operation, key)
          else await tx.store.add(after.operation, key)
        }
        await tx.store.put(after.state, stateKey)
        if (before.operation && before.operation.reference.operationId !== after.operation?.reference.operationId) {
          await tx.store.delete(['sync-operation', owner, before.operation.reference.operationId])
        }
        assertAttempt(generation); authority?.assertCurrent()
      }, [keyLifetime.signal, ...(authority?.signal ? [authority.signal] : [])])
      assertAttempt(generation); authority?.assertCurrent()
    } finally { finishWork(); release() }
  }
  async function persistSelection(selected: SyncCaptureSelection) {
    const { key, privateState, pair: before, generation } = authenticated()
    if (privateState.version === 1 || JSON.stringify(privateState.selection) === JSON.stringify(selected)) return
    if (before.state!.revision === Number.MAX_SAFE_INTEGER) return fail('limit')
    const proposed = parseSyncPrivateState({ ...privateState, selection: selected })
    const binding = { ...syncStateBinding(before.state!), revision: before.state!.revision + 1 }
    const state: SyncStateRow = { format: 'arty-sync-local-state', version: before.state!.version, ...binding,
      ciphertext: await sealSyncLocalState(key, binding, new Blob([JSON.stringify(proposed)])) }
    // Metadata revision must change in BOTH wrappers; ciphertext A is untouched.
    const after: Pair = { state, operation: before.operation ? { ...before.operation, revision: binding.revision } : null }
    await cas(before, after, generation); assertUnlocked(generation)
    expected = after; view = proposed
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
          const pendingHead = before.operation ? (await openSyncUpdate(key, before.operation.reference,
            new Blob([syncBase64ToBytes(before.operation.ciphertext, 130, SYNC_ENVELOPE_LIMITS.ciphertextBytes)]), syncPrivatePendingBase(parsed))).manifest : null
          const next = syncPrivateLocalHead(parsed, pendingHead)
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
      return { base: parseSyncManifest(current.privateState.base), localHead: parseSyncManifest(localHead), bindings: structuredClone(current.privateState.bindings), pending: current.pair.state!.pending,
        remote: current.privateState.version !== 1 ? { checkpoint: structuredClone(current.privateState.checkpoint), selection: copySyncCaptureSelection(current.privateState.selection) } : null }
    },
    /** Actual local capture into the existing paired CAS. A pending historical A
     * stays byte-identical while real chat data changes to B. No pretend ACK or
     * clearing A to make room: callers receive an explicit pending-changes state.
     * Cancellation retires this handle, including any in-flight IDB adoption. */
    async capture(selection: SyncCaptureSelection, signal?: AbortSignal): Promise<{ status: 'adopted' | 'unchanged' | 'pending-changes'; report: SyncCaptureReport }> {
      authenticated()
      const selected = copySyncCaptureSelection(selection)
      if (signal?.aborted) return fail('cancelled')
      signal?.addEventListener('abort', close, { once: true })
      try {
        await persistSelection(selected)
        const { pair, generation, privateState } = authenticated()
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
      if (privateState.version !== 1 && !privateState.checkpoint && (next.records.length || bindingsInput.length || payloads.size)) return fail('base')
      // Capture is based on what the device represented (M), not the newer
      // transport DAG (T). Joining on M preserves remote-only records and
      // concurrent descendants; it never silently rebases an edit onto T.
      const wireNext = privateState.version === 3 ? reconcileSyncManifests(privateState.materialized, privateState.base, next) : next
      const proposed = parseSyncPrivateState({ ...privateState, bindings: bindingsInput, ...(privateState.version === 3 ? {
        materialized: next, pendingBase: { base: privateState.base, checkpoint: privateState.checkpoint },
      } : {}) })
      assertSyncMappingExtension(privateState.bindings, proposed.bindings)
      syncPrivateLocalHead(proposed, wireNext)
      const capture = { assertCurrent: () => assertUnlocked(generation), validate: guard.validateReadOnly }
      const packet = await prepareSyncUpdate(key, privateState.base, wireNext, payloads, capture)
      const reference = packet.reference, binding = { ...syncStateBinding(before.state!), revision: before.state!.revision + 1, pending: reference }
      const ciphertext = syncBytesToBase64(new Uint8Array(await packet.ciphertext.arrayBuffer()), 130, SYNC_ENVELOPE_LIMITS.ciphertextBytes)
      const state: SyncStateRow = { format: 'arty-sync-local-state', version: before.state!.version, ...binding,
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
        new Blob([syncBase64ToBytes(pair.operation.ciphertext, 130, SYNC_ENVELOPE_LIMITS.ciphertextBytes)]), syncPrivatePendingBase(privateState))
      assertUnlocked(generation); return resumed
    },
    /** User-facing remote actor owns its grant and all network receipts. It
     * accepts choices/code only: no public ack(dto), join(scope), Prepared or
     * transport injection. v1 stays locally readable, never auto-authorized. */
    connect(signal?: AbortSignal) {
      assert()
      const wire = createWorkspaceSyncTransport(signal)
      if (wire.owner !== owner || wire.epoch !== scope.epoch || wire.fence !== scope.fence) { wire.close(); return fail('scope') }
      let observed: SyncDiscovery | null = null, busy = false, closed = false
      let received: ReceivedSyncChain | null = null
      let reviewed: ReviewedSyncContent | null = null
      let application: Awaited<ReturnType<typeof import('./applyPublication')['prepareFirstSyncApply']>> | null = null
      const assertActor = () => { assert(); wire.assertCurrent(); if (closed) fail('cancelled') }
      const actorGuard: SyncDispatchGuard = { signal: wire.signal, assertCurrent: assertActor,
        async validateReadOnly() { assertActor(); await guard.validateReadOnly(); await wire.validateReadOnly(); assertActor() } }
      const exclusive = async <T>(action: () => Promise<T>): Promise<T> => {
        assertActor(); if (busy) return fail('base'); busy = true
        try { return await action() } finally { busy = false }
      }
      const samePublication = (a: SyncPublication | null, b: SyncPublication) => a !== null && JSON.stringify(a) === JSON.stringify(b)
      function remoteCurrent() {
        assertActor(); const current = authenticated()
        if (current.privateState.version === 1) return fail('scope')
        return { ...current, privateState: current.privateState }
      }
      async function publishPending() {
        const initial = remoteCurrent(), before = initial.pair, state = initial.privateState, generation = initial.generation
        if (!before.operation) return { status: 'idle' as const, checkpoint: structuredClone(state.checkpoint) }
        const origin = state.version === 3 ? state.pendingBase ?? fail('missing') : state
        const reference = before.operation.reference, previous = origin.checkpoint?.head ?? null, sequence = (origin.checkpoint?.sequence ?? 0) + 1
        const expectedPublication = parseSyncPublication({ protocol: 1, status: 'published', reference, previousHead: previous, head: reference.operationId, sequence })
        const completedHere = (pair: Pair) => !!view && view.version !== 1 && samePublication(view.checkpoint, expectedPublication) && !!expected && equal(pair, expected)
        const pendingGuard: SyncDispatchGuard = { signal: keyLifetime.signal,
          assertCurrent() { assertActor(); assertUnlocked(generation) },
          async validateReadOnly() {
            this.assertCurrent(); const pair = await transaction('readonly', readPair); this.assertCurrent()
            if (!equal(pair, before) && !completedHere(pair)) return fail('base')
          } }
        await pendingGuard.validateReadOnly()
        const packet = await outbox.resume(); pendingGuard.assertCurrent()
        if (!packet || JSON.stringify(packet.reference) !== JSON.stringify(reference)) return fail('base')
        // Reopen the durable packet, not live stores which may already contain B.
        const opened = await openSyncUpdate(initial.key, reference, packet.ciphertext, origin.base)
        await opened.validate(); pendingGuard.assertCurrent()
        syncPrivateLocalHead(state, opened.manifest)
        if (!origin.checkpoint && (state.admission.kind !== 'create' || opened.manifest.records.length || state.bindings.length)) return fail('base')
        if (!origin.checkpoint && state.admission.kind === 'create') {
          const current = await wire.discover(pendingGuard); pendingGuard.assertCurrent()
          const challenge = state.admission.challenge
          if (current.status === 'none') await wire.enroll(challenge, pendingGuard)
          else {
            if (current.generation !== challenge.generation) return fail('scope')
            assertEnvelopeScope(current, challenge)
          }
        }
        // A local pending is NOT proof of server reservation. A lost reserve
        // response resumes by exact status, including while START is now OFF.
        let result = await wire.status(reference, previous, pendingGuard)
        if (result === null) result = await wire.reserve(reference, previous, pendingGuard)
        if (result.status === 'reserved') result = await wire.upload(reference, previous, packet.ciphertext, pendingGuard)
        if (result.status === 'uploaded') result = await wire.commit(reference, previous, pendingGuard)
        pendingGuard.assertCurrent()
        if (result.status === 'conflict') return { status: 'conflict' as const }
        if (result.status !== 'published' || !samePublication(result, expectedPublication)) throw new SyncTransportError('protocol')
        // This receipt is private to this actor and arose from its real HTTP
        // call tied to the exact durable pair. There is no public ACK entry.
        const current = remoteCurrent()
        if (samePublication(current.privateState.checkpoint, result) && current.pair.operation?.reference.operationId !== reference.operationId) {
          // A duplicate receipt may preserve pending B, but must not attest a
          // durable rollback to before-A merely because that pair was valid
          // when the HTTP request began. No repair/write on this no-op path.
          const durable = await transaction('readonly', readPair); pendingGuard.assertCurrent()
          if (!expected || !equal(current.pair, expected) || !equal(durable, current.pair)) return fail('base')
          return { status: 'already-acknowledged' as const, checkpoint: structuredClone(result) }
        }
        if (!equal(current.pair, before) || before.state!.revision === Number.MAX_SAFE_INTEGER) return fail('base')
        // A verified newer T may already contain A (future cold adoption).
        // Its exact ancestry must retain A; an old receipt never rolls T back.
        // A same-sequence checkpoint must match BOTH publication and manifest.
        let base = opened.manifest, checkpoint = result
        if (state.version === 3 && state.checkpoint && state.checkpoint.sequence >= result.sequence) {
          assertSyncManifestRetains(opened.manifest, state.base)
          if (state.checkpoint.sequence === result.sequence && (!samePublication(state.checkpoint, result) ||
            JSON.stringify(state.base) !== JSON.stringify(opened.manifest))) return fail('base')
          base = state.base; checkpoint = state.checkpoint
        }
        const proposed = parseSyncPrivateState({ ...state, base, checkpoint, ...(state.version === 3 ? { pendingBase: null } : {}) })
        const next = syncPrivateLocalHead(proposed, null)
        const binding = { ...syncStateBinding(before.state!), revision: before.state!.revision + 1, pending: null }
        const after: Pair = { state: { format: 'arty-sync-local-state', version: before.state!.version, ...binding,
          ciphertext: await sealSyncLocalState(initial.key, binding, new Blob([JSON.stringify(proposed)])) }, operation: null }
        await pendingGuard.validateReadOnly(); await opened.validate(); pendingGuard.assertCurrent()
        await cas(before, after, generation, pendingGuard); pendingGuard.assertCurrent()
        expected = after; view = proposed; localHead = next
        return { status: 'acknowledged' as const, checkpoint: structuredClone(result) }
      }
      async function adoptInitial(code: string, kind: 'create' | 'join') {
        if (typeof code !== 'string' || !observed || observed.status !== (kind === 'create' ? 'none' : 'active')) return fail('scope')
        const observation = structuredClone(observed)
        const existing = await transaction('readonly', readPair); assertActor()
        if (existing.state || existing.operation) {
          if (kind === 'join' && observation.status === 'active') return joinAbandonedGenesis(code, existing, observation)
          return fail('base')
        }
        lock(); const generation = unlockedGeneration, before = await transaction('readonly', readPair)
        assertActor(); assertAttempt(generation)
        if (before.state || before.operation) return fail('base')
        const keyGuard: SyncDispatchGuard = { signal: keyLifetime.signal,
          assertCurrent() { assertActor(); assertAttempt(generation) },
          async validateReadOnly() { this.assertCurrent(); await actorGuard.validateReadOnly(); this.assertCurrent() } }
        try {
          const admitted = kind === 'create' ? await wire.challenge(crypto.randomUUID(), keyGuard)
            : await wire.join(observation as Extract<SyncDiscovery, { status: 'active' }>, keyGuard)
          keyGuard.assertCurrent()
          const bound = envelopeScope({ vaultId: admitted.vaultId, epoch: admitted.epoch })
          const base = parseSyncManifest({ format: 'arty-sync-causal', version: 1, ...bound, records: [] })
          const key = await session.unlock(code, bound, { ...keyGuard, signal: keyLifetime.signal }); code = ''; keyGuard.assertCurrent()
          let privateState: SyncPrivateStateV3, packet: Awaited<ReturnType<typeof prepareSyncUpdate>> | null = null
          if (kind === 'create' && 'enrollmentId' in admitted) {
            // Quota/cut here cannot leave an enrolled remote vault without its
            // recoverable genesis. Enrollment happens only in publishPending.
            packet = await prepareSyncUpdate(key, base, base, new Map(), { assertCurrent: keyGuard.assertCurrent, validate: keyGuard.validateReadOnly.bind(keyGuard) })
            privateState = parseSyncPrivateState({ format: 'arty-sync-private-state', version: 3, base, bindings: [], materialized: base, pendingBase: { base, checkpoint: null },
              admission: { kind: 'create', challenge: admitted }, checkpoint: null, selection: { conversationIds: [], projectIds: [] } }) as SyncPrivateStateV3
          } else if (kind === 'join' && 'head' in admitted) {
            if (admitted.head === null || admitted.sequence < 1) return fail('missing')
            const anchor = { protocol: 1 as const, ...bound, head: admitted.head, sequence: admitted.sequence }
            const first = (await wire.chain(anchor, 0, keyGuard)).entries[0]
            if (!first || first.sequence !== 1 || first.previousHead !== null) return fail('integrity')
            const ciphertext = await wire.object(first.reference, keyGuard)
            const opened = await openSyncUpdate(key, first.reference, ciphertext, base)
            await opened.validate(); keyGuard.assertCurrent()
            if (opened.manifest.records.length || opened.payloadIds.length) return fail('integrity')
            // No empty row is sealed until the code opens the real genesis.
            privateState = parseSyncPrivateState({ format: 'arty-sync-private-state', version: 3, base, bindings: [], materialized: base, pendingBase: null,
              admission: { kind: 'join', generation: admitted.generation }, checkpoint: first, selection: { conversationIds: [], projectIds: [] } }) as SyncPrivateStateV3
            const fresh = await wire.head(bound, keyGuard)
            if (fresh.sequence < first.sequence || fresh.sequence === first.sequence && fresh.head !== first.head) return fail('integrity')
          } else return fail('scope')
          const binding = { ...bound, owner, generation: context.generation, enrollmentId: crypto.randomUUID(), revision: 1, pending: packet?.reference ?? null }
          const state: SyncStateRow = { format: 'arty-sync-local-state', version: 1, ...binding,
            ciphertext: await sealSyncLocalState(key, binding, new Blob([JSON.stringify(privateState)])) }
          const { pending: _pending, ...identity } = binding
          const operation: SyncOperationRow | null = packet ? { format: 'arty-sync-local-operation', version: 1, ...identity,
            reference: packet.reference, ciphertext: syncBytesToBase64(new Uint8Array(await packet.ciphertext.arrayBuffer()), 130, SYNC_ENVELOPE_LIMITS.ciphertextBytes) } : null
          const after: Pair = { state, operation }
          await keyGuard.validateReadOnly(); keyGuard.assertCurrent(); await cas(before, after, generation, keyGuard)
          keyGuard.assertCurrent(); vault = key; view = privateState; expected = after; localHead = base
          return kind === 'create' ? publishPending() : { status: 'key-confirmed' as const, checkpoint: structuredClone(privateState.checkpoint) }
        } catch (error) { if (generation === unlockedGeneration) lock(); throw error }
      }
      async function joinAbandonedGenesis(code: string, before: Pair, observation: Extract<SyncDiscovery, { status: 'active' }>) {
        // Two profiles can race after seeing `none`. Replacing the loser's
        // initialization is allowed only with proof from its OLD unlocked key,
        // then proof of the winner's key. A new code alone cannot authorize a
        // reset. No v1, selected data, published base, or user stores are erased.
        const initial = remoteCurrent(), old = initial.privateState, generation = initial.generation
        if (!equal(before, initial.pair) || !before.operation || old.checkpoint || old.admission.kind !== 'create' ||
          old.base.records.length || old.bindings.length || old.version === 3 && (old.materialized.records.length || !old.pendingBase || old.pendingBase.checkpoint) ||
          old.selection.conversationIds.length || old.selection.projectIds.length ||
          old.admission.challenge.generation !== observation.generation ||
          old.base.vaultId === observation.vaultId || before.state!.revision === Number.MAX_SAFE_INTEGER) return fail('base')
        const proofGuard: SyncDispatchGuard & { signal: AbortSignal } = { signal: keyLifetime.signal,
          assertCurrent() { assertActor(); assertUnlocked(generation) },
          async validateReadOnly() {
            this.assertCurrent(); const durable = await transaction('readonly', readPair); this.assertCurrent()
            if (!equal(durable, before) || !expected || !equal(expected, before)) return fail('base')
          } }
        await proofGuard.validateReadOnly()
        const previous = await outbox.resume(); proofGuard.assertCurrent()
        if (!previous || JSON.stringify(previous.reference) !== JSON.stringify(before.operation.reference)) return fail('base')
        const oldGenesis = await openSyncUpdate(initial.key, previous.reference, previous.ciphertext, syncPrivatePendingBase(old))
        await oldGenesis.validate(); proofGuard.assertCurrent()
        if (oldGenesis.manifest.records.length || oldGenesis.payloadIds.length) return fail('base')
        const admitted = await wire.join(observation, proofGuard)
        if (admitted.head === null || admitted.sequence < 1) return fail('missing')
        const temporary = createSyncVaultSession()
        try {
          const bound = envelopeScope({ vaultId: admitted.vaultId, epoch: admitted.epoch })
          const base = parseSyncManifest({ format: 'arty-sync-causal', version: 1, ...bound, records: [] })
          const key = await temporary.unlock(code, bound, proofGuard); code = ''; proofGuard.assertCurrent()
          const first = (await wire.chain({ protocol: 1, ...bound, head: admitted.head, sequence: admitted.sequence }, 0, proofGuard)).entries[0]
          if (!first || first.sequence !== 1 || first.previousHead !== null) return fail('integrity')
          const packet = await wire.object(first.reference, proofGuard), genesis = await openSyncUpdate(key, first.reference, packet, base)
          await genesis.validate(); proofGuard.assertCurrent()
          if (genesis.manifest.records.length || genesis.payloadIds.length) return fail('integrity')
          const fresh = await wire.head(bound, proofGuard)
          if (fresh.sequence < first.sequence || fresh.sequence === first.sequence && fresh.head !== first.head) return fail('integrity')
          const proposed = parseSyncPrivateState({ format: 'arty-sync-private-state', version: 3, base, bindings: [], materialized: base, pendingBase: null,
            admission: { kind: 'join', generation: admitted.generation }, checkpoint: first, selection: { conversationIds: [], projectIds: [] } })
          const binding = { ...bound, owner, generation: context.generation, enrollmentId: crypto.randomUUID(), revision: before.state!.revision + 1, pending: null }
          const after: Pair = { state: { format: 'arty-sync-local-state', version: before.state!.version, ...binding,
            ciphertext: await sealSyncLocalState(key, binding, new Blob([JSON.stringify(proposed)])) }, operation: null }
          await proofGuard.validateReadOnly(); await cas(before, after, generation, proofGuard); proofGuard.assertCurrent()
          // A new unlock explicitly binds the winning key to a new lifetime;
          // neither the old nor temporary key leaks into another incarnation.
          lock(); return { status: 'joined-locked' as const, checkpoint: structuredClone(first) }
        } finally { temporary.lock() }
      }
      return Object.freeze({
        close() { closed = true; application?.dispose(); application = null; reviewed?.dispose(); reviewed = null; received?.dispose(); received = null; wire.close() },
        inspect() { return exclusive(async () => { observed = await wire.discover(actorGuard); assertActor(); return structuredClone(observed) }) },
        create(code: string) { return exclusive(() => adoptInitial(code, 'create')) },
        join(code: string) { return exclusive(() => adoptInitial(code, 'join')) },
        unlockOrJoin(code: string) { return exclusive(async () => {
          const pair = await transaction('readonly', readPair)
          if (!pair.state) return adoptInitial(code, 'join')
          await outbox.unlock(code); assertActor(); return { status: 'unlocked' as const }
        }) },
        resume(code?: string) { return exclusive(async () => { if (code !== undefined) { if (typeof code !== 'string') return fail('format'); await outbox.unlock(code) }; assertActor(); return publishPending() }) },
        /** Inspection is GET-only. In particular, resume() is NOT an inspector:
         * it can reserve, upload and publish an unknown pending operation. */
        pendingStatus() { return exclusive(async () => {
          const current = remoteCurrent(), before = current.pair, generation = current.generation
          const authority: SyncDispatchGuard = { signal: keyLifetime.signal,
            assertCurrent() {
              assertActor(); assertUnlocked(generation)
              if (!expected || !equal(expected, before)) return fail('base')
            },
            async validateReadOnly() {
              this.assertCurrent()
              if (!equal(await transaction('readonly', readPair), before)) return fail('base')
              this.assertCurrent()
            } }
          await authority.validateReadOnly()
          if (!before.operation) return null
          const state = current.privateState, origin = state.version === 3 ? state.pendingBase ?? fail('missing') : state
          const status = await wire.status(before.operation.reference, origin.checkpoint?.head ?? null, authority)
          await authority.validateReadOnly(); return status === null ? { status: 'unknown' as const } : structuredClone(status)
        }) },
        /** Explicit transport supersession, NOT conflict resolution or apply.
         * Only a terminal server conflict for the exact durable A authorizes a
         * replacement. Keep every causal variant and immutable A body missing
         * from R; never recapture newer live B or change M/bindings/selection. */
        reconcilePending() { return exclusive(async () => {
          const current = remoteCurrent(), before = current.pair, generation = current.generation, state = current.privateState, receipt = received
          if (state.version !== 3 || !before.operation || !state.pendingBase?.checkpoint || !state.checkpoint || !receipt) return fail('base')
          if (before.state!.revision === Number.MAX_SAFE_INTEGER) return fail('limit')
          const origin = state.pendingBase, reference = before.operation.reference, previous = origin.checkpoint!.head
          const authority: SyncDispatchGuard = { signal: receipt.signal,
            assertCurrent() {
              assertActor(); assertUnlocked(generation); receipt.assertCurrent()
              if (received !== receipt || !expected || !equal(expected, before)) return fail('base')
            },
            async validateReadOnly() { this.assertCurrent(); await receipt.validate(); this.assertCurrent() } }
          const terminalConflict = async () => {
            const status = await wire.status(reference, previous, authority)
            authority.assertCurrent()
            if (status?.status !== 'conflict') return fail('base')
          }
          await authority.validateReadOnly(); await terminalConflict()
          const remote = receipt.manifest, anchor = receipt.publication
          // A receipt still at A's predecessor cannot repair this conflict.
          // A later remote advance is safe: a subsequent explicit send can
          // conflict again, requiring another receive and reconciliation.
          if (anchor.head === previous) return fail('base')
          const pending = await outbox.resume(); authority.assertCurrent()
          if (!pending || JSON.stringify(pending.reference) !== JSON.stringify(reference)) return fail('base')
          const opened = await openSyncUpdate(current.key, reference, pending.ciphertext, origin.base)
          await opened.validate(); authority.assertCurrent(); syncPrivateLocalHead(state, opened.manifest)
          const union = reconcileSyncManifests(origin.base, opened.manifest, remote)
          const remotePayloads = new Set(remote.records.flatMap(record => record.revisions.flatMap(revision =>
            revision.value.state === 'live' ? [revision.value.payloadId] : [])))
          const payloads = new Map(opened.payloadIds.filter(id => !remotePayloads.has(id)).map(id => [id, opened.payload(id)]))
          const packet = await prepareSyncUpdate(current.key, remote, union, payloads,
            { assertCurrent: authority.assertCurrent, validate: authority.validateReadOnly.bind(authority) })
          const proposed = parseSyncPrivateState({ ...state, base: remote, checkpoint: anchor, pendingBase: { base: remote, checkpoint: anchor } })
          const next = syncPrivateLocalHead(proposed, union)
          const binding = { ...syncStateBinding(before.state!), revision: before.state!.revision + 1, pending: packet.reference }
          const ciphertext = syncBytesToBase64(new Uint8Array(await packet.ciphertext.arrayBuffer()), 130, SYNC_ENVELOPE_LIMITS.ciphertextBytes)
          const { pending: _pending, ...identity } = binding
          const after: Pair = {
            state: { format: 'arty-sync-local-state', version: before.state!.version, ...binding,
              ciphertext: await sealSyncLocalState(current.key, binding, new Blob([JSON.stringify(proposed)])) },
            operation: { format: 'arty-sync-local-operation', version: 1, ...identity, reference: packet.reference, ciphertext },
          }
          // Detach while the old-pair capability is still valid. Neither a
          // packet getter nor the receipt may be read after adopting after.
          const report = { status: 'reconciled-pending' as const, reference: structuredClone(packet.reference), anchor: structuredClone(anchor),
            conflicts: union.records.filter(record => recordHeads(record).length > 1).length,
            historical: true as const, applied: false as const, localChanges: 'not-rescanned' as const }
          await opened.validate(); await packet.validate(); await authority.validateReadOnly(); await terminalConflict()
          await authority.validateReadOnly()
          try {
            await cas(before, after, generation, authority); authority.assertCurrent()
            expected = after; view = proposed; localHead = next
          } catch (error) {
            // Quota/abort keeps A; a lost local ACK may instead leave the exact
            // successor committed. Unlock/reload reads reality, never restores
            // A or generates another envelope based on an uncertain outcome.
            if (generation === unlockedGeneration) lock()
            throw error
          }
          application?.dispose(); application = null; reviewed?.dispose(); reviewed = null; received = null; receipt.dispose()
          return report
        }) },
        receive() { return exclusive(async () => {
          application?.dispose(); application = null
          reviewed?.dispose(); reviewed = null
          received?.dispose(); received = null
          const current = remoteCurrent(), before = current.pair, generation = current.generation, checkpoint = current.privateState.checkpoint
          if (!checkpoint) return fail('base')
          const receiptGuard: SyncDispatchGuard = { signal: keyLifetime.signal,
            assertCurrent() {
              assertActor(); assertUnlocked(generation)
              if (!expected || !equal(expected, before)) return fail('base')
            },
            async validateReadOnly() {
              this.assertCurrent(); const durable = await transaction('readonly', readPair); this.assertCurrent()
              if (!equal(durable, before)) return fail('base')
            } }
          const next = await receiveSyncChain(current.key, wire, checkpoint, current.privateState.base, receiptGuard)
          try { await next.validate(); received = next; return { ...next.report, localPending: before.operation !== null } }
          catch (error) { next.dispose(); throw error }
        }) },
        reception() { return exclusive(async () => {
          if (!received) return null
          try { await received.validate(); return { ...received.report, localPending: remoteCurrent().pair.operation !== null } }
          catch (error) { received.dispose(); received = null; throw error }
        }) },
        prepareReceived() { return exclusive(async () => {
          // Capture the private receipt before any await. A business-format
          // failure clears only its review, not the authenticated chain/A/B.
          const receipt = received
          if (!receipt) return fail('missing')
          try {
            await receipt.validate()
            if (!reviewed) reviewed = await reviewReceivedSyncContent(receipt)
            await reviewed.validate()
            return { ...reviewed.report, localPending: remoteCurrent().pair.operation !== null }
          } catch (error) { reviewed?.dispose(); reviewed = null; throw error }
        }) },
        prepareApply() { return exclusive(async () => {
          application?.dispose(); application = null
          const receipt = received, current = remoteCurrent(), before = current.pair, generation = current.generation
          // This first vertical is an import into an unmaterialized enrollment,
          // not a silent overwrite, pending supersession or conflict resolver.
          if (!receipt || current.privateState.version !== 3 || current.privateState.materialized.records.length ||
            current.privateState.bindings.length || current.privateState.pendingBase || before.operation || !current.privateState.checkpoint) return fail('base')
          await receipt.validate()
          if (!reviewed) reviewed = await reviewReceivedSyncContent(receipt)
          const review = reviewed
          const authority: SyncDispatchGuard = { signal: keyLifetime.signal,
            assertCurrent() {
              assertActor(); assertUnlocked(generation)
              if (received !== receipt || reviewed !== review || !expected || !equal(expected, before)) return fail('base')
              review.assertCurrent()
            },
            async validateReadOnly() {
              this.assertCurrent(); await review.validate()
              if (!equal(await transaction('readonly', readPair), before)) return fail('base')
              this.assertCurrent()
            } }
          const { prepareFirstSyncApply } = await import('./applyPublication'); authority.assertCurrent()
          application = await prepareFirstSyncApply({ receipt, reviewed: review, stateBefore: before.state!, authority,
            async sealState(materialized, bindings) {
              authority.assertCurrent()
              if (before.state!.revision === Number.MAX_SAFE_INTEGER) return fail('limit')
              const proposed = parseSyncPrivateState({ ...current.privateState, version: 3, base: receipt.manifest, checkpoint: receipt.publication,
                materialized, bindings, pendingBase: null })
              syncPrivateLocalHead(proposed, null)
              const binding = { ...syncStateBinding(before.state!), revision: before.state!.revision + 1, pending: null }
              const state: SyncStateRow = { format: 'arty-sync-local-state', version: 2, ...binding,
                ciphertext: await sealSyncLocalState(current.key, binding, new Blob([JSON.stringify(proposed)])) }
              authority.assertCurrent(); return state
            } })
          authority.assertCurrent(); return structuredClone(application.preview)
        }) },
        applyReceived() { return exclusive(async () => {
          const prepared = application
          if (!prepared) return fail('missing')
          application = null
          try { await prepared.commit(); return { status: 'reload-required' as const } }
          finally { prepared.dispose() }
        }) },
        synchronize(selectionInput: SyncCaptureSelection) {
          const selection = copySyncCaptureSelection(selectionInput)
          return exclusive(async () => {
            const generation = remoteCurrent().generation, keySignal = keyLifetime.signal, action = new AbortController()
            const abort = () => action.abort()
            for (const signal of [keySignal, wire.signal]) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }) }
            const actionGuard: SyncDispatchGuard = { signal: action.signal,
              assertCurrent() { assertActor(); assertUnlocked(generation); if (action.signal.aborted) fail('cancelled') },
              async validateReadOnly() { this.assertCurrent(); await actorGuard.validateReadOnly(); this.assertCurrent() } }
            try {
              const previous = await publishPending(); actionGuard.assertCurrent()
              if (previous.status === 'conflict') return { status: 'conflict' as const }
              const current = remoteCurrent(), checkpoint = current.privateState.checkpoint
              if (!checkpoint) return fail('base')
              const head = await wire.head(current.privateState.base, actionGuard); actionGuard.assertCurrent()
              if (head.head !== checkpoint.head || head.sequence !== checkpoint.sequence) return { status: 'remote-changes' as const }
              // A is now acknowledged; a streaming B may defer the rescan, but
              // cannot invalidate that committed ACK or overwrite B with A.
              let captured: Awaited<ReturnType<typeof outbox.capture>>
              try { captured = await outbox.capture(selection, action.signal) }
              catch (error) {
                actionGuard.assertCurrent(); if (error instanceof Error && error.message === 'backup_busy') return { status: 'rescan-deferred' as const, previous }
                throw error
              }
              actionGuard.assertCurrent()
              const publication = await publishPending(); actionGuard.assertCurrent()
              return { status: 'scanned' as const, previous, capture: captured, publication }
            } finally { keySignal.removeEventListener('abort', abort); wire.signal.removeEventListener('abort', abort); action.abort() }
          })
        },
      })
    },
  })
  return outbox
}
