import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
import type { Project } from '../../services/projects/types'
import { officeFixture } from '../helpers/officeFixture'
const mock = vi.hoisted(() => ({ begin: vi.fn(), getProject: vi.fn(), readText: vi.fn(), fence: vi.fn(), guard: vi.fn() }))
vi.mock('../../services/projects/store', () => ({ beginProjectOperation: mock.begin, getProject: mock.getProject, readProjectDocumentText: mock.readText, assertProjectOperation: mock.fence }))
vi.mock('../../services/storage', () => ({ getConversations: vi.fn(), getConversation: vi.fn(), saveConversation: vi.fn(), isCacheReady: () => true }))
vi.mock('../../services/anthropicClient', () => ({ streamMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/mistralClient', () => ({ streamMistralMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/secureFileStorage', () => ({ getFile: vi.fn(), putFile: vi.fn(async f => f.id), deleteFile: vi.fn(), deleteOwnedFiles: vi.fn(async () => 0) }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: vi.fn(() => 'owner-a'), getActiveSessionEpoch: vi.fn(() => 1), getSessionProjectFence: () => 'initial', PROJECT_ERASURE_FENCE_KEY: 'test-project-fence' }))
vi.mock('../../services/autoMemory', () => ({ maybeExtractMemory: vi.fn() }))
vi.mock('../../services/pdfUrlFetch', () => ({ fetchPdfMarkdowns: vi.fn(), fetchUrlMarkdowns: vi.fn() }))
vi.mock('../../services/factChecker', () => ({ clearSearchContext: vi.fn(), getFactCheckMode: () => 'off', runFactCheckOnLatest: vi.fn() }))
vi.mock('../../services/taskService', () => ({ detectSuggestedTasks: vi.fn(() => []), addTask: vi.fn() }))
vi.mock('../../services/reminderService', () => ({ detectReminderIntent: vi.fn(), createReminder: vi.fn() }))
vi.mock('../../services/router/notifyRouteOverrides', () => ({ notifyRouteOverrides: vi.fn() }))
vi.mock('../../services/router/gatherRouteInput', async original => {
  const actual = await original<typeof import('../../services/router/gatherRouteInput')>()
  return { ...actual, gatherRouteInput: vi.fn(ctx => ({ ...ctx, selectedModel: 'openai', availability: { claude: true, mistral: true, gemini: true, openai: true, openaiVision: true },
    plan: { plan: 'vip', isPro: false, creditsCoverPremium: false }, reflectionLevel: 'auto', visionOpenAIEnabled: true, visionAutoRoutingEnabled: true })) }
})
import * as storage from '../../services/storage'
import { getFile } from '../../services/secureFileStorage'
import { getActiveSessionEpoch } from '../../services/userSession'
import { streamMessage } from '../../services/anthropicClient'
import { streamMistralMessage } from '../../services/mistralClient'
import { useConversation } from '../../hooks/useConversation'
import { runFactCheckOnLatest } from '../../services/factChecker'
import { maybeExtractMemory } from '../../services/autoMemory'
import { detectReminderIntent } from '../../services/reminderService'
import { gatherRouteInput } from '../../services/router/gatherRouteInput'

let conv: Conversation, project: Project
beforeEach(() => {
  vi.clearAllMocks(); mock.guard.mockReset(); mock.fence.mockResolvedValue(undefined)
  vi.mocked(getActiveSessionEpoch).mockReturnValue(1)
  conv = { id: 'c1', title: 'Projet', projectId: 'p1', hasProjectContext: true, messages: [], createdAt: 1, updatedAt: 1 }
  project = { id: 'p1', owner: 'owner-a', schema: 1, revision: 1, name: 'Chantier', euOnly: false, instructions: 'Sois précis.', createdAt: 1, updatedAt: 1,
    documents: [{ id: 'd1', name: 'devis.txt', originalName: 'devis.txt', format: 'txt', revision: 1, sourceHash: 'a'.repeat(64), sourceBytes: 20, textChars: 20, extractorVersion: 'arty-project-text-v1', createdAt: 1 }] }
  mock.begin.mockResolvedValue({ owner: 'owner-a', epoch: 1, fence: 'f', assertCurrent: mock.guard })
  mock.getProject.mockImplementation(async () => ({ id: project.id, revision: project.revision, euOnly: project.euOnly, status: 'ready', project: structuredClone(project) }))
  mock.readText.mockResolvedValue('Enduit vérifié : surface 88 m².')
  vi.mocked(storage.getConversation).mockImplementation(id => id === conv?.id ? conv : null)
  vi.mocked(storage.getConversations).mockImplementation(() => conv ? [conv] : [])
  vi.mocked(storage.saveConversation).mockImplementation(value => { conv = value })
  vi.mocked(getFile).mockResolvedValue(null)
})
afterEach(() => vi.restoreAllMocks())
const setup = () => {
  const hook = renderHook(() => useConversation())
  act(() => hook.result.current.selectConversation('c1'))
  return hook
}
type Hook = ReturnType<typeof setup>
async function answer(hook: Hook, kind: 'select' | 'confirm', ok = true) {
  await waitFor(() => expect(hook.result.current.projectReview.request?.kind).toBe(kind))
  const current = hook.result.current.projectReview.request!
  act(() => hook.result.current.projectReview.answer(current.reviewId, ok ? kind === 'select' ? { mode: 'search', documentIds: ['d1'] } : true : null))
}
describe('project chat end-to-end hook with local fake providers', () => {
  it('does not resurrect an empty conversation deleted while association is awaiting the library', async () => {
    const hook = setup()
    let resume!: (value: unknown) => void
    mock.getProject.mockReturnValueOnce(new Promise(resolve => { resume = resolve }))
    let pending!: Promise<string | null>
    act(() => { pending = hook.result.current.setConversationProject('c1', project) })
    await waitFor(() => expect(resume).toBeTypeOf('function'))
    expect(hook.result.current.isConversationBusy('c1')).toBe(true)
    expect(hook.result.current.isConversationBusy('other')).toBe(false)
    vi.mocked(storage.getConversation).mockReturnValue(null)
    await act(async () => { resume({ id: project.id, revision: 1, status: 'ready', project }); expect(await pending).toBeNull() })
    expect(hook.result.current.isConversationBusy('c1')).toBe(false)
    expect(storage.saveConversation).not.toHaveBeenCalled(); hook.unmount()
  })
  it('keeps a failed association immutable when local storage is full', async () => {
    const original = structuredClone(conv), hook = setup()
    vi.mocked(storage.saveConversation).mockImplementationOnce(() => { throw new Error('quota') })
    await act(async () => expect(await hook.result.current.setConversationProject('c1', null)).toBeNull())
    expect(conv).toEqual(original); hook.unmount()
  })
  it('allows rename and pin after engagement without losing the answer or metadata', async () => {
    const hook = setup(); let pending!: Promise<boolean>
    act(() => { pending = hook.result.current.sendMessage('enduit') })
    await answer(hook, 'select'); await answer(hook, 'confirm'); await act(async () => { await pending })
    const call = vi.mocked(streamMessage).mock.calls[0]!
    await act(async () => { await call[4]?.beforeDocumentRequest?.() })
    act(() => { hook.result.current.renameConversation('c1', 'Rangé'); hook.result.current.togglePinMessage('c1', conv.messages[0]!.id) })
    act(() => { call[1]('Réponse conservée'); call[2]() })
    expect(conv.title).toBe('Rangé'); expect(conv.messages[0]?.pinned).toBe(true)
    expect(conv.messages.at(-1)?.content).toBe('Réponse conservée'); hook.unmount()
  })
  it('keeps history and composer uncommitted until agreement; supplies per-turn provenance', async () => {
    const hook = setup(); let pending!: Promise<boolean>
    act(() => { pending = hook.result.current.sendMessage('enduit') })
    await answer(hook, 'select')
    await waitFor(() => expect(hook.result.current.projectReview.request?.kind).toBe('confirm'))
    expect(conv.messages).toHaveLength(0); expect(streamMessage).not.toHaveBeenCalled()
    await answer(hook, 'confirm')
    await act(async () => expect(await pending).toBe(true))
    const call = vi.mocked(streamMessage).mock.calls[0]!
    expect(call[4]).toMatchObject({ documentReadOnly: true, tools: [] })
    expect(call[4]?.systemPrompt).toContain('No personal memory')
    expect(JSON.stringify(call[0])).toContain('Enduit vérifié')
    expect(JSON.stringify(conv)).not.toContain('Enduit vérifié')
    act(() => { call[1]('Réponse [S1]'); call[2]() })
    expect(conv.messages.at(-1)?.projectTurn?.sources[0]?.sourceHash).toBe('a'.repeat(64))
    expect(maybeExtractMemory).not.toHaveBeenCalled(); expect(runFactCheckOnLatest).not.toHaveBeenCalled()
    hook.unmount()
  })
  it('cancels a retry without truncating the original history', async () => {
    conv.messages = [{ id: 'u1', role: 'user', content: 'enduit', timestamp: 1 }, { id: 'a1', role: 'assistant', content: 'Ancienne réponse', timestamp: 2 }]
    const original = structuredClone(conv.messages), hook = setup()
    act(() => hook.result.current.retryMessage('a1'))
    await answer(hook, 'select'); await answer(hook, 'confirm', false)
    await waitFor(() => expect(hook.result.current.isStreaming).toBe(false))
    expect(conv.messages).toEqual(original); expect(streamMessage).not.toHaveBeenCalled(); hook.unmount()
  })
  it('bypasses the early local reminder shortcut for a project with no new attachment', async () => {
    const hook = setup(); let pending!: Promise<boolean>
    act(() => { pending = hook.result.current.sendMessage('rappelle-moi mardi de lire cet enduit') })
    await answer(hook, 'select', false); await act(async () => expect(await pending).toBe(false))
    expect(detectReminderIntent).not.toHaveBeenCalled(); hook.unmount()
  })
  it('preserves historical Office text and a current image without a second extraction', async () => {
    const office = officeFixture(), { data: _base64, ...ref } = office
    conv.messages = [{ id: 'old', role: 'user', content: 'Avant', timestamp: 1, files: [ref] }]
    vi.mocked(getFile).mockResolvedValue(office)
    const hook = setup(); let pending!: Promise<boolean>
    act(() => { pending = hook.result.current.sendMessage('enduit', 'c1', [{ id: 'image', name: 'photo.png', type: 'image/png', data: 'aGVsbG8=' }]) })
    await answer(hook, 'select'); await answer(hook, 'confirm'); await act(async () => { await pending })
    const payload = JSON.stringify(vi.mocked(streamMessage).mock.calls[0]?.[0])
    expect(payload).toContain('aGVsbG8='); expect(payload).toContain('UNTRUSTED DOCUMENT DATA'); expect(payload).toContain('Enduit vérifié')
    expect(vi.mocked(getFile).mock.calls.filter(([id]) => id === office.id)).toHaveLength(1)
    hook.unmount()
  })
  it.each(['epoch', 'fence'] as const)('invalidates %s during a stream, with no late partial or final write', async change => {
    const hook = setup(); let pending!: Promise<boolean>
    act(() => { pending = hook.result.current.sendMessage('enduit') })
    await answer(hook, 'select'); await answer(hook, 'confirm'); await act(async () => { await pending })
    const call = vi.mocked(streamMessage).mock.calls[0]!
    act(() => call[1]('Avant'))
    if (change === 'epoch') vi.mocked(getActiveSessionEpoch).mockReturnValue(2)
    else mock.guard.mockImplementation(() => { throw new Error('rotated') })
    const saves = vi.mocked(storage.saveConversation).mock.calls.length
    act(() => { call[1]('APRÈS'); call[2](); window.dispatchEvent(new Event('beforeunload')) })
    expect(vi.mocked(storage.saveConversation).mock.calls.length).toBe(saves)
    expect(JSON.stringify(conv)).not.toContain('APRÈS'); hook.unmount()
  })
  it('persists source references on partial responses too', async () => {
    const hook = setup(); let pending!: Promise<boolean>
    act(() => { pending = hook.result.current.sendMessage('enduit') })
    await answer(hook, 'select'); await answer(hook, 'confirm'); await act(async () => { await pending })
    act(() => { vi.mocked(streamMessage).mock.calls[0]![1]('Partiel [S1]'); window.dispatchEvent(new Event('beforeunload')) })
    expect(conv.messages.at(-1)).toMatchObject({ id: 'streaming', projectTurn: { sources: [expect.objectContaining({ name: 'devis.txt' })] } })
    hook.unmount()
  })
  it('blocks EU without Mistral before preview or history commit', async () => {
    conv.euOnly = true; project.euOnly = true
    const original = vi.mocked(gatherRouteInput).getMockImplementation()!
    vi.mocked(gatherRouteInput).mockImplementationOnce(ctx => ({ ...original(ctx), availability: { ...original(ctx).availability, mistral: false } }))
    const hook = setup()
    await act(async () => expect(await hook.result.current.sendMessage('enduit')).toBe(false))
    expect(conv.messages).toHaveLength(0); expect(streamMistralMessage).not.toHaveBeenCalled(); hook.unmount()
  })
})
