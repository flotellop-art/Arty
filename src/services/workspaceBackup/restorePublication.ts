import type { Conversation, FileAttachment } from '../../types'
import { captureLocalReadScope } from '../projects/store'
import { validProject } from '../projects/types'
import { captureHistoryForRestore } from '../storage'
import { encrypt, decrypt } from '../crypto'
import { hasActiveConversationWork } from '../conversationWork'
import { isNative } from '../native/platform'
import { getDocumentStorageLayout, documentWorkspace, documentWorkspaceSignal } from '../workspaceWriter/runtime'
import { ISOLATED_WORKSPACE_ENABLED, WORKSPACE_RESTORE_START_ENABLED } from '../workspaceWriter/activation'
import { CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE } from '../workspaceWriter/schema'
import { WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY } from '../workspaceWriter/control'
import { parseRestoreReady, parseRestoreHeader, restoreJobKey, type RestoreHeader } from '../workspaceWriter/restoreProtocol'
import { digestRaw, digestText } from '../workspaceWriter/migrationInventory'
import { assertRestoreLocal, deriveRestoreUsage, openRestoreDatabases, proveRestoreSlots, restoreEqual, restoreFail, restoreLocalSnapshot,
  restoreStoreProof, restoreTransaction, validRestoreUsage, zeroRestoreUsage, parseRestorePayload, type RestorePayload } from '../workspaceWriter/restoreJournal'
import { prepareWorkspaceRestore } from './restorePlan'
import { decodeUTF8 } from './bytes'
import { RESTORE_ARCHIVE_BYTES, RESTORE_ADOPTION_BYTES } from './restoreLimits'

/** Warm target preparation. Neither archive data nor callers choose the owner,
 * generation, baseline, destination addresses, ciphertexts or commit header. */
export async function prepareRestorePublication(file: Blob, code: string, receipt: { title: string; text: string }, signal?: AbortSignal) {
  receipt = { title: receipt.title, text: receipt.text } // sever mutable caller input before await
  if (!ISOLATED_WORKSPACE_ENABLED || !WORKSPACE_RESTORE_START_ENABLED || isNative || !receipt.title.length || receipt.title.length > 120 || !receipt.text.length || receipt.text.length > 500) return restoreFail('unavailable')
  if (file.size > RESTORE_ARCHIVE_BYTES) return restoreFail('limit') // BEFORE archive read, KDF or target snapshot
  const scope = captureLocalReadScope(signal), history = captureHistoryForRestore(), layout = getDocumentStorageLayout()
  if (layout.kind !== 'isolated-v1' || scope.owner === 'anon') return restoreFail('unavailable')
  const capturedDocument = documentWorkspace
  let disposed = false, attempted = false
  const guard = { signal: documentWorkspaceSignal, assertCurrent() {
    if (!WORKSPACE_RESTORE_START_ENABLED) restoreFail('unavailable')
    if (disposed || signal?.aborted) restoreFail('cancelled')
    if (hasActiveConversationWork()) restoreFail('busy')
    scope.assertCurrent(); history.assertUnchanged()
  } }
  const local = restoreLocalSnapshot({ generation: layout.generation, owner: scope.owner })
  guard.assertCurrent()
  if (local.history[2] !== null || local.history[3] !== null) return restoreFail('unavailable')
  await scope.validateReadOnly(); guard.assertCurrent()
  const authoritative = local.history[0] ?? (local.history[1] === null ? '[]' : await decrypt(local.history[1]!))
  guard.assertCurrent()
  // JSON equality preserves every existing field while accepting harmless
  // whitespace/key ordering in the durable JSON representation.
  try { if (!restoreEqual(JSON.parse(authoritative), history.snapshot)) return restoreFail() } catch { return restoreFail() }
  const archive = await prepareWorkspaceRestore(file, code, guard)
  const openAll = async () => {
    const list = await openRestoreDatabases([
      { descriptor: { name: WORKSPACE_CONTROL_DB, version: 1 }, shape: CONTROL_SHAPE },
      { descriptor: layout.files, shape: FILE_SHAPE }, { descriptor: layout.projects, shape: PROJECT_SHAPE },
    ], guard)
    return [list[0]!, list[1]!, list[2]!] as const
  }
  try {
    const [control, files, projects] = await openAll()
    try {
      const base = await restoreTransaction(control, ['meta'], 'readonly', guard, async tx => {
        if (await tx.objectStore('meta').count() !== 1) return restoreFail()
        return parseRestoreReady(await tx.objectStore('meta').get(WORKSPACE_CONTROL_KEY)) ?? restoreFail()
      })
      if (base.generation !== layout.generation || !restoreEqual(base.requiredOwners, layout.requiredOwners)) return restoreFail()
      const plan = archive.plan, now = Date.now(), conversations = structuredClone(plan.conversations.map(c => c.conversation))
      const allNewIds = new Set(plan.mapping.ids.map(i => i.target))
      const fresh = () => { const id = crypto.randomUUID(); if (allNewIds.has(id)) return restoreFail(); allNewIds.add(id); return id }
      // A file with no display reference needs a durable, explicit receipt. No
      // generated request/action is sent; this is an inert historical message.
      const referenced = new Set(conversations.flatMap(c => c.messages.flatMap(m => m.role === 'user' ? (m.files ?? []).map(f => f.id) : m.generatedImages ?? [])))
      const orphanFiles = plan.files.filter(({ file: f }) => !referenced.has(f.id))
      if (orphanFiles.length) conversations.push({ id: fresh(), title: receipt.title, createdAt: now, updatedAt: now,
        messages: [{ id: fresh(), role: 'user', content: receipt.text, timestamp: now, restoredArchive: true,
          files: orphanFiles.map(({ file: { objectId: _object, recordedSize: _size, ...f } }) => f as FileAttachment) }] })
      // Include missing historical references too. A new ID must not resolve to
      // a pre-existing file/project/message by accident, regardless of owner.
      const assertIdsAbsent = async () => {
        const existingIds = new Set<string>()
        const inspectStrings = (value: unknown) => {
          const stack: unknown[] = [value]
          while (stack.length) {
            const next = stack.pop()
            if (typeof next === 'string') existingIds.add(next)
            else if (next && typeof next === 'object') stack.push(...Object.values(next))
          }
        }
        inspectStrings(history.snapshot)
        for (const [db, stores] of [[files, ['files']], [projects, ['projects', 'documents']]] as const) {
          await restoreTransaction(db, [...stores], 'readonly', guard, async tx => {
            for (const store of stores) {
              let cursor = await tx.objectStore(store).openCursor()
              while (cursor) {
                guard.assertCurrent(); inspectStrings(cursor.key)
                const row = cursor.value as Record<string, unknown>
                for (const key of ['id', 'fileId', 'projectId']) inspectStrings(row[key])
                cursor = await cursor.continue()
              }
            }
          })
        }
        if ([...allNewIds].some(id => existingIds.has(id))) return restoreFail()
      }
      await assertIdsAbsent()
      const usageBefore = await restoreTransaction(projects, ['projects', 'documents', 'usage'], 'readonly', guard, async tx => {
        const usage = await tx.objectStore('usage').get(scope.owner) as unknown
        const derived = await deriveRestoreUsage(tx, scope.owner)
        if (usage === undefined) { if (!restoreEqual(derived, zeroRestoreUsage(scope.owner))) return restoreFail(); return null }
        if (!validRestoreUsage(usage, scope.owner) || !restoreEqual(usage, derived)) return restoreFail()
        return usage
      })
      const before = usageBefore ?? zeroRestoreUsage(scope.owner)
      const usageAfter = { owner: scope.owner, projects: before.projects + plan.resources.projects, documents: before.documents + plan.resources.documents, sourceBytes: before.sourceBytes + plan.resources.sourceBytes }
      if (!validRestoreUsage(usageAfter, scope.owner)) return restoreFail('limit')
      const payload: RestorePayload = { version: 1, id: crypto.randomUUID(), generation: layout.generation, owner: scope.owner, fence: scope.fence,
        baseline: { localHash: await digestRaw(local.other), history: await proveRestoreSlots(local.history), stores: [] },
        files: [], projects: [], documents: [], usageBefore, usageAfter, historyCipher: null }
      // Reserve bounded row/control metadata too. Check BEFORE encrypting and
      // accumulating the next ciphertext, not only after stringify clones all.
      let cipherBytes = 0
      const checkCipherCapacity = (plainBytes: number) => {
        const encoded = 3 + 4 * Math.ceil((plainBytes + 12 + 16) / 3) // v1/v2 prefix, IV, GCM tag
        if (encoded > 24 * 1024 * 1024 || cipherBytes + encoded + 256 * 1024 > RESTORE_ADOPTION_BYTES) restoreFail('limit')
      }
      const encryptForJournal = async (text: string) => {
        checkCipherCapacity(new TextEncoder().encode(text).length)
        const result = await encrypt(text); guard.assertCurrent(); cipherBytes += result.length
        if (cipherBytes + 256 * 1024 > RESTORE_ADOPTION_BYTES) return restoreFail('limit')
        return result
      }
      const base64 = async (id: string) => {
        const bytes = new Uint8Array(await archive.object(id).arrayBuffer()); guard.assertCurrent()
        try { let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary) }
        finally { bytes.fill(0) }
      }
      for (const { file: f, recordedSize } of plan.files) {
        checkCipherCapacity(4 * Math.ceil(f.size / 3))
        const encryptedData = await encryptForJournal(await base64(f.objectId)); guard.assertCurrent()
        const { id, objectId: _object, recordedSize: _size, type, size: _actual, ...meta } = f
        payload.files.push({ ...meta, fileId: id, ownerKey: `arty-${scope.owner}`, mimeType: type, size: recordedSize, encryptedData, createdAt: now })
      }
      for (const { project: p } of plan.projects) {
        const documents = p.documents.map(({ sourceObjectId: _source, textObjectId: _text, ...d }) => d)
        const project = { ...p, owner: scope.owner, documents }
        if (!validProject(project)) return restoreFail('format')
        const cipher = await encryptForJournal(JSON.stringify(project)); guard.assertCurrent()
        payload.projects.push({ key: [scope.owner, p.id], owner: scope.owner, id: p.id, revision: p.revision, state: 'live', euOnly: p.euOnly, createdAt: p.createdAt, updatedAt: p.updatedAt, cipher })
        for (const d of p.documents) for (const kind of ['source', 'text'] as const) {
          const { sourceObjectId, textObjectId, ...descriptor } = d
          const content = kind === 'source' ? await base64(sourceObjectId) : decodeUTF8(new Uint8Array(await archive.object(textObjectId).arrayBuffer()))
          guard.assertCurrent()
          if (kind === 'text' && content.length !== descriptor.textChars) return restoreFail('format')
          const cipher = await encryptForJournal(JSON.stringify({ schema: 1, owner: scope.owner, projectId: p.id, kind, descriptor, content })); guard.assertCurrent()
          payload.documents.push({ key: [scope.owner, p.id, d.id, kind], owner: scope.owner, projectId: p.id, id: d.id, kind, state: 'live', sourceBytes: d.sourceBytes, textChars: d.textChars, updatedAt: p.updatedAt, cipher })
        }
      }
      const merged: Conversation[] = [...conversations, ...history.snapshot]
      if (conversations.length) payload.historyCipher = await encryptForJournal(JSON.stringify(merged))
      guard.assertCurrent()
      payload.baseline.stores = await restoreStoreProof(files, projects, payload, guard)
      // Encryption yielded to other ordinary warm writers. A freshly created
      // project must not become authority for an absent historical reference.
      await assertIdsAbsent()
      assertRestoreLocal(local, guard); history.assertSnapshot(); await scope.validateReadOnly(); guard.assertCurrent()
      let raw: string | undefined = JSON.stringify(payload)
      const bytes = new TextEncoder().encode(raw).length
      if (bytes > RESTORE_ADOPTION_BYTES) return restoreFail('limit')
      const header: RestoreHeader = { format: 'arty-workspace-control', version: 8, layout: 'isolated-v1', state: 'restoring', revision: base.revision + 1,
        generation: base.generation, requiredOwners: [...base.requiredOwners], base, restore: { id: payload.id, owner: scope.owner, phase: 'copies', bytes, hash: await digestText(raw) } }
      if (!parseRestoreHeader(header)) return restoreFail('format')
      await parseRestorePayload(raw, header, guard)
      const preview = Object.freeze({ ...plan.resources, addedConversations: conversations.length, addedMessages: conversations.reduce((n, c) => n + c.messages.length, 0),
        receiptFiles: orphanFiles.length, targetOwner: scope.owner, journalBytes: bytes, diagnostics: { ...plan.diagnostics } })
      return Object.freeze({ preview, dispose() { disposed = true; raw = undefined }, async commit() {
        if (attempted) return restoreFail('changed')
        guard.assertCurrent()
        attempted = true // bind the user's choice before any awaited preflight
        // Reopen under the same captured warm scope: preview connections close.
        const [control, files, projects] = await openAll()
        try {
          if (!restoreEqual(payload.baseline.stores, await restoreStoreProof(files, projects, payload, guard))) return restoreFail()
          await scope.validateReadOnly(); assertRestoreLocal(local, guard); history.assertSnapshot()
          try {
            await restoreTransaction(control, ['meta'], 'readwrite', guard, async tx => {
              const store = tx.objectStore('meta')
              if (await store.count() !== 1 || !restoreEqual(await store.get(WORKSPACE_CONTROL_KEY), base)) return restoreFail()
              assertRestoreLocal(local, guard); history.assertSnapshot()
              if (raw === undefined) return restoreFail('cancelled')
              await store.add(raw, restoreJobKey(payload.id))
              assertRestoreLocal(local, guard); history.assertSnapshot()
              await store.put(header, WORKSPACE_CONTROL_KEY)
            })
          } finally {
            // No private callback or second write between uncertain adoption
            // and irrevocable retirement of THIS document instance.
            raw = undefined; disposed = true; capturedDocument.retire()
          }
        } finally { control.close(); files.close(); projects.close() }
      } })
    } finally { control.close(); files.close(); projects.close() }
  } finally { archive.dispose() }
}
