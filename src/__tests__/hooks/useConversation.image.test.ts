import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
const mocks = vi.hoisted(() => ({ token: vi.fn(), fetch: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: mocks.token, isTokenValid: () => false, getGoogleEmail: () => null }))
vi.mock('../../services/activeApiKey', () => ({ getOpenAIKey: () => 'synthetic-key', getActiveApiKey: () => 'synthetic-key' }))
vi.mock('../../services/imageCompression', () => ({ compressImageIfNeeded: async (data: string, mimeType: string) => ({ data, mimeType, size: 68 }) }))
vi.mock('../../services/storage', () => ({ getConversations: vi.fn(), getConversation: vi.fn(), saveConversation: vi.fn(), isCacheReady: () => true }))
vi.mock('../../services/anthropicClient', () => ({ streamMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/autoMemory', () => ({ maybeExtractMemory: vi.fn() }))
vi.mock('../../services/pdfUrlFetch', () => ({ fetchPdfMarkdowns: vi.fn(async () => ''), fetchUrlMarkdowns: vi.fn(async () => ({ block: '', unreadable: [] })) }))
vi.mock('../../services/factChecker', () => ({ clearSearchContext: vi.fn(), getFactCheckMode: () => 'off', runFactCheckOnLatest: vi.fn() }))
vi.mock('../../services/taskService', () => ({ detectSuggestedTasks: vi.fn(() => []), addTask: vi.fn() }))
vi.mock('../../services/reminderService', () => ({ detectReminderIntent: () => null, createReminder: vi.fn() }))
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
const session = { userId: 'a', authMethod: 'google' as const, displayName: 'Synthetic A', createdAt: 1 }
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(r => { resolve = r }), resolve: (value: T) => resolve(value) } }
let conv: Conversation
beforeEach(async () => {
  // Modules keep an open project DB, as the real app does across sessions.
  vi.clearAllMocks(); localStorage.clear()
  users.setActiveSession(session); await cryptoService.initCrypto('synthetic-key')
  // Keep the module's cached IDB handle, reset only the synthetic fence.
  const { beginProjectOperation } = await import('../../services/projects/store')
  try { await beginProjectOperation() } catch { /* previous test deliberately changed the durable fence */ }
  const db = await openDB('arty-projects', 1); await db.delete('meta', 'erasure-fence'); db.close()
  conv = { id: 'c1', title: 'Synthetic image', messages: [], createdAt: 1, updatedAt: 1 }
  vi.mocked(storage.getConversations).mockReturnValue([conv]); vi.mocked(storage.getConversation).mockReturnValue(conv)
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('image cancellation — real hook, dispatcher, handler, crypto, IDB; network simulated', () => {
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
