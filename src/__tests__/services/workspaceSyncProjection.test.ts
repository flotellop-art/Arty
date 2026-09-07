/** @vitest-environment node */
import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
import type { SyncLocalBinding } from '../../services/workspaceSync/privateState'
import { createSyncReceiveMapping } from '../../services/workspaceSync/receiveMapping'
import { createSyncCaptureMapping } from '../../services/workspaceSync/captureMapping'
import { projectLocalSyncConversation, copyMessageSyncProvenance, localSyncConversationWitness } from '../../services/workspaceSync/localProvenance'
import { projectSyncConversation } from '../../services/workspaceSync/captureProjection'
import { canonicalSyncJSON, encodeSyncContent } from '../../services/workspaceSync/captureContent'
import { decodeSyncContent } from '../../services/workspaceSync/content'
import { parseSyncManifest } from '../../services/workspaceSync/schema'
import { SYNC_LIMITS } from '../../services/workspaceSync/types'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const empty = () => parseSyncManifest({ format: 'arty-sync-causal', version: 1, vaultId: id(1), epoch: id(2), records: [] })
const chat = (): Conversation => ({ id: id(10), title: '', createdAt: 0, updatedAt: 1, messages: [
  { id: id(11), role: 'user', content: '\uFEFFQ\r\n', timestamp: 0 },
  { id: id(12), role: 'assistant', content: `\uD800 ![image](arty-img://${id(90)}) code arty-img://${id(91)}`, timestamp: 1,
    generatedImages: [id(20)], pinned: false, interrupted: false,
    factCheck: { overallConfidence: 'low', claims: [], modelLabel: '', checkedAt: 0, status: 'pending' } },
] })
const data = (c = chat()) => ({ conversation: c, galleryAliases: [{ messageId: id(12), fileId: id(20), textId: id(90) }] })
const ref = (kind: SyncLocalBinding['kind'], logicalId: string, localId: string, parentLocalId: string | null = null): SyncLocalBinding =>
  ({ kind, logicalId, localId, parentLocalId, presence: 'reference' })
beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([false, true])('inverse + capture is byte-identical with original restoredArchive=%s, including weak history', originalBit => {
  const c = chat()
  if (originalBit) for (const m of c.messages) m.restoredArchive = true
  c.hasProjectContext = true; c.outputRestriction = 'client-reply-draft-v1'; c.hasGoogleData = true; c.projectId = id(30)
  c.messages[0]!.files = [{ id: id(21), name: 'one', type: '', size: 0, visionCrop: {
    kind: 'auto', sourceFileId: id(80), sourceFileIds: [id(80), id(81)], rect: { x: 0, y: 0, width: 1, height: 1 } } }]
  c.messages[1]!.projectTurn = { version: 1, mode: 'search', euOnly: false, partial: false, projectId: id(30), projectRevision: 99,
    sources: [{ projectId: id(30), projectRevision: 77, documentId: id(31), documentRevision: 1, sourceHash: 'a'.repeat(64),
      extractorVersion: 'arty-project-text-v1', name: 'old', format: 'txt', startLine: 0, endLine: 1, partial: true }] }
  c.comparison = { version: 1, groupId: id(40), sourceConversationId: id(41), sourceMessageId: id(42), peerId: id(43),
    questionId: id(11), responseId: id(44), provider: 'mistral', requestedModel: 'old', status: 'streaming', error: '', binaryBytes: 0,
    metrics: { firstTokenMs: null, totalMs: null, inputTokens: 0, outputTokens: 0, costEur: null },
    attribution: { model: '', provider: 'mistral', conversationId: c.id, confirmed: false } }
  const wire = data(c), before = canonicalSyncJSON(wire), inverse = createSyncReceiveMapping(empty(), [], () => crypto.randomUUID())
  const local = inverse.projectContent(c.id, { kind: 'conversation', data: wire })
  if (local.kind !== 'conversation') throw new Error('conversation')
  expect(local.conversation.id).not.toBe(c.id)
  expect(local.conversation.messages.every(m => m.restoredArchive === true)).toBe(true)
  expect(local.conversation.messages[1]!.localSyncProvenance).toEqual({ version: 1,
    ...(!originalBit ? { historicalInjected: true } : {}), galleryAliases: [{ fileId: local.conversation.messages[1]!.generatedImages![0], textId: id(90) }] })
  expect(inverse.bindings.filter(b => b.presence === 'record').map(b => b.logicalId)).toEqual([c.id])
  const captures = createSyncCaptureMapping(inverse.bindings)
  expect(canonicalSyncJSON(captures.conversation(local.conversation))).toBe(before)
  expect(canonicalSyncJSON(wire)).toBe(before)
  // Copies carry only tiny provenance, no old DTO that hides genuine edits.
  local.conversation.title = 'new'; local.conversation.messages[1]!.pinned = true; local.conversation.messages[1]!.content += '\r\nedit'
  const edited = captures.conversation(local.conversation)
  expect(edited.conversation).toMatchObject({ title: 'new', messages: [expect.anything(), expect.objectContaining({ pinned: true, content: c.messages[1]!.content + '\r\nedit' })] })
  expect(edited.galleryAliases).toEqual(wire.galleryAliases)
})

it('reuses typed references and rejects wrong domains, parents and allocator collisions', () => {
  const known = [ref('conversation', id(10), 'legacy-chat'), ref('message', id(11), 'old-message', 'legacy-chat'), ref('file', id(20), id(120))]
  const reserve = vi.fn(() => crypto.randomUUID()), mapping = createSyncReceiveMapping(empty(), known, reserve)
  const local = mapping.projectContent(id(10), { kind: 'conversation', data: data() })
  if (local.kind !== 'conversation') throw new Error('conversation')
  expect(local.conversation.id).toBe('legacy-chat'); expect(local.conversation.messages[0]!.id).toBe('old-message')
  expect(local.conversation.messages[1]!.generatedImages).toEqual([id(120)])
  expect(known.every(b => b.presence === 'reference')).toBe(true)
  const badDomain = createSyncReceiveMapping(empty(), [ref('file', id(10), id(100))], () => crypto.randomUUID())
  expect(() => badDomain.projectContent(id(10), { kind: 'conversation', data: data() })).toThrow('integrity')
  const badParent = createSyncReceiveMapping(empty(), [ref('conversation', id(40), 'other'), ref('message', id(11), 'm', 'other')], () => crypto.randomUUID())
  expect(() => badParent.projectContent(id(10), { kind: 'conversation', data: data() })).toThrow('integrity')
  const collision = createSyncReceiveMapping(empty(), [ref('file', id(99), id(100))], () => id(100))
  expect(() => collision.projectContent(id(10), { kind: 'conversation', data: data() })).toThrow('integrity')
})

it.each(['source', 'text', 'both', 'none'])('source/text share one physical document, with %s previously reserved', known => {
  const bindings = [ref('project', id(30), id(130))]
  if (known === 'source' || known === 'both') bindings.push(ref('project-source', id(31), id(131), id(130)))
  if (known === 'text' || known === 'both') bindings.push(ref('project-text', id(32), id(131), id(130)))
  const mapping = createSyncReceiveMapping(empty(), bindings, () => crypto.randomUUID())
  mapping.documentPair(id(30), id(31), id(32))
  const text = mapping.projectContent(id(32), { kind: 'project-text', data: { projectId: id(30), documentId: id(31), text: '\uFEFF\r\n\uD800' } })
  const descriptor = { id: id(31), name: 'original', originalName: 'a.docx', format: 'docx' as const, revision: 1 as const,
    sourceHash: 'a'.repeat(64), sourceBytes: 1, textChars: 4, extractorVersion: 'arty-project-text-v1' as const, createdAt: 0 }
  const source = mapping.projectContent(id(31), { kind: 'project-source', data: { projectId: id(30), document: descriptor }, binary: new Blob(['x']) })
  const project = mapping.projectContent(id(30), { kind: 'project', data: { schema: 1, id: id(30), name: 'P', instructions: '', euOnly: false,
    createdAt: 0, updatedAt: 1, documents: [{ ...descriptor, sourceId: id(31), textId: id(32) }] } })
  if (text.kind !== 'project-text' || source.kind !== 'project-source' || project.kind !== 'project') throw new Error('project')
  expect(source.document.id).toBe(text.documentId); expect(project.project.documents[0]!.id).toBe(text.documentId)
  expect(text.projectId).toBe(id(130)); expect(source.projectId).toBe(id(130)); expect(project.project.id).toBe(id(130))
  expect(text.text).toBe('\uFEFF\r\n\uD800'); expect(project.project.documents[0]).not.toHaveProperty('textId')
  expect(mapping.bindings.filter(b => b.presence === 'record')).toHaveLength(3)
  expect(() => mapping.documentPair(id(30), id(31), id(33))).toThrow('integrity')
  expect(() => mapping.documentPair(id(30), id(33), id(32))).toThrow('integrity')
})

it('refuses contradictory existing source/text addresses rather than silently rebinding either', () => {
  const mapping = createSyncReceiveMapping(empty(), [ref('project', id(30), id(130)), ref('project-source', id(31), id(131), id(130)),
    ref('project-text', id(32), id(132), id(130))], () => crypto.randomUUID())
  expect(() => mapping.documentPair(id(30), id(31), id(32))).toThrow('integrity')
})

it('preserves binary receipt metadata including empty MIME/name, negative historical date and distinct recorded size', async () => {
  const mapping = createSyncReceiveMapping(empty(), [], () => crypto.randomUUID()), binary = new Blob()
  const local = mapping.projectContent(id(20), { kind: 'file', data: { id: id(20), name: '', type: '', size: 0, recordedSize: 99, createdAt: -2 }, binary })
  if (local.kind !== 'file') throw new Error('file')
  expect(local.file).toMatchObject({ name: '', type: '', size: 0, recordedSize: 99, createdAt: -2 })
  expect(local.file.id).not.toBe(id(20)); expect(local.binary).toBe(binary); expect(await local.binary.text()).toBe('')
})

it.each(['legacy-image', 'streaming'])('refuses an existing address incompatible with the physical conversation: %s', address => {
  const bindings = address === 'streaming'
    ? [ref('conversation', id(10), 'legacy-chat'), ref('message', id(11), address, 'legacy-chat')]
    : [ref('file', id(20), address)]
  const before = structuredClone(bindings), mapping = createSyncReceiveMapping(empty(), bindings, () => crypto.randomUUID())
  expect(() => mapping.projectContent(id(10), { kind: 'conversation', data: data() })).toThrow('format')
  expect(bindings).toEqual(before)
})

it.each(['old/path', 'x'.repeat(129)])('preserves weak file reference %s but refuses its incompatible materialization', address => {
  const mapping = createSyncReceiveMapping(empty(), [ref('file', id(80), address), ref('file', id(21), 'legacy-image')], () => crypto.randomUUID())
  const c = chat()
  c.messages[0]!.files = [{ id: id(21), name: '', type: '', size: 0, visionCrop: {
    kind: 'auto', sourceFileId: id(80), sourceFileIds: [id(80)], rect: { x: 0, y: 0, width: 1, height: 1 } } }]
  const local = mapping.projectContent(c.id, { kind: 'conversation', data: data(c) })
  if (local.kind !== 'conversation') throw new Error('conversation')
  expect(local.conversation.messages[0]!.files![0]!.visionCrop!.sourceFileId).toBe(address)
  expect(createSyncCaptureMapping(mapping.bindings).conversation(local.conversation)).toEqual(data(c))
  const file = (id: string) => ({ kind: 'file' as const, data: { id, name: '', type: '', size: 0, recordedSize: 0, createdAt: 0 }, binary: new Blob() })
  expect(mapping.projectContent(id(21), file(id(21)))).toMatchObject({ kind: 'file', file: { id: 'legacy-image' } })
  expect(() => mapping.projectContent(id(80), file(id(80)))).toThrow('format')
})

it.each(['project', 'document'])('refuses incompatible physical %s addresses in every materialized document representation', bad => {
  const projectId = bad === 'project' ? 'legacy-project' : id(130), documentId = bad === 'document' ? 'legacy-document' : id(131)
  const bindings = [ref('project', id(30), projectId), ref('project-source', id(31), documentId, projectId), ref('project-text', id(32), documentId, projectId)]
  const descriptor = { id: id(31), name: 'a', originalName: 'a.txt', format: 'txt' as const, revision: 1 as const,
    sourceHash: 'a'.repeat(64), sourceBytes: 1, textChars: 1, extractorVersion: 'arty-project-text-v1' as const, createdAt: 0 }
  for (const [recordId, content] of [
    [id(30), { kind: 'project', data: { schema: 1, id: id(30), name: 'P', instructions: '', euOnly: false, createdAt: 0, updatedAt: 1,
      documents: [{ ...descriptor, sourceId: id(31), textId: id(32) }] } }],
    [id(31), { kind: 'project-source', data: { projectId: id(30), document: descriptor }, binary: new Blob(['x']) }],
    [id(32), { kind: 'project-text', data: { projectId: id(30), documentId: id(31), text: 'x' } }],
  ] as const) {
    const mapping = createSyncReceiveMapping(empty(), bindings, () => crypto.randomUUID())
    expect(() => mapping.projectContent(recordId, content)).toThrow('format')
  }
  expect(bindings.every(b => b.presence === 'reference')).toBe(true)
})

it('wire grammar refuses device-local provenance even in a valid canonical authenticated-content frame', async () => {
  const c = chat(); c.messages[0]!.restoredArchive = true; c.messages[0]!.localSyncProvenance = { version: 1, historicalInjected: true }
  expect(() => projectSyncConversation(c)).toThrow('format')
  await expect(decodeSyncContent(encodeSyncContent('conversation', data(c)), { id: c.id, kind: 'conversation' }, () => {})).rejects.toThrow('format')
  expect(projectLocalSyncConversation(c).messages[0]!.localSyncProvenance).toEqual(c.messages[0]!.localSyncProvenance)
})

it.each(['unknown', 'undefined-field', 'undefined-gallery', 'lost-safety', 'duplicate-file', 'duplicate-text', 'getter', 'sparse'])('local provenance refuses %s without masking it', mode => {
  const c = chat(), m = c.messages[1]!
  m.restoredArchive = true; m.localSyncProvenance = { version: 1, historicalInjected: true, galleryAliases: [{ fileId: id(20), textId: id(90) }] }
  const p = m.localSyncProvenance as any, getter = vi.fn(() => true)
  if (mode === 'unknown') p.secret = 1
  if (mode === 'undefined-field') (m as any).unknown = undefined
  if (mode === 'undefined-gallery') m.generatedImages = undefined
  if (mode === 'lost-safety') delete m.restoredArchive
  if (mode === 'duplicate-file') p.galleryAliases.push({ fileId: id(20), textId: id(91) })
  if (mode === 'duplicate-text') p.galleryAliases.push({ fileId: id(21), textId: id(90) })
  if (mode === 'getter') Object.defineProperty(p, 'historicalInjected', { enumerable: true, get: getter })
  if (mode === 'sparse') p.galleryAliases = new Array(1)
  expect(() => projectLocalSyncConversation(c)).toThrow(); expect(getter).not.toHaveBeenCalled()
})

it('branch transfer has independent aliases; removal/reorder/addition changes only the present image pairs', () => {
  const c = chat(), m = c.messages[1]!
  m.restoredArchive = true; m.localSyncProvenance = { version: 1, historicalInjected: true, galleryAliases: [{ fileId: id(20), textId: id(90) }] }
  const branch = { ...m, ...copyMessageSyncProvenance(m), id: id(50) }
  branch.localSyncProvenance!.galleryAliases![0]!.textId = id(91)
  expect(m.localSyncProvenance.galleryAliases![0]!.textId).toBe(id(90))
  const mapping = createSyncCaptureMapping([])
  m.generatedImages = [id(21), id(20)]
  expect(mapping.conversation(c).galleryAliases.map(a => a.textId)).toEqual([id(21), id(90)])
  m.generatedImages = [id(21)]
  expect(mapping.conversation(c).galleryAliases.map(a => a.textId)).toEqual([id(21)])
  m.generatedImages = [id(90), id(20)]
  expect(() => mapping.conversation(c)).toThrow('format') // two different files may not acquire one historical text alias
})

it.each(['nodes', 'bytes', 'legacy-bytes'])('valid near-%s-budget wire remains recapturable after bounded local provenance expansion', async limit => {
  const c = chat()
  c.messages = Array.from({ length: limit === 'nodes' ? 5000 : 10 }, (_, i) => ({ id: id(100 + i), role: 'assistant', content: '', timestamp: 0,
    factCheck: { overallConfidence: 'low', checkedAt: 0, modelLabel: '', claims: [
      { claim: '', verdict: 'uncertain', explanation: '' }, { claim: '', verdict: 'verified', explanation: '' },
    ] } }))
  const wire = { conversation: c, galleryAliases: [] }
  if (limit !== 'nodes') c.messages[0]!.content = 'x'.repeat(SYNC_LIMITS.objectBytes - encodeSyncContent('conversation', wire).size)
  const payload = encodeSyncContent('conversation', wire)
  const decoded = await decodeSyncContent(payload, { id: c.id, kind: 'conversation' }, () => {})
  const legacyId = 'c'.repeat(256)
  const bindings = limit === 'legacy-bytes' ? [ref('conversation', c.id, legacyId),
    ...c.messages.map((m, i) => ref('message', m.id, `m${i}`.padEnd(256, 'm'), legacyId))] : []
  const inverse = createSyncReceiveMapping(empty(), bindings, () => crypto.randomUUID()), projected = inverse.projectContent(c.id, decoded)
  if (projected.kind !== 'conversation') throw new Error('conversation')
  expect(() => canonicalSyncJSON(projected.conversation)).toThrow('limit') // local is intentionally larger than wire
  const witness = localSyncConversationWitness(projected.conversation)
  expect(localSyncConversationWitness(projectLocalSyncConversation(projected.conversation))).toBe(witness)
  const captured = createSyncCaptureMapping(inverse.bindings).conversation(projected.conversation)
  expect(await encodeSyncContent('conversation', captured).text()).toBe(await payload.text())
})
