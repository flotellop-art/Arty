import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../services/storage', () => ({ getConversation: vi.fn(), saveConversation: vi.fn(), isCacheReady: () => true }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => 'a', getActiveSessionEpoch: vi.fn(() => 1) }))
import * as storage from '../../services/storage'
import { getActiveSessionEpoch } from '../../services/userSession'
import { useStreaming } from '../../hooks/useStreaming'
import type { Conversation } from '../../types'
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.mocked(getActiveSessionEpoch).mockReturnValue(1) })
describe('Persisted attribution belongs to the exact invocation', () => {
  it('same-conversation Stop/restart ignores old and unscoped events, including partial saves', () => {
    const conv: Conversation = { id: 'c', title: 'test', createdAt: 0, updatedAt: 0, messages: [] }
    vi.mocked(storage.getConversation).mockReturnValue(conv)
    vi.mocked(storage.saveConversation).mockImplementation(saved => Object.assign(conv, saved))
    const { result } = renderHook(() => useStreaming({ refreshConversations: vi.fn() }))
    act(() => { result.current.startStream('c') })
    const oldId = result.current.getInvocationId('c')
    act(() => { result.current.stopStreaming('c'); result.current.startStream('c') })
    const newId = result.current.getInvocationId('c')
    expect(newId).not.toBe(oldId)
    act(() => {
      for (const [invocationId, model] of [[newId, 'claude-haiku-4-5'], [oldId, 'claude-opus-4-8'], [undefined, 'gpt-5']]) {
        window.dispatchEvent(new CustomEvent('arty-model-used', { detail: { invocationId, conversationId: 'c', model, requestedModel: 'claude-sonnet-5', source: 'provider' } }))
      }
      result.current.onToken('NEW CONTENT', 'c'); result.current.savePartialAll()
    })
    expect(conv.messages.at(-1)).toMatchObject({ model: 'claude-haiku-4-5', requestedModel: 'claude-sonnet-5', modelSource: 'provider' })
    act(() => { result.current.onDone('c') })
    expect(conv.messages.at(-1)).toMatchObject({ content: 'NEW CONTENT', model: 'claude-haiku-4-5', modelSource: 'provider' })
  })
  it('session change invalidates periodic saves even without an Office-specific guard', () => {
    vi.mocked(storage.getConversation).mockReturnValue({ id: 'c', title: 'test', createdAt: 0, updatedAt: 0, messages: [] })
    const { result } = renderHook(() => useStreaming({ refreshConversations: vi.fn() }))
    act(() => { result.current.startStream('c'); result.current.onToken('PRIVATE', 'c') })
    vi.mocked(getActiveSessionEpoch).mockReturnValue(2)
    act(() => { result.current.savePartialAll() })
    expect(storage.saveConversation).not.toHaveBeenCalled()
    expect(result.current.hasStream('c')).toBe(false)
  })
})
