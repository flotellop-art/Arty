/** @vitest-environment node */
import { expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
import type { ReceivedSyncChain } from '../../services/workspaceSync/reception'
import { planExistingSyncUpdate } from '../../services/workspaceSync/existingUpdatePlan'
import { reviewReceivedSyncContent } from '../../services/workspaceSync/receivedContent'
import { encodeSyncContent } from '../../services/workspaceSync/captureContent'
import { createSyncReceiveMapping } from '../../services/workspaceSync/receiveMapping'
import { createSyncCaptureMapping } from '../../services/workspaceSync/captureMapping'
import { parseSyncManifest } from '../../services/workspaceSync/schema'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const baseChat = (): Conversation => ({ id: id(10), title: 'Before', createdAt: 0, updatedAt: 1, euOnly: false, projectId: id(30),
  hasProjectContext: true, hasGoogleData: true, outputRestriction: 'client-reply-draft-v1',
  messages: [{ id: id(11), role: 'user', content: 'Q', timestamp: 0 }],
  comparison: { version: 1, groupId: id(40), sourceConversationId: id(41), sourceMessageId: id(42), peerId: id(43),
    questionId: id(11), responseId: id(44), provider: 'mistral', requestedModel: 'old', status: 'done' } })
// A pure planner fixture, NOT proof of a transport, local store or write grant.
async function fixture(edit: (c: Conversation) => void, baseEdit?: (c: Conversation) => void, causal = 'edit', dependency?: string) {
  const c = baseChat(); baseEdit?.(c)
  if (dependency) c.messages[0]!.files = [{ id: id(70), name: 'source', type: '', size: 1 }]
  const before = { conversation: c, galleryAliases: [] }, after = structuredClone(before); after.conversation.title = 'After'; edit(after.conversation)
  const oldBody = encodeSyncContent('conversation', before), newBody = encodeSyncContent('conversation', after)
  const value = async (blob: Blob, payloadId: string) => ({ state: 'live' as const, payloadId,
    sha256: Buffer.from(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())).toString('hex'), bytes: blob.size })
  const empty = parseSyncManifest({ format: 'arty-sync-causal', version: 1, vaultId: id(1), epoch: id(2), records: [] })
  const revision = { id: id(50), intent: 'create', parents: [], value: await value(oldBody, id(51)) }
  const materialized = parseSyncManifest({ ...empty, records: [{ id: c.id, kind: 'conversation', revisions: [revision] }] })
  const current = { id: id(52), intent: causal === 'gap' ? 'create' : 'edit', parents: causal === 'gap' ? [] : [id(50)], value: await value(newBody, id(53)) }
  const remote = parseSyncManifest({ ...empty, records: [{ id: c.id, kind: 'conversation', revisions: causal === 'gap' ? [current] :
    causal === 'conflict' ? [revision, current, { ...current, id: id(54) }] : [revision, current] }] })
  const mapping = createSyncReceiveMapping(empty, [], () => crypto.randomUUID()), payloads = new Map([[id(51), oldBody], [id(53), newBody]])
  if (dependency) {
    const data = { id: id(70), name: 'source', type: '', size: 1, recordedSize: 1, createdAt: 0 }, binary = new Blob(['X'])
    const file = encodeSyncContent('file', data, binary), changed = encodeSyncContent('file', data, new Blob([dependency === 'changed' ? 'Y' : 'X']))
    const beforeFile = { id: id(70), kind: 'file' as const, revisions: [{ id: id(71), intent: 'create' as const, parents: [], value: await value(file, id(73)) }] }
    const next = { id: id(72), intent: 'edit' as const, parents: [id(71)], value: await value(changed, id(74)) }
    materialized.records.push(beforeFile)
    if (dependency !== 'missing') remote.records.push({ ...beforeFile, revisions: dependency === 'unchanged' || dependency === 'local-change' ? beforeFile.revisions :
      dependency === 'conflict' ? [...beforeFile.revisions, next, { ...next, id: id(75) }] : [...beforeFile.revisions, next] })
    payloads.set(id(73), file); payloads.set(id(74), changed)
    mapping.projectContent(id(70), { kind: 'file', data, binary })
  }
  mapping.projectContent(c.id, { kind: 'conversation', data: before })
  const receipt = { signal: new AbortController().signal, manifest: remote, publication: {}, assertCurrent() {}, async validate() {},
    payload(key: string) { const blob = payloads.get(key); if (blob) return blob; throw new Error('missing') } } as unknown as ReceivedSyncChain
  const reviewed = await reviewReceivedSyncContent(receipt), bindings = mapping.bindings
  const plan = await planExistingSyncUpdate({ materialized, bindings, receipt, reviewed })
  return { plan, bindings, materialized, after }
}
it.each(['add-project', 'remove-project', 'replace-project', 'eu', 'restriction', 'private-flag', 'message-delete', 'message-role'])('refuses %s before allocation and preserves all prior mappings', async kind => {
  const f = await fixture(c => {
    if (kind === 'add-project' || kind === 'replace-project') c.projectId = id(31)
    if (kind === 'remove-project') delete c.projectId
    if (kind === 'eu') c.euOnly = true
    if (kind === 'restriction') delete c.outputRestriction
    if (kind === 'private-flag') c.hasGoogleData = false
    if (kind === 'message-delete') c.messages = []
    if (kind === 'message-role') c.messages[0]!.role = 'assistant'
  }, kind === 'add-project' ? c => { delete c.projectId } : undefined)
  const reserve = vi.fn(() => crypto.randomUUID()), result = f.plan.project(() => true, reserve)
  expect(result.projected).toEqual([]); expect(result.bindings).toEqual(f.bindings)
  expect(result.materialized).toEqual(f.materialized); expect(result.retained).toContainEqual({ recordId: id(10), reason: 'unsupported-change' })
  expect(reserve).not.toHaveBeenCalled()
})
it.each(['gap', 'conflict'])('equal contents cannot turn causal %s into a winner', async causal => {
  const f = await fixture(() => {}, undefined, causal), reserve = vi.fn(() => crypto.randomUUID())
  const result = f.plan.project(() => true, reserve)
  expect(result.projected).toEqual([]); expect(reserve).not.toHaveBeenCalled()
  expect(result.retained[0]!.reason).toBe(causal === 'gap' ? 'causal-gap' : 'conflict')
})
it('promotes the previously reserved comparison answer without allocating or changing its physical identity', async () => {
  const f = await fixture(c => { c.messages.push({ id: id(44), role: 'assistant', content: '\uFEFFanswer\r\n\uD800', timestamp: 2, model: 'old' }); c.usedModels = ['old'] })
  const before = f.bindings.find(b => b.logicalId === id(44))!, reserve = vi.fn(() => crypto.randomUUID())
  expect(before.presence).toBe('reference')
  const result = f.plan.project(() => true, reserve), content = result.projected[0]!.content
  expect(content.kind).toBe('conversation'); if (content.kind !== 'conversation') throw new Error('test')
  expect(result.bindings.find(b => b.logicalId === id(44))).toEqual({ ...before, presence: 'embedded' })
  expect(content.conversation.messages[1]!.id).toBe(before.localId); expect(reserve).not.toHaveBeenCalled()
  expect(createSyncCaptureMapping(result.bindings).conversation(content.conversation)).toEqual(f.after)
})
it('all targets locally different produce reasons with no allocation or mapping mutation', async () => {
  const f = await fixture(c => c.messages.push({ id: id(99), role: 'assistant', content: 'new', timestamp: 2 })), reserve = vi.fn(() => crypto.randomUUID())
  const result = f.plan.project(() => false, reserve)
  expect(result.projected).toEqual([]); expect(result.bindings).toEqual(f.bindings); expect(result.materialized).toEqual(f.materialized)
  expect(result.retained[0]!.reason).toBe('local-change'); expect(reserve).not.toHaveBeenCalled()
})
it.each(['unchanged', 'same-bytes-revision', 'changed', 'conflict', 'missing', 'local-change'])('checks strong dependency %s and never advances its materialized revision implicitly', async dependency => {
  const f = await fixture(() => {}, undefined, 'edit', dependency), reserve = vi.fn(() => crypto.randomUUID())
  const result = f.plan.project(target => dependency !== 'local-change' || target !== id(70), reserve)
  const applicable = dependency === 'unchanged' || dependency === 'same-bytes-revision'
  expect(result.projected).toHaveLength(applicable ? 1 : 0); expect(reserve).not.toHaveBeenCalled()
  expect(result.bindings).toEqual(f.bindings)
  expect(result.materialized.records.find(r => r.id === id(70))).toEqual(f.materialized.records.find(r => r.id === id(70)))
  if (!applicable) expect(result.retained).toContainEqual({ recordId: id(10), reason: dependency === 'local-change' ? 'local-change' : 'dependency-change' })
})
