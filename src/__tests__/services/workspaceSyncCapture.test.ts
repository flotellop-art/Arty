import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { seedIsolatedWorkspace, isolatedControl, GENERATION } from '../helpers/isolatedWorkspace'
import { deferred } from '../helpers/workspaceLocks'
import { isolatedWorkspaceLayout, workspaceDataKey } from '../../services/workspaceWriter/layout'
import type { Conversation } from '../../types'
import type { SyncManifest } from '../../services/workspaceSync/types'

vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true, WORKSPACE_RESTORE_START_ENABLED: true, WORKSPACE_UPGRADE_START_ENABLED: false }))
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const bound = { vaultId: id(1), epoch: id(2) }
const code = 'ARTYSYNC1-00112233-44556677-8899AABB-CCDDEEFF-00112233-44556677-8899AABB-CCDDEEFF'
const layout = isolatedWorkspaceLayout(GENERATION, [], 2)
const select = (conversationIds = ['chat'], projectIds: string[] = []) => ({ conversationIds, projectIds })
let runtime: typeof import('../../services/workspaceWriter/runtime'), lock: ReturnType<typeof deferred>
let service: typeof import('../../services/workspaceSync/localOutbox'), history: typeof import('../../services/storage')
let crypt: typeof import('../../services/crypto'), projects: typeof import('../../services/projects/store')
async function endDocument() {
  if (runtime?.documentWorkspace.getSnapshot() === 'held') { lock.resolve(); await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true)) }
}
async function newDocument() {
  await endDocument(); vi.resetModules(); lock = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request(_n: unknown, _o: unknown, cb: (v: unknown) => Promise<void>) { void cb({}); return lock.promise } } })
  runtime = await import('../../services/workspaceWriter/runtime')
  service = await import('../../services/workspaceSync/localOutbox')
  history = await import('../../services/storage'); crypt = await import('../../services/crypto'); projects = await import('../../services/projects/store')
  await runtime.documentWorkspace.acquire()
}
async function login(owner = 'a') {
  const users = await import('../../services/userSession')
  users.setActiveSession({ userId: owner, authMethod: 'apikey', displayName: 'Synthetic', createdAt: 1 }); await crypt.initCrypto('test-key-' + owner)
}
async function rows() {
  const db = await openDB(layout.projects.name, 2)
  try { return [await db.getAllKeys('meta'), await db.getAll('meta')] as const } finally { db.close() }
}
const conversation = (name = 'chat'): Conversation => ({ id: name, title: 'Historique 😀', createdAt: 1, updatedAt: 2,
  messages: [{ id: 'q', role: 'user', content: '\uFEFFQuestion\r\n', timestamp: 1 },
    { id: 'r', role: 'assistant', content: 'Exact\uD800', timestamp: 2, restoredArchive: true, interrupted: false, pinned: false,
      factCheck: { overallConfidence: 'low', claims: [], modelLabel: '', checkedAt: 0, originalContent: '', appliedCorrections: 0, status: 'success-empty' } }] })
async function save(c: Conversation) {
  history.saveConversation(c)
  await vi.waitFor(() => expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'conversations'))).toBeNull())
}
async function box() { const result = service.createLocalSyncOutbox(); await result.unlock(code, bound); return result }
async function content(b: Awaited<ReturnType<typeof box>>) {
  const codec = await import('../../services/workspaceSync/encryption'), session = codec.createSyncVaultSession()
  const key = await session.unlock(code, bound, { ...projects.captureLocalReadScope(), signal: new AbortController().signal })
  const packet = (await b.resume())!, opened = await codec.openSyncUpdate(key, packet.reference, packet.ciphertext, b.snapshot.base)
  const result: { kind: string; data: any; binary: Uint8Array; recordId: string }[] = []
  for (const record of opened.manifest.records) {
    const value = record.revisions.at(-1)!.value
    if (value.state !== 'live') throw new Error('expected live')
    const bytes = new Uint8Array(await opened.payload(value.payloadId).arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 9))).toBe('ARTYSOBJ1')
    const size = new DataView(bytes.buffer).getUint32(9), meta = JSON.parse(new TextDecoder().decode(bytes.slice(13, 13 + size)))
    result.push({ ...meta, binary: bytes.slice(13 + size), recordId: record.id })
  }
  return result
}
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); globalThis.indexedDB = new IDBFactory()
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden') }))
  await newDocument(); await seedIsolatedWorkspace()
  const db = await openDB(layout.projects.name, 2); db.close()
  const control = await openDB('arty-workspace-control', 1)
  await control.put('meta', { ...isolatedControl(), projectsVersion: 2 }, 'workspace'); control.close()
  expect(await runtime.workspaceAdmission.admit()).toBe('ready'); await login(); await history.bootstrapConversationStorage()
})
afterEach(async () => { await endDocument(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('captures two actual comparison branches, reboots and rescans unchanged without IDs/encryption or deleting unselected records', async () => {
  const a = conversation(), b = conversation('peer')
  for (const c of [a, b]) {
    c.comparison = { version: 1, groupId: 'group', sourceConversationId: 'unselected-original', sourceMessageId: 'source-q', peerId: c === a ? b.id : a.id,
      questionId: 'q', responseId: c === a ? 'r' : 'absent-r', provider: 'anthropic', requestedModel: 'model', status: 'done', error: '', binaryBytes: 0,
      metrics: { firstTokenMs: null, totalMs: null, inputTokens: 0, outputTokens: 0, costEur: null },
      attribution: { model: 'model', provider: 'claude', conversationId: c.id, confirmed: false, background: false } }
    c.outputRestriction = 'client-reply-draft-v1'; c.hasProjectContext = true; c.hasGoogleData = true; c.euOnly = false
    await save(c)
  }
  const outbox = await box()
  expect((await outbox.capture(select(['chat', 'peer']))).status).toBe('adopted')
  const data = (await content(outbox)).map(c => c.data.conversation), s = outbox.snapshot, adopted = await rows()
  expect(s.base.records).toEqual([]); expect(s.localHead.records).toHaveLength(2)
  const mapped = (localId: string, kind = 'conversation') => s.bindings.find(b => b.localId === localId && b.kind === kind)!.logicalId
  const actualA = data.find(c => c.id === mapped('chat'))
  expect(actualA.messages[1]).toMatchObject({ content: a.messages[1]!.content, restoredArchive: true, pinned: false, factCheck: a.messages[1]!.factCheck })
  expect(actualA).toMatchObject({ outputRestriction: a.outputRestriction, hasProjectContext: true, hasGoogleData: true, euOnly: false,
    comparison: { status: 'done', metrics: a.comparison!.metrics, peerId: mapped('peer'), sourceConversationId: mapped('unselected-original'), error: '', binaryBytes: 0 } })
  expect(s.bindings.find(b => b.localId === 'unselected-original')!.presence).toBe('reference')
  expect(s.bindings.find(b => b.localId === 'absent-r')!.presence).toBe('reference')
  expect(JSON.stringify(adopted)).not.toContain('unselected-original')
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready'); await login(); await history.bootstrapConversationStorage()
  const reopened = service.createLocalSyncOutbox(); await reopened.unlock(code)
  const random = vi.spyOn(webcrypto, 'randomUUID'), encrypt = vi.spyOn(webcrypto.subtle, 'encrypt')
  expect((await reopened.capture(select(['peer', 'chat']))).status).toBe('unchanged')
  expect((await reopened.capture(select(['chat']))).status).toBe('unchanged')
  expect(reopened.snapshot).toEqual(s); expect(await rows()).toEqual(adopted)
  expect(random).not.toHaveBeenCalled(); expect(encrypt).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  random.mockRestore(); encrypt.mockRestore()
  await save({ ...history.getConversation('chat')!, title: 'Local B' })
  expect((await reopened.capture(select())).status).toBe('pending-changes')
  expect(await rows()).toEqual(adopted); expect(reopened.snapshot).toEqual(s); expect(history.getConversation('chat')!.title).toBe('Local B')
})

async function bootPartial() {
  const c = conversation(); c.messages[1]!.id = 'streaming'
  const cipher = await crypt.encrypt(JSON.stringify([c]))
  localStorage.setItem(workspaceDataKey(layout, 'a', 'conversations-enc'), cipher)
  history.resetConversationMemCache(); await history.bootstrapConversationStorage()
  return { cipher, partial: history.getConversation('chat')!.messages[1]! }
}
it('persists a real boot-normalized streaming ID before capture, including spread-cloned aliases, across another document', async () => {
  const { partial } = await bootPartial(), c = history.getConversation('chat')!
  expect(partial.id).not.toBe('streaming'); c.messages[1] = { ...partial }
  const outbox = await box(); await outbox.capture(select()); const before = outbox.snapshot
  await vi.waitFor(() => expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'conversations'))).toBeNull())
  expect(JSON.parse(await crypt.decrypt(localStorage.getItem(workspaceDataKey(layout, 'a', 'conversations-enc'))!))[0].messages[1].id).toBe(partial.id)
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready'); await login(); await history.bootstrapConversationStorage()
  expect(history.getConversation('chat')!.messages[1]!.id).toBe(partial.id)
  const reopened = service.createLocalSyncOutbox(); await reopened.unlock(code)
  const uuid = vi.spyOn(webcrypto, 'randomUUID'), encrypt = vi.spyOn(webcrypto.subtle, 'encrypt')
  expect((await reopened.capture(select())).status).toBe('unchanged'); expect(reopened.snapshot).toEqual(before)
  expect(uuid).not.toHaveBeenCalled(); expect(encrypt).not.toHaveBeenCalled()
})
it('quota of streaming-ID stabilization leaves old ciphertext and RAM identity intact with no outbox adoption', async () => {
  const { cipher, partial } = await bootPartial(), outbox = await box(), before = await rows(), set = Storage.prototype.setItem
  const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
    if (key === workspaceDataKey(layout, 'a', 'conversations')) throw new DOMException('quota', 'QuotaExceededError')
    return set.call(this, key, value)
  })
  await expect(outbox.capture(select())).rejects.toMatchObject({ name: 'QuotaExceededError' })
  expect(await rows()).toEqual(before); expect(history.getConversation('chat')!.messages[1]!.id).toBe(partial.id)
  expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'conversations-enc'))).toBe(cipher)
  expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'conversations-enc-locked'))).toBeNull()
  quota.mockRestore(); expect((await outbox.capture(select())).status).toBe('adopted')
})

it('a successful plain-bootstrap encryption already stabilizes IDs and needs no redundant safety-net write under quota', async () => {
  const c = conversation(); c.messages[1]!.id = 'streaming'
  localStorage.setItem(workspaceDataKey(layout, 'a', 'conversations'), JSON.stringify([c]))
  history.resetConversationMemCache(); await history.bootstrapConversationStorage()
  const partial = history.getConversation('chat')!.messages[1]!.id, outbox = await box(), old = { ...localStorage }
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
  expect((await outbox.capture(select())).status).toBe('adopted')
  expect({ ...localStorage }).toEqual(old); expect(history.getConversation('chat')!.messages[1]!.id).toBe(partial)
})
it.each([false, true])('failed removal of old canonical plain cannot acknowledge an unstable ID (safety-net quota=%s)', async quota => {
  const c = conversation(); c.messages[1]!.id = 'streaming'
  const plainKey = workspaceDataKey(layout, 'a', 'conversations')
  localStorage.setItem(plainKey, JSON.stringify([c]))
  const remove = Storage.prototype.removeItem
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function(this: Storage, key) {
    if (key === plainKey) throw new DOMException('denied', 'SecurityError')
    return remove.call(this, key)
  })
  history.resetConversationMemCache(); await history.bootstrapConversationStorage()
  const normalized = history.getConversation('chat')!.messages[1]!.id, outbox = await box(), before = await rows()
  const set = Storage.prototype.setItem
  if (quota) vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
    if (key === plainKey) throw new DOMException('quota', 'QuotaExceededError')
    return set.call(this, key, value)
  })
  if (quota) { await expect(outbox.capture(select())).rejects.toThrow('quota'); expect(await rows()).toEqual(before) }
  else {
    expect((await outbox.capture(select())).status).toBe('adopted')
    expect(JSON.parse(localStorage.getItem(plainKey)!)[0].messages[1].id).toBe(normalized)
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready'); await login(); await history.bootstrapConversationStorage()
    expect(history.getConversation('chat')!.messages[1]!.id).toBe(normalized)
    const reopened = service.createLocalSyncOutbox(); await reopened.unlock(code)
    expect((await reopened.capture(select())).status).toBe('unchanged')
  }
})
it('a small selected partial can stabilize alongside a source history exceeding the per-payload node budget', async () => {
  const selected = conversation(); selected.messages[1]!.id = 'streaming'
  const neighbours = Array.from({ length: 7 }, (_, n) => ({ ...conversation(`neighbour-${n}`),
    messages: Array.from({ length: 2400 }, (_, i) => ({ id: String(i), role: 'user' as const, content: '', timestamp: 0 })) }))
  localStorage.setItem(workspaceDataKey(layout, 'a', 'conversations-enc'), await crypt.encrypt(JSON.stringify([selected, ...neighbours])))
  history.resetConversationMemCache(); await history.bootstrapConversationStorage()
  const outbox = await box(); expect((await outbox.capture(select())).status).toBe('adopted')
  expect(history.getConversations()).toHaveLength(8)
  expect(outbox.snapshot.localHead.records).toHaveLength(1)
})
it('freezes caller selection synchronously before its first await', async () => {
  await save(conversation()); await save(conversation('not-consented'))
  const outbox = await box(), selected = select(), pending = outbox.capture(selected)
  selected.conversationIds[0] = 'not-consented'
  expect((await pending).status).toBe('adopted')
  expect(outbox.snapshot.bindings.some(b => b.localId === 'not-consented')).toBe(false)
  expect(outbox.snapshot.bindings.some(b => b.localId === 'chat')).toBe(true)
})
it('captures a real durable empty non-image file as zero bytes, not absence', async () => {
  const files = await import('../../services/secureFileStorage'), encoded = 'data:text/plain;base64,'
  await files.putFile({ id: 'empty', name: 'empty.txt', type: 'text/plain', data: encoded })
  const c = conversation(); c.messages[0]!.files = [{ id: 'empty', name: 'empty.txt', type: 'text/plain', size: 0 }]; await save(c)
  const outbox = await box(); await outbox.capture(select())
  const file = (await content(outbox)).find(o => o.kind === 'file')!
  expect(file.binary.length).toBe(0); expect(file.data).toMatchObject({ size: 0, recordedSize: encoded.length })
})

it('keeps actual shared file bytes, three sizes, crops, gallery receipts and raw URI text distinct', async () => {
  const files = await import('../../services/secureFileStorage'), imageId = id(50), absent = id(51)
  await files.putFile({ id: 'f', name: 'stored.txt', type: 'text/plain', size: 7, data: 'QQ==' })
  await files.putFile({ id: imageId, name: 'image.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' })
  const c = conversation()
  c.messages[0]!.files = [{ id: 'f', name: 'first.txt', type: '', size: 999 }]
  c.messages[1]!.files = [{ id: 'f', name: 'second.txt', type: 'text/plain', size: 0,
    visionCrop: { kind: 'auto', sourceFileId: 'f', sourceFileIds: ['f', 'missing-crop-source'], rect: { x: 0, y: 0, width: 1, height: 1 } } }]
  c.messages[1]!.generatedImages = [imageId]
  c.messages[1]!.content = `![real](arty-img://${imageId})\nProse arty-img://${imageId}\n\`arty-img://${imageId}\`\n![untrusted](arty-img://${absent})`
  await save(c)
  const outbox = await box(); await outbox.capture(select())
  const objects = await content(outbox), f = objects.find(o => o.kind === 'file' && o.data.name === 'stored.txt')!, chat = objects.find(o => o.kind === 'conversation')!.data
  // The real writer historically records the encoded string length (4), not
  // its caller's size hint (7) or decoded byte count (1).
  expect([...f.binary]).toEqual([65]); expect(f.data).toMatchObject({ size: 1, recordedSize: 4 })
  expect(chat.conversation.messages[0].files[0]).toMatchObject({ id: f.recordId, name: 'first.txt', type: '', size: 999 })
  expect(chat.conversation.messages[1].files[0]).toMatchObject({ id: f.recordId, name: 'second.txt', size: 0, visionCrop: { sourceFileId: f.recordId } })
  expect(chat.conversation.messages[1].content).toBe(c.messages[1]!.content)
  expect(chat.galleryAliases[0]).toMatchObject({ textId: imageId, fileId: chat.conversation.messages[1].generatedImages[0] })
  expect(outbox.snapshot.bindings.some(b => b.localId === absent)).toBe(false)
  expect(outbox.snapshot.bindings.find(b => b.localId === 'missing-crop-source')!.presence).toBe('reference')
})

it.each([undefined, null, ['bad-id'], new Array(1)])('rejects a present malformed gallery %s without interpreting it as absent', async gallery => {
  await save(conversation()); const c = history.getConversation('chat')!
  Object.defineProperty(c.messages[1], 'generatedImages', { value: gallery, enumerable: true, configurable: true })
  const outbox = await box(), before = await rows()
  await expect(outbox.capture(select())).rejects.toThrow('format'); expect(await rows()).toEqual(before)
})
it('refuses getters and a stripped independent output restriction without invoking/repairing them', async () => {
  const c = { ...conversation(), outputRestriction: 'client-reply-draft-v1' as const, hasProjectContext: true }; await save(c)
  const alias = history.getConversation('chat')!, outbox = await box(), before = await rows()
  delete alias.outputRestriction
  await expect(outbox.capture(select())).rejects.toThrow('changed'); expect(await rows()).toEqual(before)
  alias.outputRestriction = 'client-reply-draft-v1'
  alias.hasProjectContext = false
  await expect(outbox.capture(select())).rejects.toThrow('format'); expect(await rows()).toEqual(before)
  alias.hasProjectContext = true
  const getter = vi.fn(() => 'evil'); Object.defineProperty(alias, 'title', { get: getter, enumerable: true })
  await expect(outbox.capture(select())).rejects.toThrow('format'); expect(getter).not.toHaveBeenCalled()
})
it('missing or foreign-owned direct file refuses the WHOLE capture, never filters a partial success', async () => {
  const c = conversation(); c.messages[0]!.files = [{ id: 'missing', name: '', type: '' }]; await save(c)
  const outbox = await box(), before = await rows()
  await expect(outbox.capture(select())).rejects.toThrow('missing'); expect(await rows()).toEqual(before)
  const files = await import('../../services/secureFileStorage'); await files.putFile({ id: 'missing', name: 'a', type: '', data: 'QQ==' })
  const db = await openDB(layout.files.name, 1), row = await db.get('files', 'missing')
  await db.put('files', { ...row, ownerKey: 'arty-other' }); db.close()
  await expect(outbox.capture(select())).rejects.toThrow('missing'); expect(await rows()).toEqual(before)
})

it.each(['', '\uFEFFA\r\n', '\uD800'])('captures actual project source and stored extracted text %j without re-extraction or owner/CAS leakage', async storedText => {
  const op = await projects.beginProjectOperation(), importer = await import('../../services/projects/documentImport')
  let project = await projects.createProject(op, 'P')
  project = await projects.addProjectDocument(op, project, await importer.prepareProjectDocument(op, new NodeFile(['Source\r\n'], 'original.txt') as unknown as File))
  // Historical storage fixture (the current importer rejects empty new text).
  // Re-encrypt full matching descriptors, row counters and payloads as an old
  // reader-valid document, not a mocked reader returning impossible metadata.
  project.documents[0]!.textChars = storedText.length
  const doc = project.documents[0]!, db = await openDB(layout.projects.name, 2), pkey = ['a', project.id]
  const prow = await db.get('projects', pkey); await db.put('projects', { ...prow, cipher: await crypt.encrypt(JSON.stringify(project)) })
  for (const kind of ['source', 'text']) {
    const key = ['a', project.id, doc.id, kind], row = await db.get('documents', key), payload = JSON.parse(await crypt.decrypt(row.cipher))
    payload.descriptor = doc; if (kind === 'text') payload.content = storedText
    await db.put('documents', { ...row, textChars: storedText.length, cipher: await crypt.encrypt(JSON.stringify(payload)) })
  }
  db.close()
  const c = conversation(); c.projectId = project.id; c.hasProjectContext = true
  c.messages[1]!.projectTurn = { version: 1, mode: 'search', euOnly: false, partial: false, projectId: project.id, projectRevision: project.revision,
    sources: [{ projectId: project.id, projectRevision: project.revision, documentId: doc.id, documentRevision: 1, sourceHash: doc.sourceHash,
      extractorVersion: doc.extractorVersion, name: doc.name, format: doc.format, startLine: 0, endLine: 0, partial: false }] }
  await save(c)
  const outbox = await box(); await outbox.capture(select(['chat'], [project.id]))
  const objects = await content(outbox), p = objects.find(o => o.kind === 'project')!, src = objects.find(o => o.kind === 'project-source')!, text = objects.find(o => o.kind === 'project-text')!, chat = objects.find(o => o.kind === 'conversation')!.data.conversation
  expect(new TextDecoder().decode(src.binary)).toBe('Source\r\n'); expect(text.data.text).toBe(storedText)
  expect(p.data).not.toHaveProperty('owner'); expect(p.data).not.toHaveProperty('revision')
  expect(p.data.documents[0]).toMatchObject({ id: src.recordId, sourceId: src.recordId, textId: text.recordId })
  expect(text.data).toMatchObject({ projectId: p.recordId, documentId: src.recordId })
  expect(chat.messages[1].projectTurn.sources[0]).toMatchObject({ projectId: p.recordId, documentId: src.recordId, projectRevision: project.revision })
  expect((await outbox.capture(select(['chat'], [project.id]))).status).toBe('unchanged')
})

it('refuses an extra field in an actual encrypted project descriptor before adopting anything', async () => {
  const op = await projects.beginProjectOperation(), importer = await import('../../services/projects/documentImport')
  let p = await projects.createProject(op, 'P')
  p = await projects.addProjectDocument(op, p, await importer.prepareProjectDocument(op, new NodeFile(['A'], 'a.txt') as unknown as File))
  Object.assign(p.documents[0]!, { futureAuthority: 'forbidden' })
  const db = await openDB(layout.projects.name, 2), row = await db.get('projects', ['a', p.id])
  await db.put('projects', { ...row, cipher: await crypt.encrypt(JSON.stringify(p)) }); db.close()
  const outbox = await box(), before = await rows()
  await expect(outbox.capture(select([], [p.id]))).rejects.toThrow('format'); expect(await rows()).toEqual(before)
})
it('keeps same physical document ID in two projects distinct and links each catalogue to its own source/text', async () => {
  const op = await projects.beginProjectOperation(), importer = await import('../../services/projects/documentImport')
  const originals = [await projects.createProject(op, 'One'), await projects.createProject(op, 'Two')], saved = []
  for (const p of originals) {
    const uuid = vi.spyOn(webcrypto, 'randomUUID').mockReturnValue(id(500))
    const prepared = await importer.prepareProjectDocument(op, new NodeFile(['Doc ' + p.name], 'a.txt') as unknown as File)
    uuid.mockRestore(); saved.push(await projects.addProjectDocument(op, p, prepared))
  }
  expect(saved[0]!.documents[0]!.id).toBe(saved[1]!.documents[0]!.id)
  const outbox = await box(); await outbox.capture(select([], saved.map(p => p.id)))
  const objects = await content(outbox), ps = objects.filter(o => o.kind === 'project')
  expect(ps[0]!.data.documents[0].id).not.toBe(ps[1]!.data.documents[0].id)
  for (const p of ps) {
    const doc = p.data.documents[0], src = objects.find(o => o.recordId === doc.sourceId)!, txt = objects.find(o => o.recordId === doc.textId)!
    expect(doc.id).toBe(src.recordId); expect(src.data.projectId).toBe(p.recordId); expect(txt.data.projectId).toBe(p.recordId)
    expect(txt.data.documentId).toBe(doc.id); expect(new TextDecoder().decode(src.binary)).toBe('Doc ' + p.data.name)
  }
})

it.each(['mutation', 'owner-aba', 'fence', 'abort'])('refuses %s during actual file decryption with no partial adoption', async event => {
  const files = await import('../../services/secureFileStorage'); await files.putFile({ id: 'f', name: 'f', type: '', data: 'QQ==' })
  const c = conversation(); c.messages[0]!.files = [{ id: 'f', name: 'f', type: '' }]; await save(c)
  const outbox = await box(), before = await rows(), original = crypt.decrypt, abort = new AbortController()
  vi.spyOn(crypt, 'decrypt').mockImplementationOnce(async value => {
    const plain = await original(value)
    if (event === 'mutation') c.messages[1]!.content = 'in-place'
    if (event === 'owner-aba') { await login('b'); await login('a') }
    if (event === 'abort') abort.abort()
    if (event === 'fence') { const db = await openDB(layout.projects.name, 2); await db.put('meta', id(99), 'erasure-fence'); db.close() }
    return plain
  })
  await expect(outbox.capture(select(), abort.signal)).rejects.toThrow()
  const after = await rows()
  expect(after[0].filter(k => Array.isArray(k))).toEqual(before[0].filter(k => Array.isArray(k)))
  expect(after[1].filter(r => r?.format === 'arty-sync-local-state')).toEqual(before[1])
})
it('refuses real active work and missing selection without creating a tombstone', async () => {
  await save(conversation()); const outbox = await box(), before = await rows()
  const release = (await import('../../services/conversationWork')).beginConversationWork('chat')
  await expect(outbox.capture(select())).rejects.toThrow('busy'); release()
  await expect(outbox.capture(select(['absent']))).rejects.toThrow('missing'); expect(await rows()).toEqual(before)
})
it('retains the atomic historical file snapshot and finds a same-ID replacement on the next scan', async () => {
  const files = await import('../../services/secureFileStorage'); await files.putFile({ id: 'f', name: 'A', type: '', data: 'QQ==' })
  const c = conversation(); c.messages[0]!.files = [{ id: 'f', name: 'presentation', type: '' }]; await save(c)
  const outbox = await box(), original = crypt.decrypt
  vi.spyOn(crypt, 'decrypt').mockImplementationOnce(async cipher => {
    const plaintext = await original(cipher)
    await files.putFile({ id: 'f', name: 'B', type: '', data: 'Qg==' })
    return plaintext
  })
  expect((await outbox.capture(select())).status).toBe('adopted')
  const adopted = await rows(), objects = await content(outbox), file = objects.find(o => o.kind === 'file')!
  expect(file.data.name).toBe('A'); expect([...file.binary]).toEqual([65])
  expect((await outbox.capture(select())).status).toBe('pending-changes'); expect(await rows()).toEqual(adopted)
  expect((await files.getFile('f'))!.name).toBe('B')
})
it('abort during real packet encryption retires the handle without writing a pending operation', async () => {
  await save(conversation()); const outbox = await box(), before = await rows(), abort = new AbortController()
  const original = webcrypto.subtle.encrypt.bind(webcrypto.subtle)
  vi.spyOn(webcrypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => { const result = await original(...args); abort.abort(); return result })
  await expect(outbox.capture(select(), abort.signal)).rejects.toThrow(); expect(await rows()).toEqual(before)
  expect(() => outbox.snapshot).toThrow()
})
it.each(['conflict', 'deleted'])('a selected %s record cannot be silently resolved/restored', async variant => {
  await save(conversation()); const outbox = await box()
  const capture = await import('../../services/workspaceSync/capture'), causal = await import('../../services/workspaceSync/causal')
  const first = await capture.captureLocalSyncSnapshot(outbox.snapshot.localHead, [], select())
  const record = first.next.records[0]!, root = record.revisions[0]!, live = root.value
  let head: SyncManifest
  if (variant === 'deleted') head = causal.stageSyncChange(first.next, { ...bound, recordId: record.id, kind: record.kind,
    revision: { id: id(100), intent: 'delete', parents: [root.id], value: { state: 'deleted' } } })
  else {
    const branch = (n: number) => causal.stageSyncChange(first.next, { ...bound, recordId: record.id, kind: record.kind,
      revision: { id: id(n), intent: 'edit', parents: [root.id], value: live } })
    head = causal.reconcileSyncManifests(first.next, branch(100), branch(101))
  }
  await expect(capture.captureLocalSyncSnapshot(head, first.bindings, select())).rejects.toThrow('base')
})
it('bounds the complete raw-binary frame, preserves empty text and rejects executable metadata', async () => {
  const { encodeSyncContent } = await import('../../services/workspaceSync/captureContent')
  const max = 10 * 1024 * 1024, base = encodeSyncContent('project-source', {}).size
  expect(encodeSyncContent('project-source', {}, new Uint8Array(max - base)).size).toBe(max)
  expect(() => encodeSyncContent('project-source', {}, new Uint8Array(max - base + 1))).toThrow('limit')
  expect(encodeSyncContent('project-text', { text: '' }).size).toBeGreaterThan(13)
  const getter = vi.fn(); expect(() => encodeSyncContent('file', { get name() { return getter() } })).toThrow('format'); expect(getter).not.toHaveBeenCalled()
})
