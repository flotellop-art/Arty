import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createSyncCaptureMapping, createSyncReadMapping } from '../../services/workspaceSync/captureMapping'
import { encodeSyncContent } from '../../services/workspaceSync/captureContent'
import type { Conversation } from '../../types'
import type { SyncKind, SyncManifest } from '../../services/workspaceSync/types'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
function fixture() {
  const conversation: Conversation = { id: 'chat', title: '\uFEFFExact\r\n\uD800', createdAt: 1, updatedAt: 2,
    euOnly: true, outputRestriction: 'client-reply-draft-v1', hasProjectContext: true, projectId: 'project',
    messages: [{ id: 'q', role: 'user', content: 'Q', timestamp: 1 }, { id: 'a', role: 'assistant', content: `Text arty-image://${id(51)}`, timestamp: 2,
      pinned: true, restoredArchive: true, generatedImages: [id(50)],
      localSyncProvenance: { version: 1, historicalInjected: true, galleryAliases: [{ fileId: id(50), textId: id(51) }] },
      files: [{ id: 'file', name: 'Source', type: 'text/plain', visionCrop: { kind: 'auto', sourceFileId: 'original', sourceFileIds: ['original'], rect: { x: 0, y: 0, width: 1, height: 1 } } }],
      projectTurn: { version: 1, mode: 'detached', euOnly: true, partial: false, sources: [
        { projectId: 'old-project', projectRevision: 1, documentId: 'doc', documentRevision: 2, sourceHash: 'a'.repeat(64), extractorVersion: 'v1', name: 'Doc', format: 'txt', startLine: 1, endLine: 1, partial: false },
      ] } }],
    comparison: { version: 1, groupId: 'group', sourceConversationId: 'original-chat', sourceMessageId: 'original-q', peerId: 'peer',
      questionId: 'q', responseId: 'a', provider: 'mistral', requestedModel: 'mistral', status: 'done',
      attribution: { model: 'mistral', provider: 'mistral', conversationId: 'chat' } } }
  const capture = createSyncCaptureMapping([]), projected = capture.conversation(conversation)
  const bindings = structuredClone(capture.bindings)
  const head: SyncManifest = { format: 'arty-sync-causal', version: 1, vaultId: id(1), epoch: id(2), records: bindings.filter(b => b.presence === 'record').map((b, i) => ({
    id: b.logicalId, kind: b.kind as SyncKind, revisions: [{ id: id(100 + i), intent: 'create', parents: [], value: { state: 'live', payloadId: id(200 + i), sha256: 'a'.repeat(64), bytes: 1 } }],
  })) }
  return { conversation, projected, bindings, head }
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('uses the identical canonical projector with no allocation, mutation, promotion or private wire provenance', async () => {
  const f = fixture(), before = structuredClone(f), random = vi.spyOn(webcrypto, 'randomUUID')
  const mapping = createSyncReadMapping(f.head, f.bindings), result = mapping.conversation(f.conversation)
  expect(result).toEqual(f.projected)
  expect(new Uint8Array(await encodeSyncContent('conversation', result).arrayBuffer())).toEqual(new Uint8Array(await encodeSyncContent('conversation', f.projected).arrayBuffer()))
  expect(result.conversation.messages[1]).not.toHaveProperty('localSyncProvenance')
  expect(result.conversation.messages[1]).not.toHaveProperty('restoredArchive')
  expect(result.conversation.messages[1].pinned).toBe(true)
  expect(result.conversation.outputRestriction).toBe('client-reply-draft-v1')
  expect(result.galleryAliases[0].textId).toBe(id(51))
  expect(f).toEqual(before); expect(random).not.toHaveBeenCalled()
  expect(Object.isFrozen(mapping)).toBe(true); expect(mapping).not.toHaveProperty('bindings')
})

it.each(['conversation', 'message', 'file', 'project', 'project-source', 'group'])('refuses a missing %s identity without allocating or repairing it', kind => {
  const f = fixture(), selected = f.bindings.find(b => b.kind === kind)!
  const bindings = f.bindings.filter(b => b !== selected), before = structuredClone(bindings), random = vi.spyOn(webcrypto, 'randomUUID')
  expect(() => createSyncReadMapping(f.head, bindings).conversation(f.conversation)).toThrow()
  expect(bindings).toEqual(before); expect(random).not.toHaveBeenCalled()
})

it.each(['conversation', 'message', 'group'])('refuses a reference-to-materialized promotion of %s', kind => {
  const f = fixture(); f.bindings.find(b => b.kind === kind)!.presence = 'reference'
  const before = structuredClone(f.bindings), random = vi.spyOn(webcrypto, 'randomUUID')
  expect(() => createSyncReadMapping(f.head, f.bindings).conversation(f.conversation)).toThrow()
  expect(f.bindings).toEqual(before); expect(random).not.toHaveBeenCalled()
})

it('keeps weak references read-only and does not mistake them for materialized records', () => {
  const f = fixture(), mapping = createSyncReadMapping(f.head, f.bindings), file = f.bindings.find(b => b.localId === 'file')!
  expect(file.presence).toBe('reference')
  expect(mapping.lookup('file', 'file')).toBe(file.logicalId)
  expect(() => mapping.lookup('file', 'file', null, true)).toThrow()
  expect(() => mapping.lookup('file', 'unseen')).toThrow()
  expect(() => mapping.lookup('message', 'a', 'peer', true)).toThrow()
  expect(f.bindings.find(b => b.localId === 'file')!.presence).toBe('reference')
})

it('detaches the mapping and each projected result while preserving the local witness source', () => {
  const f = fixture(), mapping = createSyncReadMapping(f.head, f.bindings), original = structuredClone(f.projected)
  f.bindings[0].logicalId = id(999); f.head.records.length = 0
  const result = mapping.conversation(f.conversation)
  result.conversation.messages[1].content = 'changed'; result.galleryAliases[0].textId = id(999)
  expect(mapping.conversation(f.conversation)).toEqual(original)
  expect(f.conversation.messages[1].localSyncProvenance?.galleryAliases?.[0].textId).toBe(id(51))
})

it.each(['getter', 'duplicate-local', 'duplicate-logical', 'wrong-domain'])('rejects malformed binding %s without running a getter or UUID generator', kind => {
  const f = fixture(), getter = vi.fn(() => 'chat'), random = vi.spyOn(webcrypto, 'randomUUID')
  if (kind === 'getter') Object.defineProperty(f.bindings[0], 'localId', { get: getter, enumerable: true })
  if (kind === 'duplicate-local') f.bindings.push({ ...f.bindings[0], logicalId: id(999) })
  if (kind === 'duplicate-logical') f.bindings[1].logicalId = f.bindings[0].logicalId
  if (kind === 'wrong-domain') f.head.records[0].kind = 'file'
  expect(() => createSyncReadMapping(f.head, f.bindings)).toThrow()
  expect(getter).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled()
})

it.each(['kind-toJSON', 'kind-getter', 'kind-valueOf', 'parent-toJSON', 'boolean-object', 'boolean-number', 'missing-parent', 'unexpected-parent'])('rejects runtime lookup argument %s before coercion or recursion', mode => {
  const f = fixture(), mapping = createSyncReadMapping(f.head, f.bindings), called = vi.fn(() => 'conversation')
  const args: unknown[] = ['conversation', 'chat', null, true]
  if (mode === 'kind-toJSON') args[0] = { toJSON: called }
  if (mode === 'kind-getter') args[0] = Object.defineProperty({}, 'toJSON', { get: called })
  if (mode === 'kind-valueOf') args[0] = { valueOf: called, toString: called }
  if (mode === 'parent-toJSON') { args[0] = 'message'; args[1] = 'a'; args[2] = { toJSON: called } }
  if (mode === 'boolean-object') args[3] = { valueOf: called }
  if (mode === 'boolean-number') args[3] = 1
  if (mode === 'missing-parent') { args[0] = 'message'; args[1] = 'a' }
  if (mode === 'unexpected-parent') args[2] = 'chat'
  const random = vi.spyOn(webcrypto, 'randomUUID')
  expect(() => Reflect.apply(mapping.lookup, null, args)).toThrow()
  expect(called).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled()
})

it('keeps the source/text pair in two distinct domains even with identical physical parent and ID', () => {
  const capture = createSyncCaptureMapping([])
  const source = capture.bind('project-source', 'doc', 'project', true), text = capture.bind('project-text', 'doc', 'project', true)
  const head: SyncManifest = { format: 'arty-sync-causal', version: 1, vaultId: id(1), epoch: id(2), records: [
    { id: source, kind: 'project-source', revisions: [{ id: id(11), intent: 'create', parents: [], value: { state: 'live', payloadId: id(21), bytes: 1, sha256: 'a'.repeat(64) } }] },
    { id: text, kind: 'project-text', revisions: [{ id: id(12), intent: 'create', parents: [], value: { state: 'live', payloadId: id(22), bytes: 1, sha256: 'b'.repeat(64) } }] },
  ] }
  const before = structuredClone(capture.bindings), mapping = createSyncReadMapping(head, capture.bindings), random = vi.spyOn(webcrypto, 'randomUUID')
  expect(mapping.lookup('project-source', 'doc', 'project', true)).toBe(source)
  expect(mapping.lookup('project-text', 'doc', 'project', true)).toBe(text)
  expect(source).not.toBe(text); expect(capture.bindings).toEqual(before); expect(random).not.toHaveBeenCalled()
})
