/** @vitest-environment node */
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSyncVaultSession, prepareSyncUpdate } from '../../services/workspaceSync/encryption'
import { stageSyncChange, reconcileSyncManifests } from '../../services/workspaceSync/causal'
import { parseSyncManifest, recordHeads } from '../../services/workspaceSync/schema'
import { parseSyncChainPage, parseSyncPublication } from '../../services/workspaceSync/transportFormat'
import { receiveSyncChain } from '../../services/workspaceSync/reception'
import { canonicalSyncJSON, encodeSyncContent } from '../../services/workspaceSync/captureContent'
import { decodeSyncContent } from '../../services/workspaceSync/content'
import { reviewReceivedSyncContent } from '../../services/workspaceSync/receivedContent'
import type { SyncKind, SyncManifest } from '../../services/workspaceSync/types'
import type { Conversation } from '../../types'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const bound = { vaultId: id(1), epoch: id(2) }
const code = 'ARTYSYNC1-00112233-44556677-8899AABB-CCDDEEFF-00112233-44556677-8899AABB-CCDDEEFF'
const empty = () => parseSyncManifest({ format: 'arty-sync-causal', version: 1, ...bound, records: [] })
const hash = async (body: Blob) => Buffer.from(await crypto.subtle.digest('SHA-256', await body.arrayBuffer())).toString('hex')
const chat = (chatId = id(10)): Conversation => ({ id: chatId, title: '', createdAt: 0, updatedAt: 1,
  messages: [{ id: id(11), role: 'user', content: '\uFEFFQ\r\n', timestamp: 0 }, { id: id(12), role: 'assistant', content: '\uD800', timestamp: 1 }] })
const file = (fileId = id(20), size = 1) => ({ id: fileId, name: '', type: '', size, recordedSize: 999, createdAt: 0 })
const sourceBytes = new Uint8Array([65, 13, 10])
async function doc(text = '') { return { id: id(31), name: 'D', originalName: 'D.txt', format: 'txt', revision: 1,
  sourceHash: await hash(new Blob([sourceBytes])), sourceBytes: 3, textChars: text.length, extractorVersion: 'arty-project-text-v1', createdAt: 0 } }
const project = (documents: unknown[] = []) => ({ schema: 1, id: id(30), name: 'P', instructions: '', euOnly: false, createdAt: 0, updatedAt: 1, documents })
let abort: AbortController
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); abort = new AbortController(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden') })) })
afterEach(() => { abort.abort(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

// Actual key, codec, manifest and receiver; transport is an explicit fixture,
// not a browser/server proof. No public actor DTO is injected by these tests.
async function fixture() {
  const guard = { signal: abort.signal, assertCurrent() { if (abort.signal.aborted) throw new Error('retired') }, async validateReadOnly() {} }
  const key = await createSyncVaultSession().unlock(code, bound, guard)
  const packets: { publication: ReturnType<typeof parseSyncPublication>; ciphertext: Blob }[] = []
  let base = empty(), next = empty(), payloads = new Map<string, Blob>()
  function observed(recordId: string, parents?: string[]) {
    if (!parents) return next
    const record = next.records.find(r => r.id === recordId)!, keep = new Set(parents), queue = [...parents]
    for (let i = 0; i < queue.length; i++) for (const parent of record.revisions.find(r => r.id === queue[i])!.parents) {
      if (!keep.has(parent)) { keep.add(parent); queue.push(parent) }
    }
    return parseSyncManifest({ ...next, records: next.records.map(r => r.id === recordId ? { ...r, revisions: r.revisions.filter(rev => keep.has(rev.id)) } : r) })
  }
  async function append() {
    const p = await prepareSyncUpdate(key, base, next, payloads, { assertCurrent: guard.assertCurrent, validate: guard.validateReadOnly })
    const publication = parseSyncPublication({ protocol: 1, status: 'published', reference: p.reference,
      previousHead: packets.at(-1)?.publication.head ?? null, head: p.reference.operationId, sequence: packets.length + 1 })
    packets.push({ publication, ciphertext: p.ciphertext }); base = next; payloads = new Map(); return publication
  }
  async function put(recordId: string, kind: SyncKind, data: unknown, binary?: Uint8Array, parents?: string[]) {
    const body = encodeSyncContent(kind, data, binary), payloadId = crypto.randomUUID(), revisionId = crypto.randomUUID()
    const record = next.records.find(r => r.id === recordId), branchBase = observed(recordId, parents)
    const branch = stageSyncChange(branchBase, { ...bound, recordId, kind, revision: { id: revisionId, intent: record ? 'edit' : 'create',
      parents: parents ?? (record ? recordHeads(record).map(r => r.id) : []), value: { state: 'live', payloadId, sha256: await hash(body), bytes: body.size } } })
    next = reconcileSyncManifests(branchBase, next, branch)
    payloads.set(payloadId, body); return revisionId
  }
  function remove(recordId: string, parents?: string[]) {
    const record = next.records.find(r => r.id === recordId)!
    const branchBase = observed(recordId, parents)
    const branch = stageSyncChange(branchBase, { ...bound, recordId, kind: record.kind, revision: { id: crypto.randomUUID(), intent: 'delete',
      parents: parents ?? recordHeads(record).map(r => r.id), value: { state: 'deleted' } } })
    next = reconcileSyncManifests(branchBase, next, branch)
  }
  const genesis = await append()
  const wire = { signal: abort.signal,
    async head() { return { protocol: 1 as const, ...bound, head: packets.at(-1)!.publication.head, sequence: packets.length } },
    async chain(anchor: { head: string | null; sequence: number }, after: number) { return parseSyncChainPage({ protocol: 1, ...bound, head: anchor.head, after,
      entries: packets.slice(after, after + 32).map(p => p.publication), next: after + 32 < anchor.sequence ? after + 32 : null }) },
    async object(ref: { operationId: string }) { return packets.find(p => p.publication.head === ref.operationId)!.ciphertext },
  }
  return { put, remove, append, receive: () => receiveSyncChain(key, wire, genesis, empty(), guard),
    get next(): SyncManifest { return next } }
}

it('reviews exact weak history, divergent presentation sizes and typed gallery aliases without URI lookup', async () => {
  const f = await fixture(), c = chat(), imageId = id(21), historicalId = '11111111-1111-1111-1111-111111111111'
  c.messages[0]!.files = [{ id: id(20), name: 'first', type: '', size: 0 }]
  c.messages[1]!.files = [{ id: id(20), name: 'second', type: 'text/plain', size: 42,
    visionCrop: { kind: 'auto', sourceFileId: id(80), sourceFileIds: [id(80)], rect: { x: 0, y: 0, width: 1, height: 1 } } }]
  c.messages[1]!.generatedImages = [imageId]; c.messages[1]!.content += `\r\n![X](arty-img://${historicalId}) code arty-img://${id(90)}`
  c.messages[1]!.projectTurn = { version: 1, mode: 'detached', euOnly: true, partial: true, projectId: id(70), projectRevision: 3,
    sources: [{ projectId: id(70), projectRevision: 2, documentId: id(71), documentRevision: 1, sourceHash: 'a'.repeat(64),
      extractorVersion: 'arty-project-text-v1', name: 'old', format: 'txt', startLine: 0, endLine: 1, partial: true }] }
  c.comparison = { version: 1, groupId: id(40), sourceConversationId: id(41), sourceMessageId: id(42), peerId: id(43), questionId: id(11), responseId: id(44),
    provider: 'mistral', requestedModel: 'old', status: 'done', metrics: { firstTokenMs: null, totalMs: null, inputTokens: 0, outputTokens: 0, costEur: null } }
  const data = { conversation: c, galleryAliases: [{ messageId: id(12), textId: historicalId, fileId: imageId }] }
  await f.put(c.id, 'conversation', data)
  await f.put(id(20), 'file', file(), new Uint8Array([65]))
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUg==', 'base64'))
  await f.put(imageId, 'file', { ...file(imageId, png.length), type: 'image/png' }, png)
  await f.append()
  const received = await f.receive(), reviewed = await reviewReceivedSyncContent(received)
  expect(reviewed.report).toMatchObject({ status: 'content-reviewed-not-applied', liveVariants: 3, decodedPayloads: 3, dependencyIssues: [] })
  expect(reviewed.variants.find(v => v.content.kind === 'conversation')!.content.data).toEqual(data)
  const projected = reviewed.projectLocal(empty(), [], () => crypto.randomUUID())
  const localChat = projected.projected.find(v => v.content.kind === 'conversation')!.content
  if (localChat.kind !== 'conversation') throw new Error('conversation')
  const { createSyncCaptureMapping } = await import('../../services/workspaceSync/captureMapping')
  expect(createSyncCaptureMapping(projected.bindings).conversation(localChat.conversation)).toEqual(data)
  expect(projected.retainedNotMaterialized).toEqual([])
  const uuid = vi.spyOn(webcrypto, 'randomUUID')
  const again = reviewed.projectLocal(f.next, projected.bindings, () => crypto.randomUUID())
  expect(again).toEqual(projected); expect(uuid).not.toHaveBeenCalled(); uuid.mockRestore()
  for (const scope of ['vaultId', 'epoch']) {
    const reserve = vi.fn(() => crypto.randomUUID())
    expect(() => reviewed.projectLocal({ ...f.next, [scope]: id(900) }, projected.bindings, reserve)).toThrow('scope')
    expect(reserve).not.toHaveBeenCalled()
  }
  const detached = reviewed.variants; detached.length = 0; const report = reviewed.report; report.anchor.sequence = 99
  expect(reviewed.variants).toHaveLength(3); expect(reviewed.report.anchor.sequence).toBe(2)
  expect(received.report.content).toBe('not-validated'); expect(fetch).not.toHaveBeenCalled()
  received.dispose(); expect(() => reviewed.report).toThrow('cancelled'); expect(() => reviewed.variants).toThrow('cancelled')
  expect(() => reviewed.projectLocal(empty(), [], () => crypto.randomUUID())).toThrow('cancelled')
})

it.each(['', '\uFEFFA\r\n', '\uD800'])('validates source-original digest and exact UTF-16 extracted text %j, retaining removed documents inert', async text => {
  const f = await fixture(), d = await doc(text)
  await f.put(id(31), 'project-source', { projectId: id(30), document: d }, sourceBytes)
  await f.put(id(32), 'project-text', { projectId: id(30), documentId: id(31), text })
  await f.put(id(30), 'project', project([{ ...d, sourceId: id(31), textId: id(32) }]))
  await f.append()
  const first = await reviewReceivedSyncContent(await f.receive())
  expect(first.report).toMatchObject({ dependencyIssues: [], orphanDocumentRecords: 0 })
  expect(first.variants.find(v => v.content.kind === 'project-text')!.content.data).toMatchObject({ text })
  const projected = first.projectLocal(empty(), [], () => crypto.randomUUID())
  const source = projected.projected.find(v => v.content.kind === 'project-source')!.content
  const localText = projected.projected.find(v => v.content.kind === 'project-text')!.content
  const localProject = projected.projected.find(v => v.content.kind === 'project')!.content
  if (source.kind !== 'project-source' || localText.kind !== 'project-text' || localProject.kind !== 'project') throw new Error('projection')
  expect(source.document.id).toBe(localText.documentId); expect(localProject.project.documents[0]!.id).toBe(localText.documentId)
  expect(localText.text).toBe(text); expect(new Uint8Array(await source.binary.arrayBuffer())).toEqual(sourceBytes)
  await f.put(id(30), 'project', project()); await f.append()
  const orphan = await reviewReceivedSyncContent(await f.receive())
  expect(orphan.report).toMatchObject({ liveVariants: 3, decodedPayloads: 3, orphanDocumentRecords: 2, dependencyIssues: [] })
  expect(orphan.variants.find(v => v.content.kind === 'project')!.content.data).toMatchObject({ documents: [] })
  const noReattach = orphan.projectLocal(empty(), [], () => crypto.randomUUID())
  expect(noReattach.projected.map(v => v.recordId)).toEqual([id(30)])
  expect(noReattach.retainedNotMaterialized.sort()).toEqual([id(31), id(32)])
})

it('revocation from the physical allocator cannot publish a partially projected result', async () => {
  const f = await fixture(), c = chat()
  await f.put(c.id, 'conversation', { conversation: c, galleryAliases: [] }); await f.append()
  const received = await f.receive(), review = await reviewReceivedSyncContent(received)
  const reserve = vi.fn(() => { received.dispose(); return crypto.randomUUID() })
  expect(() => review.projectLocal(empty(), [], reserve)).toThrow('cancelled')
  expect(reserve).toHaveBeenCalledTimes(1); expect(() => review.report).toThrow('cancelled')
})
it('an orphan file or a file mentioned only in historical text stays in T, never gains materialized rows or strong bindings', async () => {
  const f = await fixture(), c = chat()
  c.messages[1]!.content = `Historical arty-img://${id(20)}`
  await f.put(c.id, 'conversation', { conversation: c, galleryAliases: [] })
  await f.put(id(20), 'file', file(), new Uint8Array([65])); await f.put(id(21), 'file', file(id(21)), new Uint8Array([66]))
  await f.append()
  const received = await f.receive(), review = await reviewReceivedSyncContent(received), before = received.manifest
  const projected = review.projectLocal(empty(), [], () => crypto.randomUUID())
  expect(projected.projected.map(v => v.recordId)).toEqual([c.id])
  expect(projected.retainedNotMaterialized.sort()).toEqual([id(20), id(21)])
  expect(projected.bindings.filter(b => b.kind === 'file' && b.presence === 'record')).toEqual([])
  expect(received.manifest).toEqual(before); expect(before.records).toHaveLength(3)
})

it.each(['missing', 'deleted', 'ambiguous', 'edit-delete'])('reports %s attachment dependency, never a guessed winning variant', async mode => {
  const f = await fixture(), c = chat(); c.messages[0]!.files = [{ id: id(20), name: '', type: '', size: 1 }]
  await f.put(c.id, 'conversation', { conversation: c, galleryAliases: [] })
  if (mode !== 'missing') {
    const root = await f.put(id(20), 'file', file(), new Uint8Array([65]))
    if (mode === 'deleted') f.remove(id(20))
    else {
      // Equal bytes in both heads do not supply a revision selector.
      await f.put(id(20), 'file', file(), new Uint8Array([65]))
      if (mode === 'edit-delete') f.remove(id(20), [root])
      else await f.put(id(20), 'file', file(), new Uint8Array([65]), [root])
    }
  }
  await f.append(); const reviewed = await reviewReceivedSyncContent(await f.receive())
  expect(reviewed.report.dependencyIssues).toEqual([expect.objectContaining({ targetId: id(20), relation: 'attachment',
    reason: mode === 'edit-delete' ? 'ambiguous' : mode })])
  const reserve = vi.fn(() => crypto.randomUUID())
  expect(() => reviewed.projectLocal(empty(), [], reserve)).toThrow('base'); expect(reserve).not.toHaveBeenCalled()
})

it.each(['message-id', 'crop-id', 'comparison-id', 'source-id', 'domain', 'parent'])('rejects %s logical identity violations in authenticated content', async mode => {
  const f = await fixture(), c = chat()
  if (mode === 'message-id') c.messages[0]!.id = 'local-but-not-logical'
  if (mode === 'crop-id') c.messages[0]!.files = [{ id: id(20), name: '', type: '', visionCrop: { kind: 'auto', sourceFileId: 'local', sourceFileIds: [], rect: { x: 0, y: 0, width: 1, height: 1 } } }]
  if (mode === 'comparison-id') c.comparison = { version: 1, groupId: 'local', sourceConversationId: id(40), sourceMessageId: id(41), peerId: id(42), questionId: id(11), responseId: id(12), provider: 'mistral', requestedModel: '', status: 'pending' }
  if (mode === 'source-id') c.messages[0]!.projectTurn = { version: 1, mode: 'detached', euOnly: true, partial: true, projectId: 'local', sources: [] }
  if (mode === 'domain') c.messages[0]!.id = id(20)
  if (mode === 'parent') { const other = chat(id(40)); await f.put(other.id, 'conversation', { conversation: other, galleryAliases: [] }) }
  await f.put(c.id, 'conversation', { conversation: c, galleryAliases: [] })
  await f.put(id(20), 'file', file(), new Uint8Array([65])); await f.append()
  const received = await f.receive(); await expect(reviewReceivedSyncContent(received)).rejects.toThrow('format')
  expect(received.report.status).toBe('received-not-applied')
})

it.each(['source-hash', 'source-size', 'source-parent', 'text-parent', 'text-document', 'text-length', 'descriptor'])('rejects %s despite valid envelope AEAD and body commitment', async mode => {
  const f = await fixture(), d = await doc('A'), catalogue = { ...d, sourceId: id(31), textId: id(32) }
  if (mode === 'source-hash') d.sourceHash = 'b'.repeat(64)
  if (mode === 'source-size') d.sourceBytes = 2
  if (mode === 'descriptor') catalogue.name = 'changed independently'
  await f.put(id(31), 'project-source', { projectId: mode === 'source-parent' ? id(90) : id(30), document: d }, sourceBytes)
  await f.put(id(32), 'project-text', { projectId: mode === 'text-parent' ? id(90) : id(30), documentId: mode === 'text-document' ? id(99) : id(31), text: mode === 'text-length' ? '' : 'A' })
  await f.put(id(30), 'project', project([catalogue])); await f.append()
  const received = await f.receive(); await expect(reviewReceivedSyncContent(received)).rejects.toThrow()
  expect(received.report.content).toBe('not-validated')
})

it.each(['missing', 'extra', 'wrong-message', 'wrong-file', 'duplicate-text', 'wrong-order'])('rejects %s gallery aliases without scanning raw Markdown', async mode => {
  const f = await fixture(), c = chat(); c.messages[1]!.generatedImages = [id(20), id(21)]
  const aliases = [{ messageId: id(12), fileId: id(20), textId: id(80) }, { messageId: id(12), fileId: id(21), textId: id(81) }]
  if (mode === 'missing') aliases.pop()
  if (mode === 'extra') aliases.push({ messageId: id(12), fileId: id(22), textId: id(82) })
  if (mode === 'wrong-message') aliases[0]!.messageId = id(11)
  if (mode === 'wrong-file') aliases[0]!.fileId = id(22)
  if (mode === 'duplicate-text') aliases[1]!.textId = id(80)
  if (mode === 'wrong-order') aliases.reverse()
  await f.put(c.id, 'conversation', { conversation: c, galleryAliases: aliases }); await f.append()
  await expect(reviewReceivedSyncContent(await f.receive())).rejects.toThrow('format')
})

function frame(json: string | Uint8Array, suffix = new Uint8Array(), size?: number) {
  const bytes = typeof json === 'string' ? new TextEncoder().encode(json) : json, header = new Uint8Array(13)
  header.set(new TextEncoder().encode('ARTYSOBJ1')); new DataView(header.buffer).setUint32(9, size ?? bytes.length)
  return new Blob([header, bytes, suffix])
}
it.each(['duplicate', 'whitespace', 'number', 'escaped', 'BOM', 'utf8', 'length', 'magic', 'version', 'kind', 'extra', 'suffix', 'id'])('rejects noncanonical/incorrect frame %s', async mode => {
  const value = { kind: 'conversation', version: 1, data: { conversation: chat(), galleryAliases: [] } }
  let json = canonicalSyncJSON(value), body: Blob
  if (mode === 'duplicate') json = json.replace('"version":1', '"version":1,"version":1')
  if (mode === 'whitespace') json = ' ' + json
  if (mode === 'number') json = json.replace('"version":1', '"version":1.0')
  if (mode === 'escaped') json = json.replace('"kind"', '"\\u006bind"')
  if (mode === 'BOM') json = '\uFEFF' + json
  if (mode === 'version') json = json.replace('"version":1', '"version":2')
  if (mode === 'kind') json = json.replace('"kind":"conversation"', '"kind":"file"')
  if (mode === 'extra') json = canonicalSyncJSON({ ...value, authority: true })
  if (mode === 'id') { value.data.conversation.id = id(50); json = canonicalSyncJSON(value) }
  body = frame(mode === 'utf8' ? new Uint8Array([255]) : json, mode === 'suffix' ? new Uint8Array([0]) : undefined, mode === 'length' ? 0xffffffff : undefined)
  if (mode === 'magic') body = new Blob([new Uint8Array(13), json])
  await expect(decodeSyncContent(body, { id: id(10), kind: 'conversation' }, () => {})).rejects.toThrow('format')
})

it('uses native Blob methods, refuses a spoof before invoking its read, and preserves an empty durable file', async () => {
  const body = encodeSyncContent('file', file(id(20), 0)), evil = vi.fn()
  Object.assign(body, { arrayBuffer: evil, slice: evil })
  const parsed = await decodeSyncContent(body, { id: id(20), kind: 'file' }, () => {})
  expect(parsed).toMatchObject({ kind: 'file', data: { size: 0, recordedSize: 999 } }); expect(evil).not.toHaveBeenCalled()
  await expect(decodeSyncContent({ size: 99, slice: evil, arrayBuffer: evil } as unknown as Blob, { id: id(20), kind: 'file' }, () => {})).rejects.toThrow('format')
  expect(evil).not.toHaveBeenCalled()
})

it('retirement during original-source digest prevents any prepared report', async () => {
  const f = await fixture(), d = await doc(); await f.put(id(31), 'project-source', { projectId: id(30), document: d }, sourceBytes); await f.append()
  const received = await f.receive(), original = crypto.subtle.digest.bind(crypto.subtle)
  vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => { const result = await original(...args); abort.abort(); return result })
  await expect(reviewReceivedSyncContent(received)).rejects.toThrow()
  expect(received.signal.aborted).toBe(true)
})

it('bounds aggregate logical identities across individually valid conversations without truncation', async () => {
  const f = await fixture()
  for (let n = 0; n < 3; n++) {
    const c = chat(id(10 + n)); c.messages = Array.from({ length: 3400 }, (_, i) => ({ id: id(100 + n * 3400 + i), role: 'user', content: '', timestamp: 0 }))
    await f.put(c.id, 'conversation', { conversation: c, galleryAliases: [] })
  }
  await f.append(); const received = await f.receive()
  await expect(reviewReceivedSyncContent(received)).rejects.toThrow('limit')
  expect(received.report.records).toBe(3)
})

const canonicalPng = () => Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKxoAAAAASUVORK5CYII=', 'base64'))
it('validates a marked canonical image against its bounded binary header without rendering', async () => {
  const bytes = canonicalPng(), data = { ...file(id(20), bytes.length), type: 'image/png', width: 1, height: 1, normalizationVersion: 2 }
  const parsed = await decodeSyncContent(encodeSyncContent('file', data, bytes), { id: id(20), kind: 'file' }, () => {})
  expect(parsed.data).toEqual(data); expect(fetch).not.toHaveBeenCalled()
})
it.each(['version', 'empty', 'huge', 'missing-dimension', 'mime', 'binary-dimension', 'size'])('refuses canonical image marker with invalid %s', async mode => {
  let bytes = canonicalPng()
  const data: Record<string, unknown> = { ...file(id(20), bytes.length), type: 'image/png', width: 1, height: 1, normalizationVersion: 2 }
  if (mode === 'version') data.normalizationVersion = 99
  if (mode === 'empty') bytes = new Uint8Array()
  if (mode === 'huge') data.width = Number.MAX_SAFE_INTEGER
  if (mode === 'missing-dimension') delete data.height
  if (mode === 'mime') data.type = 'image/webp'
  if (mode === 'binary-dimension') data.width = 2
  if (mode === 'size') bytes = new Uint8Array(4 * 1024 * 1024 + 1)
  data.size = bytes.length
  await expect(decodeSyncContent(encodeSyncContent('file', data, bytes), { id: id(20), kind: 'file' }, () => {})).rejects.toThrow()
})

it('rejects an invalid gallery head even when another equal-identity head has a valid PNG signature', async () => {
  const f = await fixture(), c = chat(), bytes = canonicalPng()
  c.messages[1]!.generatedImages = [id(20)]
  await f.put(c.id, 'conversation', { conversation: c, galleryAliases: [{ messageId: id(12), textId: id(80), fileId: id(20) }] })
  const root = await f.put(id(20), 'file', { ...file(id(20), bytes.length), type: 'image/png' }, bytes)
  await f.put(id(20), 'file', { ...file(id(20), bytes.length), type: 'image/png' }, bytes)
  await f.put(id(20), 'file', { ...file(), type: 'image/png' }, new Uint8Array([65]), [root]); await f.append()
  const received = await f.receive(); await expect(reviewReceivedSyncContent(received)).rejects.toThrow('format')
  expect(received.report.remoteConflicts).toBe(1)
})

it('checks both conflicting project catalogues and reports source ambiguity without picking or reattaching', async () => {
  const f = await fixture(), d = await doc('A')
  const sourceRoot = await f.put(id(31), 'project-source', { projectId: id(30), document: d }, sourceBytes)
  await f.put(id(32), 'project-text', { projectId: id(30), documentId: id(31), text: 'A' })
  const projectRoot = await f.put(id(30), 'project', project())
  await f.put(id(30), 'project', project([{ ...d, sourceId: id(31), textId: id(32) }]))
  await f.put(id(30), 'project', { ...project(), name: 'Other edit' }, undefined, [projectRoot])
  await f.put(id(31), 'project-source', { projectId: id(30), document: d }, sourceBytes)
  await f.put(id(31), 'project-source', { projectId: id(30), document: { ...d, name: 'Other metadata' } }, sourceBytes, [sourceRoot])
  await f.append(); const reviewed = await reviewReceivedSyncContent(await f.receive())
  expect(reviewed.report).toMatchObject({ conflicts: 2, liveVariants: 5, orphanDocumentRecords: 0,
    dependencyIssues: [expect.objectContaining({ targetId: id(31), relation: 'project-source', reason: 'ambiguous' })] })
  expect(reviewed.variants.filter(v => v.content.kind === 'project')).toHaveLength(2)
})

it('retirement during gallery prefix reading prevents a late review report', async () => {
  const f = await fixture(), c = chat(), bytes = canonicalPng()
  c.messages[1]!.generatedImages = [id(20)]
  await f.put(c.id, 'conversation', { conversation: c, galleryAliases: [{ messageId: id(12), textId: id(80), fileId: id(20) }] })
  await f.put(id(20), 'file', { ...file(id(20), bytes.length), type: 'image/png' }, bytes); await f.append()
  const received = await f.receive(), original = Blob.prototype.arrayBuffer
  vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(async function (this: Blob) {
    const value = await original.call(this); if (this.size === 12) received.dispose(); return value
  })
  await expect(reviewReceivedSyncContent(received)).rejects.toThrow('cancelled')
})

it.each(['missing', 'ambiguous', 'inverse', 'orphan-inverse'])('refuses contradictory source/text identity pairs with %s targets', async mode => {
  const f = await fixture(), d = await doc('A')
  if (mode === 'missing' || mode === 'ambiguous') {
    await f.put(id(30), 'project', project([{ ...d, sourceId: id(31), textId: id(32) }, { ...d, id: id(33), sourceId: id(33), textId: id(32) }]))
    if (mode === 'ambiguous') {
      const root = await f.put(id(32), 'project-text', { projectId: id(30), documentId: id(31), text: 'A' })
      await f.put(id(32), 'project-text', { projectId: id(30), documentId: id(31), text: 'B' })
      await f.put(id(32), 'project-text', { projectId: id(30), documentId: id(31), text: 'C' }, undefined, [root])
    }
  } else if (mode === 'inverse') {
    const root = await f.put(id(30), 'project', project())
    await f.put(id(30), 'project', project([{ ...d, sourceId: id(31), textId: id(32) }]))
    await f.put(id(30), 'project', project([{ ...d, sourceId: id(31), textId: id(33) }]), undefined, [root])
  } else {
    // Parent/source absent does not authorize two text identities for one doc.
    await f.put(id(32), 'project-text', { projectId: id(30), documentId: id(31), text: 'A' })
    await f.put(id(33), 'project-text', { projectId: id(30), documentId: id(31), text: 'B' })
  }
  await f.append(); await expect(reviewReceivedSyncContent(await f.receive())).rejects.toThrow('format')
})

it('retains two text heads with the SAME source/text identity pair as a genuine conflict', async () => {
  const f = await fixture(), d = await doc('A')
  await f.put(id(31), 'project-source', { projectId: id(30), document: d }, sourceBytes)
  await f.put(id(30), 'project', project([{ ...d, sourceId: id(31), textId: id(32) }]))
  const root = await f.put(id(32), 'project-text', { projectId: id(30), documentId: id(31), text: 'A' })
  await f.put(id(32), 'project-text', { projectId: id(30), documentId: id(31), text: 'B' })
  await f.put(id(32), 'project-text', { projectId: id(30), documentId: id(31), text: 'C' }, undefined, [root]); await f.append()
  const reviewed = await reviewReceivedSyncContent(await f.receive())
  expect(reviewed.report.dependencyIssues).toEqual([expect.objectContaining({ relation: 'project-text', reason: 'ambiguous' })])
  expect(reviewed.variants.filter(v => v.content.kind === 'project-text')).toHaveLength(2)
})
