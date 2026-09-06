import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
import type { Project } from '../../services/projects/types'
import type { PanelConfig } from '../../services/comparator/providerCatalog'
import type { ReviewProjectRequest } from '../../services/projects/chatPreparation'
import producerFixtures from '../helpers/office-producer-fixtures.json'

const state = vi.hoisted(() => ({ owner: 'a', epoch: 1, available: true, getFile: vi.fn(), deleteFiles: vi.fn(), project: vi.fn(), text: vi.fn() }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => state.owner, getActiveSessionEpoch: () => state.epoch }))
vi.mock('../../services/secureFileStorage', () => ({ getFile: state.getFile, deleteOwnedFiles: state.deleteFiles }))
vi.mock('../../services/projects/store', () => {
  const captureLocalReadScope = (signal?: AbortSignal) => {
    const owner = state.owner, epoch = state.epoch
    const assertCurrent = () => {
      if (!state.available || signal?.aborted || state.owner !== owner || state.epoch !== epoch) throw new Error('Scope cancelled')
    }
    assertCurrent(); return { owner, epoch, assertCurrent }
  }
  return { captureLocalReadScope, beginProjectOperation: async () => captureLocalReadScope(),
    assertProjectOperation: async (op: { assertCurrent(): void }) => op.assertCurrent(),
    getProject: state.project, readProjectDocumentText: state.text }
})
import * as storage from '../../services/storage'
import { captureContextualComparison } from '../../services/comparator/contextualPreparation'
import { buildConversationJsonExport, importConversationFromFile } from '../../services/conversationExport'
import { mapCapturedConversation } from '../../services/workspaceBackup/captureMapping'

const panels = (eu = false): PanelConfig[] => eu
  ? [{ id: '1', provider: 'mistral', modelId: 'mistral-medium-latest' }, { id: '2', provider: 'mistral', modelId: 'mistral-small-2603' }]
  : [{ id: '1', provider: 'anthropic', modelId: 'claude-haiku-4-5' }, { id: '2', provider: 'anthropic', modelId: 'claude-sonnet-5' }]
let source: Conversation, project: Project
const review = vi.fn<ReviewProjectRequest>(async r => r.kind === 'select' ? { mode: 'overview', documentIds: r.project.documents.map(d => d.id) } : true)
const access = vi.fn<(_: PanelConfig) => string | null>(() => null)
function capture(signal = new AbortController().signal) {
  return captureContextualComparison({ sourceId: source.id, messageId: 'q', signal, isBusy: () => false, getAccess: access })
}
function attachOffice() {
  source.messages[0]!.files = [{ id: 'office', name: 'devis.docx', type: 'application/octet-stream' }]
  storage.saveConversation(source)
  state.getFile.mockResolvedValue({ id: 'office', name: 'devis.docx', type: '', data: producerFixtures.docx })
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear(); storage.resetConversationMemCache()
  localStorage.setItem('arty-conv-encryption-disabled', '1')
  state.owner = 'a'; state.epoch = 1; state.available = true
  access.mockReturnValue(null); review.mockImplementation(async r => r.kind === 'select' ? { mode: 'overview', documentIds: r.project.documents.map(d => d.id) } : true)
  source = { id: 'source', title: 'Travail', createdAt: 1, updatedAt: 1,
    messages: [{ id: 'q', role: 'user', content: 'Quel enduit ?', timestamp: 1 }, { id: 'answer', role: 'assistant', content: 'Réponse originale à ne pas envoyer', timestamp: 2 }] }
  storage.saveConversation(source)
  project = { schema: 1, id: 'project', owner: 'a', revision: 3, name: 'Façade', instructions: 'Réponds sobrement', euOnly: false,
    documents: [1, 2].map(n => ({ id: `doc${n}`, name: `Source${n}.txt`, originalName: `Source${n}.txt`, revision: 1, format: 'txt', sourceHash: String(n).repeat(64), sourceBytes: 100, textChars: 100, extractorVersion: 'arty-project-text-v1', createdAt: 1 })), createdAt: 1, updatedAt: 3 }
  state.project.mockImplementation(async () => ({ status: 'ready', project: structuredClone(project), revision: project.revision, euOnly: project.euOnly }))
  state.text.mockImplementation(async (_op, _p, id) => `Enduit document ${id} : 88 m²`)
  state.getFile.mockResolvedValue(null); state.deleteFiles.mockResolvedValue(0)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Preparation must not use HTTP') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Contextual comparison preparation and durable reservation, no streams yet', () => {
  it.each(['pending', 'legacy', 'completed', 'restored'] as const)('copies %s fact-check history without orphaning an active job', async mode => {
    source.messages.unshift({ id: 'history', role: 'assistant', content: 'Préfixe avant la question', timestamp: 0,
      ...(mode === 'restored' ? { restoredArchive: true as const } : {}),
      factCheck: { overallConfidence: 'medium', claims: [], checkedAt: 1,
        modelLabel: mode === 'legacy' ? 'Vérification en cours…' : 'Vérification',
        ...(mode === 'legacy' ? {} : { status: mode === 'completed' ? 'success-empty' as const : 'pending' as const }) } })
    storage.saveConversation(source)
    const before = JSON.stringify(source), prepared = await capture().prepare(panels(), review)
    prepared.commit()
    const first = storage.getConversation(prepared.branchIds[0])!
    expect(first.messages[0]?.factCheck !== undefined).toBe(mode === 'completed' || mode === 'restored')
    expect(JSON.stringify(storage.getConversation(source.id))).toBe(before)
  })
  it.each([null, undefined, {}, 'bad'])('refuses a malformed present gallery before preparation: %s', value => {
    Object.defineProperty(source.messages[0], 'generatedImages', { value, enumerable: true })
    expect(() => capture()).toThrow()
    expect(review).not.toHaveBeenCalled(); expect(state.getFile).not.toHaveBeenCalled()
    expect(storage.getConversations()).toHaveLength(1)
  })
  it('refuses an unrelated new turn appended to a reserved branch before HTTP', async () => {
    const prepared = await capture().prepare(panels(), review); prepared.commit()
    const request = prepared.takeRequest(0)
    storage.getConversation(request.branchId)!.messages.push({ id: 'other', role: 'user', content: 'Question non approuvée', timestamp: 3 })
    await expect(request.beforeRequest()).rejects.toMatchObject({ code: 'conflict' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('compares the first question, reserves two independent branches and never edits the original', async () => {
    const before = JSON.stringify(source), prepared = await capture().prepare(panels(), review)
    expect(storage.getConversations()).toHaveLength(1)
    expect(() => prepared.takeRequest(0)).toThrow()
    prepared.commit()
    expect(storage.getConversations()).toHaveLength(3)
    const a = storage.getConversation(prepared.branchIds[0])!, b = storage.getConversation(prepared.branchIds[1])!
    expect(a.messages).toHaveLength(1); expect(b.messages).toHaveLength(1)
    expect(a.messages[0]!.id).not.toBe(b.messages[0]!.id)
    expect(a.comparison).toMatchObject({ groupId: prepared.groupId, peerId: b.id, status: 'pending' })
    expect(a.hasProjectContext).toBe(true); expect(a.messages[0]?.projectTurn?.mode).toBe('detached')
    expect(JSON.stringify(storage.getConversation(source.id))).toBe(before)
    const first = prepared.takeRequest(0), second = prepared.takeRequest(1)
    expect(first.claudeMessages).toEqual(second.claudeMessages)
    expect(first.claudeMessages).not.toBe(second.claudeMessages)
    first.claudeMessages![0]!.content = 'Client-local mutation'
    expect(JSON.stringify(second.claudeMessages)).not.toMatch(/Client-local|Réponse originale/)
    await first.beforeRequest(); await second.beforeRequest()
    expect(() => prepared.takeRequest(0)).toThrow(); expect(() => prepared.commit()).toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('hydrates Office once and selects one current project context for both typed requests', async () => {
    attachOffice(); source.projectId = project.id; source.hasGoogleData = true; storage.saveConversation(source)
    const before = JSON.stringify(source), prepared = await capture().prepare(panels(), review)
    prepared.commit()
    const a = prepared.takeRequest(0), b = prepared.takeRequest(1)
    expect(state.getFile).toHaveBeenCalledExactlyOnceWith('office', 'a')
    expect(state.text).toHaveBeenCalledTimes(2)
    expect(review.mock.calls.filter(([r]) => r.kind === 'confirm')).toHaveLength(1)
    expect(review.mock.calls.at(-1)![0]).toMatchObject({ comparisonModels: ['Claude Haiku 4.5', 'Claude Sonnet 5'], context: { projectRevision: 3 } })
    expect(a.claudeMessages).toEqual(b.claudeMessages); expect(a.systemPrompt).toBe(b.systemPrompt)
    const wire = JSON.stringify(a.claudeMessages)
    expect(wire).toContain('Facture synthétique : 1250 €'); expect(wire).toContain('Enduit document doc2')
    expect(a.systemPrompt).toContain('Réponds sobrement'); expect(a.systemPrompt).toContain('No personal memory')
    expect(JSON.stringify(storage.getConversations())).not.toContain(producerFixtures.docx)
    expect(JSON.stringify(storage.getConversations())).not.toContain('Enduit document')
    expect(JSON.stringify(storage.getConversation(source.id))).toBe(before)
    storage.deleteConversation(source.id); storage.deleteConversation(a.branchId)
    expect(storage.getConversation(b.branchId)?.messages[0]?.files?.[0]?.id).toBe('office')
    expect([...state.deleteFiles.mock.calls[0]![0]]).not.toContain('office')
    expect([...state.deleteFiles.mock.calls[1]![0]]).not.toContain('office')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['EU', 'private', 'detachedEU'] as const)('retains %s constraints rather than forcing two providers', async kind => {
    if (kind === 'EU') source.euOnly = true
    if (kind === 'private') source.hasGoogleData = true
    if (kind === 'detachedEU') source.messages[1]!.projectTurn = { version: 1, euOnly: true, mode: 'detached', partial: false, sources: [] }
    storage.saveConversation(source)
    const actor = capture(), eu = kind !== 'private'
    expect(actor.provider).toBe(eu ? 'mistral' : 'anthropic')
    const prepared = await actor.prepare(panels(eu), review); prepared.commit()
    const request = prepared.takeRequest(0)
    expect(eu ? request.mistralMessages : request.claudeMessages).toBeDefined()
    expect(eu ? request.claudeMessages : request.mistralMessages).toBeUndefined()
    expect(storage.getConversation(request.branchId)?.euOnly).toBe(eu)
  })

  it.each(['provider', 'duplicate', 'alias', 'unknown', 'one'] as const)('rejects %s configurations before reading files or confirming', async kind => {
    const selected = panels()
    if (kind === 'provider') selected[1] = panels(true)[1]!
    if (kind === 'duplicate') selected[1] = { ...selected[0]!, id: '2' }
    if (kind === 'alias') selected[1] = { ...selected[0]!, modelId: 'claude-haiku-4-5-20251001' }
    if (kind === 'unknown') selected[1]!.modelId = 'imaginary'
    if (kind === 'one') selected.pop()
    await expect(capture().prepare(selected, review)).rejects.toMatchObject({ code: 'unsupported' })
    expect(review).not.toHaveBeenCalled(); expect(state.getFile).not.toHaveBeenCalled(); expect(storage.getConversations()).toHaveLength(1)
  })

  it.each(['inline', 'gallery', 'EU-image', 'missing', 'corrupt'] as const)('never silently omits %s source bytes', async kind => {
    source.messages[0]!.files = [{ id: 'f', name: kind === 'EU-image' ? 'image.png' : 'source.txt', type: '' }]
    if (kind === 'inline') source.messages[0]!.files![0]!.data = 'aGVsbG8='
    if (kind === 'gallery') source.messages[0]!.generatedImages = ['123e4567-e89b-12d3-a456-426614174000']
    if (kind === 'EU-image') source.euOnly = true
    if (kind === 'corrupt') state.getFile.mockResolvedValue({ data: '%%%' })
    storage.saveConversation(source)
    await expect((async () => capture().prepare(panels(!!source.euOnly), review))()).rejects.toThrow()
    expect(review).not.toHaveBeenCalled(); expect(storage.getConversations()).toHaveLength(1)
  })

  it.each(['content', 'file', 'project', 'switch', 'aba', 'scope', 'stop', 'access'] as const)('refuses %s changed during consent before insertion', async kind => {
    attachOffice(); source.projectId = project.id; storage.saveConversation(source)
    const controller = new AbortController(), actor = capture(controller.signal)
    review.mockImplementation(async r => {
      if (r.kind === 'select') return { mode: 'overview', documentIds: ['doc1'] }
      if (kind === 'content') source.messages[0]!.content = 'Other question'
      if (kind === 'file') source.messages[0]!.files![0]!.name = 'different.docx'
      if (kind === 'project') project.revision++
      if (kind === 'switch') state.owner = 'b'
      if (kind === 'aba') state.epoch = 3
      if (kind === 'scope') state.available = false
      if (kind === 'stop') controller.abort()
      if (kind === 'access') access.mockReturnValue('compare.access.plan')
      return true
    })
    await expect(actor.prepare(panels(), review)).rejects.toThrow()
    expect(localStorage.getItem('arty-a-conversations')).not.toContain('groupId')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['branch', 'project', 'aba', 'scope', 'access'] as const)('revalidates %s after reservation at the post-auth gate', async kind => {
    source.projectId = project.id; storage.saveConversation(source)
    const prepared = await capture().prepare(panels(), review); prepared.commit()
    const request = prepared.takeRequest(0)
    if (kind === 'branch') storage.getConversation(request.branchId)!.messages[0]!.content = 'Not confirmed'
    if (kind === 'project') project.revision++
    if (kind === 'aba') state.epoch = 3
    if (kind === 'scope') state.available = false
    if (kind === 'access') access.mockReturnValue('compare.access.plan')
    await expect(request.beforeRequest()).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled()
  })

  it('does not insert branches after scope invalidation between prepare and commit', async () => {
    const prepared = await capture().prepare(panels(), review)
    state.epoch = 3
    expect(() => prepared.commit()).toThrow()
    expect(localStorage.getItem('arty-a-conversations')).not.toContain('groupId')
  })

  it('exports/imports an inert branch without foreign group/navigation authority; backup is branch-only', async () => {
    const prepared = await capture().prepare(panels(), review); prepared.commit()
    const branch = storage.getConversation(prepared.branchIds[0])!, exported = buildConversationJsonExport(branch)
    expect(exported.conversation).not.toHaveProperty('comparison')
    const captured = mapCapturedConversation(branch)
    expect(captured).not.toHaveProperty('comparison'); expect(captured.hasProjectContext).toBe(true)
    const id = await importConversationFromFile({ size: 100, text: async () => JSON.stringify({ conversation: branch }) } as File)
    expect(storage.getConversation(id)).not.toHaveProperty('comparison')
    expect(storage.getConversation(id)?.hasProjectContext).toBe(true)
  })
})
