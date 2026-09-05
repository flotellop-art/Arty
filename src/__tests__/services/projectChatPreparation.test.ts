import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, Message } from '../../types'
import type { Project } from '../../services/projects/types'
const mocks = vi.hoisted(() => ({ getProject: vi.fn(), readText: vi.fn(), begin: vi.fn(), fence: vi.fn(), getConversation: vi.fn(), getFile: vi.fn() }))
vi.mock('../../services/projects/store', () => ({ beginProjectOperation: mocks.begin, getProject: mocks.getProject, readProjectDocumentText: mocks.readText, assertProjectOperation: mocks.fence }))
vi.mock('../../services/storage', () => ({ getConversation: mocks.getConversation }))
vi.mock('../../services/secureFileStorage', () => ({ getFile: mocks.getFile }))
import { prepareProjectChat, projectPayloadBudget, type ProjectReview, type ReviewProjectRequest } from '../../services/projects/chatPreparation'
import { ProjectError } from '../../services/projects/types'

let conv: Conversation, project: Project
const guard = vi.fn()
function request(messages?: Message[], review?: ReviewProjectRequest) {
  const controller = new AbortController()
  return { args: { conversation: conv, messages: messages ?? [{ id: 'u2', role: 'user' as const, content: 'enduit', timestamp: 2 }], query: 'enduit', provider: conv.euOnly ? 'mistral' as const : 'claude' as const,
    preparation: { owner: 'a', epoch: 1, assertCurrent: guard }, signal: controller.signal,
    review: review ?? vi.fn(async (value: ProjectReview) => value.kind === 'select' ? { mode: 'search' as const, documentIds: ['d1'] } : true) }, controller }
}
beforeEach(() => {
  vi.resetAllMocks()
  conv = { id: 'c1', title: 'Projet', projectId: 'p1', hasProjectContext: true, createdAt: 1, updatedAt: 1, messages: [] }
  project = { schema: 1, id: 'p1', owner: 'a', revision: 1, name: 'Façade', instructions: 'Répondre sobrement.', euOnly: false,
    documents: [{ id: 'd1', name: 'devis.txt', originalName: 'devis.txt', format: 'txt', revision: 1, sourceHash: 'a'.repeat(64), sourceBytes: 30, textChars: 30, extractorVersion: 'arty-project-text-v1', createdAt: 1 }], createdAt: 1, updatedAt: 1 }
  mocks.begin.mockResolvedValue({ owner: 'a', epoch: 1, fence: 'f', assertCurrent: guard })
  mocks.getProject.mockImplementation(async () => ({ id: project.id, revision: project.revision, euOnly: project.euOnly, status: 'ready', project: structuredClone(project) }))
  mocks.getConversation.mockImplementation(() => conv)
  mocks.readText.mockResolvedValue('Enduit de finition\nSurface : 88 m².')
  mocks.fence.mockResolvedValue(undefined)
})

describe('project invocation snapshots — no AI calls', () => {
  it.each(['%%%', btoa(String.fromCharCode(0xe9))])('refuses invalid base64/UTF-8 text before confirmation: %s', async data => {
    const { args } = request([{ id: 'u', role: 'user', content: 'enduit', timestamp: 2, files: [{ id: 'f', name: 'source.txt', type: 'text/plain', data }] }])
    await expect(prepareProjectChat(args)).rejects.toMatchObject({ code: 'corrupt' })
    expect(vi.mocked(args.review).mock.calls).toHaveLength(1)
  })
  it('normalizes JSON and missing legacy image MIME on transient copies only', async () => {
    const files = [{ id: 'j', name: 'source.json', type: 'application/json', data: btoa('{"price":88}') }, { id: 'i', name: 'photo.png', type: 'application/octet-stream', data: 'aGVsbG8=' }]
    const prepared = await prepareProjectChat(request([{ id: 'u', role: 'user', content: 'enduit', timestamp: 2, files }]).args)
    expect(JSON.stringify(prepared.claudeMessages)).toContain('price')
    expect(JSON.stringify(prepared.claudeMessages)).toContain('image/png')
    expect(files[0]?.type).toBe('application/json'); expect(files[1]?.type).toBe('application/octet-stream')
  })
  it('normalizes an explicit PDF MIME alias and refuses an unknown PDF MIME before preview', async () => {
    const file = { id: 'p', name: 'source.pdf', type: 'application/x-pdf', data: btoa('%PDF-test') }
    const messages: Message[] = [{ id: 'u', role: 'user', content: 'enduit', timestamp: 2, files: [file] }]
    const prepared = await prepareProjectChat(request(messages).args)
    expect(JSON.stringify(prepared.claudeMessages)).toContain('application/pdf')
    file.type = 'application/unknown'
    await expect(prepareProjectChat(request(messages).args)).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('allows harmless metadata changes after engagement but not identity/fence changes', async () => {
    const prepared = await prepareProjectChat(request().args)
    conv.messages.push({ id: 'u', role: 'user', content: 'enduit', timestamp: 2, projectTurn: prepared.turn })
    prepared.acceptPersisted(conv); await prepared.beforeFirstRequest()
    conv.title = 'Renommé'; conv.tags = ['rangé']; conv.messages[0]!.pinned = true
    expect(() => prepared.assertCurrent()).not.toThrow()
    guard.mockImplementation(() => { throw new ProjectError('cancelled') })
    expect(() => prepared.assertCurrent()).toThrow(ProjectError)
  })
  it('prepares a neutral prompt and appends sources without losing image/text blocks', async () => {
    const review = vi.fn<ReviewProjectRequest>(async value => value.kind === 'select' ? { mode: 'search', documentIds: ['d1'] } : true)
    const messages: Message[] = [{ id: 'u', role: 'user', content: 'enduit', timestamp: 2, files: [{ id: 'f', name: 'photo.png', type: 'image/png', data: 'aGVsbG8=' }] }]
    const prepared = await prepareProjectChat(request(messages, review).args)
    const payload = JSON.stringify(prepared.claudeMessages)
    expect(payload).toContain('aGVsbG8='); expect(payload).toContain('Enduit de finition')
    expect(messages[0]?.files?.[0]?.name).toBe('photo.png')
    expect(prepared.turn.sources[0]?.sourceHash).toBe('a'.repeat(64))
    expect(JSON.stringify(conv)).not.toContain('Enduit de finition')
    expect(prepared.systemPrompt).toContain('No personal memory')
    expect(review.mock.calls[1]?.[0]).toMatchObject({ kind: 'confirm', provider: 'claude', historyMessages: 0 })
    await expect(prepared.beforeFirstRequest()).rejects.toMatchObject({ code: 'conflict' })
    conv.messages.push({ id: 'new', role: 'user', content: 'enduit', timestamp: 4, projectTurn: prepared.turn })
    prepared.acceptPersisted(conv)
    await prepared.beforeFirstRequest()
  })
  it.each(['source', 'history', 'title', 'tags', 'pin', 'delete'] as const)('invalidates %s changes during the preview, without committing', async change => {
    conv.messages = [{ id: 'old', role: 'user', content: 'Avant', timestamp: 1 }]
    const { args } = request(undefined, async value => {
      if (value.kind === 'select') return { mode: 'search', documentIds: ['d1'] }
      if (change === 'source') project.revision++
      if (change === 'history') conv.messages[0]!.content = 'Après'
      if (change === 'title') conv.title = 'Renommé'
      if (change === 'tags') conv.tags = ['nouveau']
      if (change === 'pin') conv.messages[0]!.pinned = true
      if (change === 'delete') mocks.getConversation.mockReturnValue(null)
      return true
    })
    await expect(prepareProjectChat(args)).rejects.toBeInstanceOf(ProjectError)
    expect(conv.messages).toHaveLength(1)
  })
  it('rejects Stop and identity changes while selecting sources', async () => {
    const { args, controller } = request()
    args.review = async () => { controller.abort(); return { mode: 'search', documentIds: ['d1'] } }
    await expect(prepareProjectChat(args)).rejects.toMatchObject({ code: 'cancelled' })
  })
  it('does not turn no-hit into overview and lets the user cancel the actual preview', async () => {
    mocks.readText.mockResolvedValue('Autre contenu')
    const review = vi.fn<ReviewProjectRequest>(async value => value.kind === 'select' ? { mode: 'search', documentIds: ['d1'] } : false)
    await expect(prepareProjectChat(request(undefined, review).args)).rejects.toMatchObject({ code: 'cancelled' })
    expect(review.mock.calls[1]?.[0]).toMatchObject({ context: { noHit: true, mode: 'search', excerpts: [] } })
  })
  it('detached history remains documentary without reading the library', async () => {
    delete conv.projectId
    const prepared = await prepareProjectChat(request(undefined, async () => true).args)
    expect(mocks.readText).not.toHaveBeenCalled(); expect(prepared.turn.mode).toBe('detached')
    expect(JSON.stringify(prepared.claudeMessages)).toContain('No library attached')
  })
  it('keeps Mistral images and refuses unread PDF history in EU', async () => {
    conv.euOnly = true; project.euOnly = true
    const files = [{ id: 'f', name: 'photo.png', type: 'image/png', data: 'aGVsbG8=' }]
    const prepared = await prepareProjectChat(request([{ id: 'u', role: 'user', content: 'enduit', timestamp: 2, files }]).args)
    expect(JSON.stringify(prepared.mistralMessages)).toContain('image_url')
    files[0]!.name = 'source.pdf'; files[0]!.type = 'application/pdf'
    await expect(prepareProjectChat(request([{ id: 'u', role: 'user', content: 'enduit', timestamp: 2, files }]).args)).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('refuses a missing historical asset rather than a successful placeholder', async () => {
    mocks.getFile.mockResolvedValue(null)
    const files = [{ id: 'missing', name: 'source.txt', type: 'text/plain' }]
    await expect(prepareProjectChat(request([{ id: 'u', role: 'user', content: 'enduit', timestamp: 2, files }]).args)).rejects.toMatchObject({ code: 'unavailable' })
  })
  it('revalidates after confirmation and again at the first HTTP dispatch', async () => {
    const prepared = await prepareProjectChat(request().args)
    conv.messages.push({ id: 'u', role: 'user', content: 'enduit', timestamp: 2, projectTurn: prepared.turn })
    prepared.acceptPersisted(conv); project.revision++
    await expect(prepared.beforeFirstRequest()).rejects.toMatchObject({ code: 'conflict' })
  })
  it('counts data URLs inside text as text, not as binary', () => {
    expect(() => projectPayloadBudget([{ role: 'user', content: [{ type: 'text', text: 'data:text/plain;base64,' + 'A'.repeat(600_000) }] }], 'SP')).toThrow(ProjectError)
    expect(projectPayloadBudget([{ type: 'image', source: { type: 'base64', data: 'A'.repeat(600_000) } }], 'SP').binaryBytes).toBe(450_000)
  })
  it('rejects aggregate history + instructions even when each source fits its own limit', async () => {
    const messages: Message[] = [{ id: 'u', role: 'user', content: 'a'.repeat(169_000), timestamp: 2 }]
    await expect(prepareProjectChat(request(messages).args)).rejects.toMatchObject({ code: 'limit' })
  })
})
