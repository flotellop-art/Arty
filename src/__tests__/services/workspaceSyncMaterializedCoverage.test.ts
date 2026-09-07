import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { seedIsolatedWorkspace, isolatedControl, GENERATION } from '../helpers/isolatedWorkspace'
import { deferred } from '../helpers/workspaceLocks'
import { isolatedWorkspaceLayout, workspaceDataKey } from '../../services/workspaceWriter/layout'
import type { Conversation } from '../../types'
import type { Project, ProjectDocument } from '../../services/projects/types'
import type { SyncCaptureSelection } from '../../services/workspaceSync/capture'
import type { SyncDispatchGuard } from '../../services/workspaceSync/clientTransport'

vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true, WORKSPACE_RESTORE_START_ENABLED: true, WORKSPACE_UPGRADE_START_ENABLED: false }))
vi.mock('../../services/workspaceSync/activation', () => ({ WORKSPACE_SYNC_APPLY_START_ENABLED: false }))
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const layout = isolatedWorkspaceLayout(GENERATION, [], 2), projectId = id(50), docId = id(51)
const empty = { format: 'arty-sync-causal', version: 1, vaultId: id(1), epoch: id(2), records: [] }
let runtime: typeof import('../../services/workspaceWriter/runtime'), lock: ReturnType<typeof deferred>
let coverage: typeof import('../../services/workspaceSync/materializedCoverage'), capture: typeof import('../../services/workspaceSync/capture')
let history: typeof import('../../services/storage'), crypt: typeof import('../../services/crypto')
let authority: SyncDispatchGuard, active: boolean
const conv = (name = 'chat'): Conversation => ({ id: name, title: '\uFEFFHistorical\r\n\uD800', createdAt: 1, updatedAt: 2,
  euOnly: true, outputRestriction: 'client-reply-draft-v1', messages: [
    { id: 'q', role: 'user', content: 'Question', timestamp: 1 },
    { id: 'r', role: 'assistant', content: 'Answer', timestamp: 2, pinned: true, restoredArchive: true,
      localSyncProvenance: { version: 1, historicalInjected: true } },
  ] })
async function save(c: Conversation) {
  history.saveConversation(c)
  await vi.waitFor(() => expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'conversations'))).toBeNull())
}
async function baseline(selection: SyncCaptureSelection = { conversationIds: ['chat'], projectIds: [] }) {
  return capture.captureLocalSyncSnapshot(empty, [], selection)
}
type Baseline = Awaited<ReturnType<typeof baseline>>
function logical(b: Baseline, kind: string, localId?: string) { return b.bindings.find(v => v.kind === kind && (localId === undefined ? v.presence === 'record' : v.localId === localId))!.logicalId }
function inspect(b: Baseline, targetIds = b.next.records.map(r => r.id)) {
  return coverage.attestMaterializedTargets({ materialized: b.next, bindings: b.bindings, targetIds, authority })
}
async function file(name = 'file', content = 'hello') {
  const db = await openDB(layout.files.name, 1)
  try { await db.put('files', { fileId: name, ownerKey: 'arty-a', name: 'a.txt', mimeType: 'text/plain', size: content.length,
    createdAt: 1, encryptedData: await crypt.encrypt(btoa(content)) }) } finally { db.close() }
}
async function projectFixture(text = '\uFEFFText\r\n\uD800'): Promise<Project> {
  const source = 'source'
  const hash = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(source))), v => v.toString(16).padStart(2, '0')).join('')
  const descriptor: ProjectDocument = { id: docId, name: 'Source', originalName: 'a.txt', format: 'txt', revision: 1, sourceHash: hash,
    sourceBytes: source.length, textChars: text.length, extractorVersion: 'arty-project-text-v1', createdAt: 1 }
  const project: Project = { schema: 1, owner: 'a', id: projectId, revision: 47, name: 'Project', instructions: 'Exact', euOnly: true,
    documents: [descriptor], createdAt: 1, updatedAt: 2 }
  const db = await openDB(layout.projects.name, 2)
  try {
    await db.put('projects', { key: ['a', projectId], owner: 'a', id: projectId, revision: 47, state: 'live', euOnly: true, createdAt: 1,
      updatedAt: 2, cipher: await crypt.encrypt(JSON.stringify(project)) })
    for (const kind of ['source', 'text'] as const) await db.put('documents', { key: ['a', projectId, docId, kind], owner: 'a', projectId, id: docId,
      kind, state: 'live', sourceBytes: source.length, textChars: text.length, updatedAt: 2,
      cipher: await crypt.encrypt(JSON.stringify({ schema: 1, owner: 'a', projectId, kind, descriptor, content: kind === 'source' ? btoa(source) : text })) })
    await db.put('usage', { owner: 'a', projects: 1, documents: 1, sourceBytes: source.length })
  } finally { db.close() }
  return project
}
async function editRow(store: 'files' | 'projects' | 'documents' | 'meta', key: IDBValidKey, edit: (v: any) => any) {
  const db = await openDB(store === 'files' ? layout.files.name : layout.projects.name, store === 'files' ? 1 : 2)
  try {
    const value = edit(await db.get(store, key))
    if (store === 'meta') await db.put(store, value, key)
    else if (value === undefined) await db.delete(store, key)
    else await db.put(store, value)
  } finally { db.close() }
}
async function snapshot() {
  const stores = []
  for (const [name, version, names] of [[layout.files.name, 1, ['files']], [layout.projects.name, 2, ['projects', 'documents', 'usage', 'meta']],
    ['arty-workspace-control', 1, ['meta']]] as const) {
    const db = await openDB(name, version)
    try { for (const store of names) stores.push([name, store, await db.getAllKeys(store), await db.getAll(store)]) } finally { db.close() }
  }
  return { stores, local: Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]) }
}
beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules(); localStorage.clear(); sessionStorage.clear(); globalThis.indexedDB = new IDBFactory()
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden') }))
  lock = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request(_n: unknown, _o: unknown, cb: (v: unknown) => Promise<void>) { void cb({}); return lock.promise } } })
  runtime = await import('../../services/workspaceWriter/runtime'); await runtime.documentWorkspace.acquire()
  await seedIsolatedWorkspace()
  const db = await openDB(layout.projects.name, 2); db.close()
  const control = await openDB('arty-workspace-control', 1)
  await control.put('meta', { ...isolatedControl(), projectsVersion: 2 }, 'workspace'); control.close()
  expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  const users = await import('../../services/userSession')
  users.setActiveSession({ userId: 'a', authMethod: 'apikey', displayName: 'Synthetic', createdAt: 1 })
  crypt = await import('../../services/crypto'); await crypt.initCrypto('coverage-test-key')
  const proofDB = await openDB(layout.projects.name, 2); await proofDB.put('meta', { exact: 'private-pair-test' }, 'test-pair'); proofDB.close()
  history = await import('../../services/storage'); await history.bootstrapConversationStorage()
  coverage = await import('../../services/workspaceSync/materializedCoverage'); capture = await import('../../services/workspaceSync/capture')
  active = true
  authority = { assertCurrent() { if (!active) throw new Error('authority-retired') }, async validateReadOnly() {
    this.assertCurrent()
    const db = await openDB(layout.projects.name, 2)
    try { if (JSON.stringify(await db.get('meta', 'test-pair')) !== JSON.stringify({ exact: 'private-pair-test' })) throw new Error('pair-changed') }
    finally { db.close() }
    this.assertCurrent()
  } }
})
afterEach(async () => {
  if (runtime.documentWorkspace.getSnapshot() === 'held') { lock.resolve(); await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true)) }
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('attests a real encrypted local branch without writes, UUIDs, encryption, network or selection authority', async () => {
  await save(conv()); const b = await baseline(), before = await snapshot()
  const random = vi.spyOn(webcrypto, 'randomUUID'), encrypt = vi.spyOn(webcrypto.subtle, 'encrypt')
  const proof = await inspect(b)
  expect(proof.report).toEqual({ requested: 1, inspected: 1, equal: 1, different: 0, missing: 0, unreadable: 0, notInspected: 0,
    missingDependencies: 0, remoteClosureChecked: false, writeAuthorized: false })
  expect(proof.status(logical(b, 'conversation'))).toBe('equal'); proof.assertEqual(); await proof.validateFresh()
  expect(await snapshot()).toEqual(before); expect(random).not.toHaveBeenCalled(); expect(encrypt).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  expect(Object.isFrozen(proof.report)).toBe(true); proof.dispose(); expect(() => proof.assertEqual()).toThrow()
})
it.each(['new-message', 'title', 'pin', 'restriction'])('reports valid local %s edits as different, never missing', async mode => {
  await save(conv()); const b = await baseline(), c = structuredClone(history.getConversation('chat')!)
  if (mode === 'new-message') c.messages.push({ id: 'new', role: 'user', content: 'Local addition', timestamp: 3 })
  if (mode === 'title') c.title = 'Renamed'
  if (mode === 'pin') c.messages[1]!.pinned = false
  if (mode === 'restriction') c.euOnly = false
  await save(c); const proof = await inspect(b)
  expect(proof.report).toMatchObject({ different: 1, equal: 0, missing: 0, unreadable: 0 }); expect(() => proof.assertEqual()).toThrow()
})
it('does not infer a global equality from an empty or partial target set', async () => {
  await save(conv()); await save(conv('neighbour')); const b = await baseline({ conversationIds: ['chat', 'neighbour'], projectIds: [] })
  const none = await inspect(b, []); expect(none.report).toMatchObject({ inspected: 0, notInspected: 2 }); expect(() => none.assertEqual()).toThrow()
  const one = await inspect(b, [logical(b, 'conversation', 'chat')]); expect(one.report).toMatchObject({ equal: 1, notInspected: 1 })
  expect(one.status(logical(b, 'conversation', 'neighbour'))).toBe('not-inspected')
})
it('closes only strong file edges; comparison, project/crop references and raw URIs never trigger physical reads', async () => {
  const c = conv(); c.projectId = 'weak-project'
  c.messages[1]!.content = 'arty-image://unlisted-raw-uri'
  c.messages[1]!.files = [{ id: 'file', name: 'a.txt', type: 'text/plain', visionCrop: { kind: 'auto', sourceFileId: 'weak-file', sourceFileIds: ['weak-file'], rect: { x: 0, y: 0, width: 1, height: 1 } } }]
  c.comparison = { version: 1, groupId: 'group', sourceConversationId: 'weak-original', sourceMessageId: 'old-q', peerId: 'weak-peer',
    questionId: 'q', responseId: 'r', provider: 'mistral', requestedModel: 'model', status: 'done' }
  await file(); await save(c); const b = await baseline(), proof = await inspect(b, [logical(b, 'conversation')])
  expect(proof.report).toMatchObject({ requested: 1, inspected: 2, equal: 2, missing: 0, missingDependencies: 0 }); proof.assertEqual()
})
it('reports an unreferenced materialized file directly, including its exact absence', async () => {
  const c = conv(); c.messages[0]!.files = [{ id: 'file', name: 'a.txt', type: 'text/plain' }]
  await file(); await save(c); const b = await baseline(), fileId = logical(b, 'file')
  // The current conversation no longer references the file. Targeting M's file
  // must not depend on any scan of selected/live conversation attachments.
  await save(conv()); const present = await inspect(b, [fileId]); expect(present.status(fileId)).toBe('equal')
  await editRow('files', 'file', () => undefined)
  const absent = await inspect(b, [fileId]); expect(absent.status(fileId)).toBe('missing')
})
it.each(['absent', 'foreign-owner', 'invalid-cipher', 'changed'])('blocks a %s strong attachment without substituting another file', async mode => {
  const c = conv(); c.messages[0]!.files = [{ id: 'file', name: 'a.txt', type: 'text/plain' }]
  await file(); await save(c); const b = await baseline()
  if (mode === 'changed') await file('file', 'changed')
  else await editRow('files', 'file', v => mode === 'absent' ? undefined : { ...v, ...(mode === 'foreign-owner' ? { ownerKey: 'arty-b' } : { encryptedData: 'invalid' }) })
  const proof = await inspect(b, [logical(b, 'conversation')])
  expect(proof.report.equal).toBe(1); expect(() => proof.assertEqual()).toThrow()
  expect(proof.status(logical(b, 'file'))).toBe(mode === 'absent' ? 'missing' : mode === 'changed' ? 'different' : 'unreadable')
})
it('attests catalogue, source and text as distinct logical records for the same physical document', async () => {
  await projectFixture(); const b = await baseline({ conversationIds: [], projectIds: [projectId] })
  expect(logical(b, 'project-source')).not.toBe(logical(b, 'project-text'))
  const proof = await inspect(b, [logical(b, 'project')]); expect(proof.report).toMatchObject({ requested: 1, inspected: 3, equal: 3 }); proof.assertEqual()
})
it('does not call a missing text row an empty valid extracted string', async () => {
  await projectFixture(); const b = await baseline({ conversationIds: [], projectIds: [projectId] })
  await editRow('documents', ['a', projectId, docId, 'text'], () => undefined)
  const proof = await inspect(b, [logical(b, 'project')])
  expect(proof.report).toMatchObject({ equal: 2, missing: 1 }); expect(proof.status(logical(b, 'project-text'))).toBe('missing')
})
it('keeps a present empty extracted string and a present zero-byte file equal', async () => {
  await projectFixture(''); await file('file', '')
  const c = conv(); c.messages[0]!.files = [{ id: 'file', name: 'a.txt', type: 'text/plain' }]; await save(c)
  const b = await baseline({ conversationIds: ['chat'], projectIds: [projectId] }), proof = await inspect(b)
  expect(proof.report).toMatchObject({ equal: 5, different: 0, missing: 0, unreadable: 0 }); proof.assertEqual()
})
it('keeps an already changed, durable non-target neighbour outside the target equality', async () => {
  await save(conv()); await save(conv('neighbour'))
  const b = await baseline({ conversationIds: ['chat', 'neighbour'], projectIds: [] })
  await save({ ...conv('neighbour'), title: 'New durable neighbour' })
  const proof = await inspect(b, [logical(b, 'conversation', 'chat')])
  expect(proof.report).toMatchObject({ equal: 1, notInspected: 1 }); proof.assertEqual()
  history.getConversation('neighbour')!.messages[0]!.content = 'Changed again'
  await expect(proof.validateFresh()).rejects.toThrow()
})
it('does not inspect a weak project/peer even when those records really are materialized and modified', async () => {
  await projectFixture()
  const c = conv(); c.projectId = projectId
  c.comparison = { version: 1, groupId: 'group', sourceConversationId: 'original', sourceMessageId: 'old-q', peerId: 'peer',
    questionId: 'q', responseId: 'r', provider: 'mistral', requestedModel: 'model', status: 'done' }
  await save(c); await save(conv('peer'))
  const b = await baseline({ conversationIds: ['chat', 'peer'], projectIds: [projectId] })
  await save({ ...conv('peer'), title: 'Changed peer' })
  await editRow('projects', ['a', projectId], () => undefined)
  const proof = await inspect(b, [logical(b, 'conversation', 'chat')])
  expect(proof.report).toMatchObject({ inspected: 1, equal: 1, notInspected: 4, missing: 0, missingDependencies: 0 }); proof.assertEqual()
})
it('keeps a missing M strong dependency explicit rather than granting equality from a local file alone', async () => {
  const c = conv(); c.messages[0]!.files = [{ id: 'file', name: 'a.txt', type: 'text/plain' }]
  await file(); await save(c); const b = await baseline(), fileId = logical(b, 'file')
  // Valid reduced identity domain, but deliberately incomplete strong closure.
  b.next.records = b.next.records.filter(r => r.id !== fileId)
  b.bindings.find(v => v.logicalId === fileId)!.presence = 'reference'
  const proof = await inspect(b)
  expect(proof.report).toMatchObject({ equal: 1, inspected: 1, missingDependencies: 1 }); expect(() => proof.assertEqual()).toThrow()
})
it('reports a changed catalogue with old physical rows as different, not missing', async () => {
  const p = await projectFixture(), b = await baseline({ conversationIds: [], projectIds: [projectId] })
  const cipher = await crypt.encrypt(JSON.stringify({ ...p, documents: [], revision: 48 }))
  await editRow('projects', ['a', projectId], v => ({ ...v, revision: 48, cipher }))
  const proof = await inspect(b)
  expect(proof.report).toMatchObject({ different: 3, missing: 0, unreadable: 0 })
})
it('treats a new document identity in a valid catalogue as a local edit', async () => {
  const p = await projectFixture(), b = await baseline({ conversationIds: [], projectIds: [projectId] })
  const cipher = await crypt.encrypt(JSON.stringify({ ...p, documents: [...p.documents, { ...p.documents[0], id: id(52) }], revision: 48 }))
  await editRow('projects', ['a', projectId], v => ({ ...v, revision: 48, cipher }))
  const proof = await inspect(b, [logical(b, 'project')])
  expect(proof.report).toMatchObject({ different: 1, inspected: 1, missing: 0, unreadable: 0 })
})
it.each(['neighbour', 'provenance', 'undefined-member', 'fourth-slot', 'cipher', 'pair', 'root', 'erasing-undefined', 'fence-undefined'])('terminally invalidates the witness after %s changes', async mode => {
  await save(conv()); await save(conv('neighbour')); const b = await baseline(), proof = await inspect(b)
  if (mode === 'neighbour') history.getConversation('neighbour')!.title = 'In-memory edit'
  if (mode === 'provenance') history.getConversation('chat')!.messages[1]!.localSyncProvenance!.historicalInjected = undefined
  if (mode === 'undefined-member') (history.getConversation('chat')! as any).extra = undefined
  if (mode === 'fourth-slot') localStorage.setItem(workspaceDataKey(layout, 'a', 'conversations-enc-locked-2'), 'present')
  if (mode === 'cipher') localStorage.setItem(workspaceDataKey(layout, 'a', 'conversations-enc'), 'changed')
  if (mode === 'pair') await editRow('meta', 'test-pair', () => ({ exact: 'changed' }))
  if (mode === 'erasing-undefined') await editRow('meta', ['erasing', 'a'], () => undefined)
  if (mode === 'fence-undefined') await editRow('meta', 'erasure-fence', () => undefined)
  if (mode === 'root') { const db = await openDB('arty-workspace-control', 1); await db.put('meta', { ...isolatedControl(), projectsVersion: 2, revision: 2 }, 'workspace'); db.close() }
  await expect(proof.validateFresh()).rejects.toThrow(); expect(() => proof.assertCurrent()).toThrow(); await expect(proof.validateFresh()).rejects.toThrow()
})
it.each(['erasing-null', 'erasing-undefined', 'fence-undefined', 'extra-control-key'])('rejects initial %s before decrypting any target', async mode => {
  await save(conv()); const b = await baseline()
  if (mode === 'extra-control-key') { const db = await openDB('arty-workspace-control', 1); await db.put('meta', undefined, 'unexpected'); db.close() }
  else await editRow('meta', mode === 'fence-undefined' ? 'erasure-fence' : ['erasing', 'a'], () => mode === 'erasing-null' ? null : undefined)
  const decrypt = vi.spyOn(webcrypto.subtle, 'decrypt')
  await expect(inspect(b)).rejects.toThrow(); expect(decrypt).not.toHaveBeenCalled()
})
it('revalidates exact file ciphertext, not its semantic frame or a revision alone', async () => {
  const c = conv(); c.messages[0]!.files = [{ id: 'file', name: 'a.txt', type: 'text/plain' }]
  await file(); await save(c); const b = await baseline(), proof = await inspect(b)
  await file() // same plaintext, metadata, physical ID; new ciphertext
  await expect(proof.validateFresh()).rejects.toThrow(); expect(() => proof.assertEqual()).toThrow()
})
it('detects a pinned source changing during decryption, even when a generic later reader could see M', async () => {
  const c = conv(); c.messages[0]!.files = [{ id: 'file', name: 'a.txt', type: 'text/plain' }]
  await file(); await save(c); const b = await baseline()
  const pending = deferred(), original = crypt.decrypt
  let calls = 0
  vi.spyOn(crypt, 'decrypt').mockImplementation(async cipher => {
    const result = await original(cipher)
    if (++calls === 2) { await editRow('files', 'file', v => ({ ...v, name: 'Edited during decrypt' })); pending.resolve() }
    return result
  })
  await expect(inspect(b)).rejects.toThrow(); await pending.promise
})
it.each(['owner', 'crypto', 'grant', 'document'])('never downgrades %s retirement during a decrypt into a stable unreadable report', async mode => {
  await save(conv()); const b = await baseline(), original = crypt.decrypt
  vi.spyOn(crypt, 'decrypt').mockImplementationOnce(async cipher => {
    const result = await original(cipher)
    if (mode === 'owner') {
      const users = await import('../../services/userSession')
      users.setActiveSession({ userId: 'b', authMethod: 'apikey', displayName: 'B', createdAt: 2 })
    }
    if (mode === 'crypto') await crypt.initCrypto('coverage-test-key')
    if (mode === 'grant') active = false
    if (mode === 'document') runtime.documentWorkspace.retire()
    return result
  })
  await expect(inspect(b)).rejects.toThrow()
})
it.each(['absent-to-present', 'present-to-absent'])('pins the fence presence itself for %s transitions', async mode => {
  await save(conv()); const b = await baseline()
  if (mode === 'present-to-absent') await editRow('meta', 'erasure-fence', () => 'initial')
  const proof = await inspect(b)
  if (mode === 'absent-to-present') await editRow('meta', 'erasure-fence', () => 'initial')
  else { const db = await openDB(layout.projects.name, 2); await db.delete('meta', 'erasure-fence'); db.close() }
  await expect(proof.validateFresh()).rejects.toThrow(); expect(() => proof.assertEqual()).toThrow()
})
it.each(['generatedImages', 'unknown'])('does not JSON-normalize an existing undefined %s into an equal target', async field => {
  await save(conv()); const b = await baseline()
  ;(history.getConversation('chat')!.messages[1]! as any)[field] = undefined
  const before = await snapshot(), proof = await inspect(b)
  expect(proof.report).toMatchObject({ equal: 0, unreadable: 1 }); expect(() => proof.assertEqual()).toThrow()
  expect(await snapshot()).toEqual(before)
})
it.each(['getter', 'toJSON', 'restriction-downgrade'])('rejects a live-history %s without executing accessor code or repairing it', async mode => {
  await save(conv()); const b = await baseline(), live = history.getConversation('chat')!, called = vi.fn(() => 'anything')
  if (mode === 'getter') Object.defineProperty(live, 'title', { enumerable: true, get: called })
  if (mode === 'toJSON') (live as any).toJSON = called
  if (mode === 'restriction-downgrade') delete live.outputRestriction
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  await expect(inspect(b)).rejects.toThrow(); expect(called).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled()
})
it('checks the whole memory snapshot after the final asynchronous authority validation', async () => {
  await save(conv()); const b = await baseline(), proof = await inspect(b)
  const original = authority.validateReadOnly.bind(authority)
  vi.spyOn(authority, 'validateReadOnly').mockImplementationOnce(original).mockImplementationOnce(async () => {
    await original(); history.getConversation('chat')!.messages[0]!.content = 'Late mutation'
  })
  await expect(proof.validateFresh()).rejects.toThrow(); expect(() => proof.assertEqual()).toThrow()
})
it('refuses oversized target ciphertext before asking the crypto decoder to allocate plaintext', async () => {
  const c = conv(); c.messages[0]!.files = [{ id: 'file', name: 'a.txt', type: 'text/plain' }]
  await file(); await save(c); const b = await baseline()
  await editRow('files', 'file', row => ({ ...row, encryptedData: 'A'.repeat(24 * 1024 * 1024 + 1) }))
  const decrypt = vi.spyOn(crypt, 'decrypt')
  await expect(inspect(b)).rejects.toThrow('limit'); expect(decrypt).toHaveBeenCalledTimes(1) // history only
})
it('rejects a target-list accessor or malformed private mapping before decrypting anything', async () => {
  await save(conv()); const b = await baseline(), called = vi.fn(() => logical(b, 'conversation')), targets: string[] = ['placeholder']
  Object.defineProperty(targets, '0', { enumerable: true, get: called })
  const decrypt = vi.spyOn(crypt, 'decrypt')
  await expect(coverage.attestMaterializedTargets({ materialized: b.next, bindings: b.bindings, targetIds: targets, authority })).rejects.toThrow()
  b.bindings.find(v => v.presence === 'record')!.kind = 'file'
  await expect(inspect(b)).rejects.toThrow(); expect(called).not.toHaveBeenCalled(); expect(decrypt).not.toHaveBeenCalled()
})
