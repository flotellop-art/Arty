import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
const mocks = vi.hoisted(() => ({ token: vi.fn(), fetch: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: mocks.token, isTokenValid: () => false, getGoogleEmail: () => null }))
vi.mock('../../services/activeApiKey', () => ({ getOpenAIKey: () => 'synthetic-key', getActiveApiKey: () => 'synthetic-key' }))
vi.mock('../../services/imageCompression', () => ({ compressImageIfNeeded: async (data: string, mimeType: string) => ({ data, mimeType, size: 68 }) }))
vi.mock('../../services/storage', async original => ({ ...await original<typeof import('../../services/storage')>(), getConversations: vi.fn(), getConversation: vi.fn(), saveConversation: vi.fn(), isCacheReady: () => true }))
vi.mock('../../services/anthropicClient', () => ({ streamMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/autoMemory', () => ({ maybeExtractMemory: vi.fn() }))
vi.mock('../../services/pdfUrlFetch', () => ({ fetchPdfMarkdowns: vi.fn(async () => ''), fetchUrlMarkdowns: vi.fn(async () => ({ block: '', unreadable: [] })) }))
vi.mock('../../services/factChecker', () => ({ clearSearchContext: vi.fn(), getFactCheckMode: () => 'off', runFactCheckOnLatest: vi.fn() }))
vi.mock('../../services/taskService', () => ({ detectSuggestedTasks: vi.fn(() => []), addTask: vi.fn() }))
vi.mock('../../services/reminderService', () => ({ detectReminderIntent: vi.fn(() => null), createReminder: vi.fn() }))
vi.mock('../../services/router/notifyRouteOverrides', () => ({ notifyRouteOverrides: vi.fn() }))
vi.mock('../../services/router/gatherRouteInput', async original => ({
  ...await original<typeof import('../../services/router/gatherRouteInput')>(),
  gatherRouteInput: (ctx: object) => ({ ...ctx, selectedModel: 'claude', availability: { claude: true, mistral: true, gemini: true, openai: true },
    plan: { plan: 'vip', isPro: false, creditsCoverPremium: false }, reflectionLevel: 'auto' }),
}))
import * as storage from '../../services/storage'
import * as users from '../../services/userSession'
import * as cryptoService from '../../services/crypto'
import { streamMessage } from '../../services/anthropicClient'
import { createToolExecutor } from '../../services/toolExecutor'
import { useConversation } from '../../hooks/useConversation'
import * as fileStorage from '../../services/secureFileStorage'
import { detectReminderIntent, createReminder } from '../../services/reminderService'
const session = { userId: 'a', authMethod: 'google' as const, displayName: 'Synthetic A', createdAt: 1 }
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(r => { resolve = r }), resolve: (value: T) => resolve(value) } }
let conv: Conversation
let conversations: Map<string, Conversation>
beforeEach(async () => {
  // Modules keep an open project DB, as the real app does across sessions.
  vi.clearAllMocks(); localStorage.clear()
  vi.mocked(detectReminderIntent).mockReturnValue(null)
  users.setActiveSession(session); await cryptoService.initCrypto('synthetic-key')
  // Keep the module's cached IDB handle, reset only the synthetic fence.
  const { beginProjectOperation } = await import('../../services/projects/store')
  try { await beginProjectOperation() } catch { /* previous test deliberately changed the durable fence */ }
  const db = await openDB('arty-projects', 1); await db.delete('meta', 'erasure-fence'); db.close()
  conv = { id: 'c1', title: 'Synthetic image', messages: [], createdAt: 1, updatedAt: 1 }
  conversations = new Map([[conv.id, conv]])
  vi.mocked(storage.getConversations).mockImplementation(() => [...conversations.values()])
  vi.mocked(storage.getConversation).mockImplementation(id => conversations.get(id) ?? null)
  vi.mocked(storage.saveConversation).mockImplementation(saved => { conversations.set(saved.id, saved); if (saved.id === 'c1') conv = saved })
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('image cancellation — real hook, dispatcher, handler, crypto, IDB; network simulated', () => {
  const imageId = '123e4567-e89b-12d3-a456-426614174000'
  function setupReceipt(handler = vi.fn(async () => ({ result: 'Image reçue', localImageId: imageId }))) {
    const onNavigate = vi.fn()
    const hook = renderHook(() => useConversation({ onNavigate }))
    act(() => { hook.result.current.selectConversation(conv.id); hook.result.current.setToolHandler(handler) })
    return { ...hook, handler, onNavigate }
  }

  it.each(['done', 'stop', 'error'] as const)('keeps an image-only receipt on %s before any provider caption', async ending => {
    const { result, unmount } = setupReceipt()
    await act(async () => { await result.current.sendMessage('génère une image de chat', conv.id) })
    const call = vi.mocked(streamMessage).mock.calls[0]!
    await act(async () => { await call[4]!.onToolCall!('generate_image', { prompt: 'cat' }) })
    expect(conv.messages.at(-1)).toMatchObject({ id: 'streaming', content: '', generatedImages: [imageId] })
    expect(result.current.streamingImages).toEqual([imageId])
    act(() => { if (ending === 'done') call[2](); else if (ending === 'stop') result.current.stopStreaming(); else call[3](new Error('provider failed')) })
    expect(conv.messages.at(-1)).toMatchObject({ content: '', generatedImages: [imageId], ...(ending === 'done' ? {} : { interrupted: true }) })
    expect(conv.messages.at(-1)?.id).not.toBe('streaming')
    expect(result.current.isStreaming).toBe(false)
    unmount()
  })

  it('retains the first adopted image when a second tool fails, then accepts a new turn without reboot', async () => {
    const { result, handler, unmount } = setupReceipt()
    handler.mockReset().mockResolvedValueOnce({ result: 'received', localImageId: imageId }).mockRejectedValueOnce(new Error('storage failed'))
    await act(async () => { await result.current.sendMessage('génère une image', conv.id) })
    const tool = vi.mocked(streamMessage).mock.calls[0]![4]!.onToolCall!
    await act(async () => { await tool('generate_image', { prompt: 'cat' }) })
    await act(async () => { await expect(tool('generate_image', { prompt: 'dog' })).rejects.toMatchObject({ name: 'AbortError' }) })
    const kept = structuredClone(conv.messages.at(-1))
    expect(kept).toMatchObject({ generatedImages: [imageId], interrupted: true })
    expect(kept?.id).not.toBe('streaming')
    await act(async () => { await result.current.sendMessage('Bonjour', conv.id) })
    const next = vi.mocked(streamMessage).mock.calls[1]!
    act(() => { next[1]('Bonjour aussi'); next[2]() })
    expect(conv.messages).toContainEqual(kept)
    unmount()
  })

  it('normalizes an abandoned receipt before a new request captures its history', async () => {
    conv.messages = [{ id: 'streaming', role: 'assistant', content: '', timestamp: 1, generatedImages: [imageId] }]
    const { result, unmount } = setupReceipt()
    await act(async () => { await result.current.sendMessage('Bonjour', conv.id) })
    const call = vi.mocked(streamMessage).mock.calls[0]!
    act(() => { call[1]('Réponse'); call[2]() })
    expect(conv.messages[0]).toMatchObject({ generatedImages: [imageId], interrupted: true })
    expect(conv.messages[0]?.id).not.toBe('streaming')
    expect(conv.messages).toHaveLength(3)
    unmount()
  })

  it('does not rewrite a prior receipt when the next tool encounters a durable-only erasure fence', async () => {
    const { result, handler, unmount } = setupReceipt()
    await act(async () => { await result.current.sendMessage('génère une image', conv.id) })
    const tool = vi.mocked(streamMessage).mock.calls[0]![4]!.onToolCall!
    await act(async () => { await tool('generate_image', { prompt: 'cat' }) })
    const before = structuredClone(conv)
    const { beginProjectOperation, assertProjectOperation } = await import('../../services/projects/store')
    const operation = await beginProjectOperation()
    handler.mockImplementationOnce(async () => {
      const db = await openDB('arty-projects', 1); await db.put('meta', 'new-fence', 'erasure-fence'); db.close()
      await assertProjectOperation(operation)
      return { result: 'unreachable', localImageId: imageId }
    })
    vi.mocked(storage.saveConversation).mockClear()
    await act(async () => { await expect(tool('generate_image', { prompt: 'dog' })).rejects.toMatchObject({ name: 'AbortError' }) })
    expect(storage.saveConversation).not.toHaveBeenCalled()
    expect(conv).toEqual(before)
    expect(result.current.isStreaming).toBe(false)
    unmount()
  })

  it('counts failed attempts and prevents parallel or fifth tool calls', async () => {
    const gate = deferred<{ result: string; localImageId: string }>()
    const { result, handler, unmount } = setupReceipt()
    handler.mockImplementationOnce(() => gate.promise).mockResolvedValue({ result: 'unavailable', localImageId: '' })
    await act(async () => { await result.current.sendMessage('génère une image', conv.id) })
    const tool = vi.mocked(streamMessage).mock.calls[0]![4]!.onToolCall!
    await act(async () => {
      const first = tool('generate_image', { prompt: 'cat' })
      await expect(tool('generate_image', { prompt: 'parallel' })).resolves.not.toHaveProperty('localImageId')
      expect(handler).toHaveBeenCalledOnce()
      gate.resolve({ result: 'unavailable', localImageId: '' }); await first
      for (let i = 0; i < 4; i++) await tool('generate_image', { prompt: 'cat' })
    })
    expect(handler).toHaveBeenCalledTimes(4)
    unmount()
  })

  it.each(['retry', 'edit', 'errorRetry'] as const)('%s keeps original and navigates a new request branch', async action => {
    conv.hasGoogleData = true; conv.tags = ['work']
    conv.messages = [{ id: 'u1', role: 'user', content: 'génère une image', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: '', timestamp: 2, generatedImages: [imageId], interrupted: true }]
    const original = structuredClone(conv)
    const { result, onNavigate, unmount } = setupReceipt()
    const warnings: string[] = []
    const listener = (event: Event) => warnings.push((event as CustomEvent<{ message: string }>).detail.message)
    window.addEventListener('arty-toast', listener)
    await act(async () => {
      if (action === 'retry') result.current.retryMessage('a1')
      else if (action === 'edit') result.current.editAndResend('u1', 'génère une image de chien')
      else result.current.retryLastUserMessage()
      await Promise.resolve()
    })
    await waitFor(() => expect(streamMessage).toHaveBeenCalledOnce())
    expect(conv).toEqual(original)
    const branchId = onNavigate.mock.calls[0]![0]
    const branch = conversations.get(branchId)!
    expect(branch).toMatchObject({ hasGoogleData: true, tags: ['work'] })
    expect(branch.messages).toHaveLength(1)
    expect(branch.messages[0]?.content).toBe(action === 'edit' ? 'génère une image de chien' : 'génère une image')
    expect(warnings[0]).toMatch(/facturée|charged/)
    expect(result.current.activeId).toBe(branchId)
    window.removeEventListener('arty-toast', listener); unmount()
  })

  it.each(['/aide', 'rappel'] as const)('editing an image prompt to local %s replaces the old user in the branch', async local => {
    conv.messages = [{ id: 'u1', role: 'user', content: 'génère une image', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: '', timestamp: 2, generatedImages: [imageId] }]
    const original = structuredClone(conv)
    if (local === 'rappel') {
      vi.mocked(detectReminderIntent).mockReturnValue({ title: 'Synthetic', body: 'Synthetic', triggerAt: Date.now() + 60000 } as unknown as NonNullable<ReturnType<typeof detectReminderIntent>>)
      vi.mocked(createReminder).mockResolvedValue('Rappel de test préparé')
    }
    const { result, onNavigate, unmount } = setupReceipt()
    await act(async () => { result.current.editAndResend('u1', local); await Promise.resolve() })
    const branch = conversations.get(onNavigate.mock.calls[0]![0])!
    expect(conv).toEqual(original)
    expect(branch.messages).toHaveLength(2)
    expect(branch.messages[0]!.content).toBe(local)
    expect(streamMessage).not.toHaveBeenCalled()
    if (local === 'rappel') expect(createReminder).toHaveBeenCalledOnce()
    unmount()
  })

  it('serializes a local reminder against image streams in either start order', async () => {
    const { result, unmount } = setupReceipt()
    const gate = deferred<string>()
    vi.mocked(detectReminderIntent).mockReturnValueOnce({ title: 'Synthetic' } as NonNullable<ReturnType<typeof detectReminderIntent>>)
    vi.mocked(createReminder).mockReturnValueOnce(gate.promise)
    let reminder!: Promise<boolean>
    act(() => { reminder = result.current.sendMessage('rappel', conv.id) })
    await waitFor(() => expect(createReminder).toHaveBeenCalledOnce())
    await act(async () => { expect(await result.current.sendMessage('génère une image', conv.id)).toBe(false) })
    expect(streamMessage).not.toHaveBeenCalled()
    await act(async () => { gate.resolve('Rappel de test'); expect(await reminder).toBe(true) })
    await act(async () => { await result.current.sendMessage('génère une image', conv.id) })
    await act(async () => { expect(await result.current.sendMessage('rappel', conv.id)).toBe(false) })
    expect(createReminder).toHaveBeenCalledOnce()
    await act(async () => { await vi.mocked(streamMessage).mock.calls[0]![4]!.onToolCall!('generate_image', { prompt: 'cat' }) })
    expect(conv.messages.at(-1)?.generatedImages).toEqual([imageId])
    unmount()
  })

  it.each(['history', 'delete', 'account'] as const)('does not overwrite after %s changes during a local reminder', async change => {
    const { result, unmount } = setupReceipt(), gate = deferred<string>()
    vi.mocked(detectReminderIntent).mockReturnValueOnce({ title: 'Synthetic' } as NonNullable<ReturnType<typeof detectReminderIntent>>)
    vi.mocked(createReminder).mockReturnValueOnce(gate.promise)
    let pending!: Promise<boolean>
    act(() => { pending = result.current.sendMessage('rappel', conv.id) })
    await waitFor(() => expect(createReminder).toHaveBeenCalledOnce())
    if (change === 'history') storage.saveConversation({ ...conv, messages: [{ id: 'a-image', role: 'assistant', timestamp: 1, content: '', generatedImages: [imageId] }] })
    if (change === 'delete') conversations.delete(conv.id)
    if (change === 'account') users.setActiveSession({ ...session, userId: 'b' })
    vi.mocked(storage.saveConversation).mockClear()
    await act(async () => { gate.resolve('Rappel de test'); expect(await pending).toBe(false) })
    expect(storage.saveConversation).not.toHaveBeenCalled()
    if (change === 'history') expect(conv.messages[0]!.generatedImages).toEqual([imageId])
    if (change === 'delete') expect(conversations.has(conv.id)).toBe(false)
    unmount()
  })

  it.each(['crypto', 'fence'] as const)('tears down the matching stream on %s cancellation; cannot restart its image loop', async change => {
    const gate = deferred<string | null>(); mocks.token.mockReturnValue(gate.promise)
    const executor = createToolExecutor({} as Parameters<typeof createToolExecutor>[0], {} as Parameters<typeof createToolExecutor>[1])
    const { result, unmount } = renderHook(() => useConversation())
    act(() => { result.current.selectConversation(conv.id); result.current.setToolHandler(executor) })
    await act(async () => { await result.current.sendMessage('génère une image de chat', conv.id) })
    const call = vi.mocked(streamMessage).mock.calls[0], onTool = call[4]!.onToolCall!
    const controller = vi.mocked(streamMessage).mock.results[0].value as AbortController
    let failure: unknown
    await act(async () => {
      const pending = onTool('generate_image', { prompt: 'photo de chat' }).catch(error => { failure = error })
      await waitFor(() => expect(mocks.token).toHaveBeenCalledOnce())
      if (change === 'crypto') await cryptoService.initCrypto('new-key')
      else { const db = await openDB('arty-projects', 1); await db.put('meta', 'new-fence', 'erasure-fence'); db.close() }
      gate.resolve('token-a'); await pending
    })
    expect(failure).toMatchObject({ name: 'AbortError' })
    expect(controller.signal.aborted).toBe(true); expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingConvIds.size).toBe(0)
    expect(conv.messages.every(m => m.role === 'user')).toBe(true)
    await expect(onTool('generate_image', { prompt: 'second attempt' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.token).toHaveBeenCalledOnce(); expect(mocks.fetch).not.toHaveBeenCalled()
    expect(streamMessage).toHaveBeenCalledOnce(); unmount()
  })

  it.each(['response', 'persisted'] as const)('tears down on a durable-only fence change after %s, with no image released', async stage => {
    mocks.token.mockResolvedValue('token-a')
    const changeFence = async () => { const db = await openDB('arty-projects', 1); await db.put('meta', 'new-fence', 'erasure-fence'); db.close() }
    const originalPut = fileStorage.putFile
    const put = vi.spyOn(fileStorage, 'putFile').mockImplementation(async (...args) => {
      const id = await originalPut(...args)
      if (stage === 'persisted') await changeFence()
      return id
    })
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => {
      if (stage === 'response') await changeFence()
      return { b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', mimeType: 'image/png' }
    } })
    const executor = createToolExecutor({} as Parameters<typeof createToolExecutor>[0], {} as Parameters<typeof createToolExecutor>[1])
    const { result, unmount } = renderHook(() => useConversation())
    act(() => { result.current.selectConversation(conv.id); result.current.setToolHandler(executor) })
    await act(async () => { await result.current.sendMessage('génère une image de chat', conv.id) })
    const call = vi.mocked(streamMessage).mock.calls[0], onTool = call[4]!.onToolCall!
    const controller = vi.mocked(streamMessage).mock.results[0].value as AbortController
    await act(async () => { await expect(onTool('generate_image', { prompt: 'photo de chat' })).rejects.toMatchObject({ name: 'AbortError' }) })
    expect(controller.signal.aborted).toBe(true); expect(result.current.isStreaming).toBe(false)
    expect(conv.messages.every(m => m.role === 'user')).toBe(true)
    expect(put).toHaveBeenCalledTimes(stage === 'persisted' ? 1 : 0)
    await expect(onTool('generate_image', { prompt: 'second attempt' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.fetch).toHaveBeenCalledOnce(); expect(streamMessage).toHaveBeenCalledOnce(); unmount()
  })
})
