import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStreaming } from '../../hooks/useStreaming'

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────
vi.mock('../../utils/generateId', () => ({
  generateId: vi.fn(() => 'test-uuid'),
}))

vi.mock('../../services/storage', () => ({
  getConversation: vi.fn(),
  saveConversation: vi.fn(),
}))

import * as storage from '../../services/storage'

const mockGetConversation = vi.mocked(storage.getConversation)
const mockSaveConversation = vi.mocked(storage.saveConversation)

function makeConv(id = 'conv-1') {
  return {
    id,
    messages: [] as Array<{ id: string; role: string; content: string; timestamp: number }>,
    updatedAt: 0,
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function renderStreaming() {
  const refreshConversations = vi.fn()
  const { result } = renderHook(() => useStreaming({ refreshConversations }))
  return { result, refreshConversations }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

// ──────────────────────────────────────────────
// Initial state
// ──────────────────────────────────────────────
describe('initial state', () => {
  it('starts with isStreaming=false and empty content', () => {
    const { result } = renderStreaming()
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
    expect(result.current.abortRef.current).toBeNull()
  })
})

// ──────────────────────────────────────────────
// startStream
// ──────────────────────────────────────────────
describe('startStream', () => {
  it('sets isStreaming=true and tracks targetId', () => {
    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.streamingRef.current?.targetId).toBe('conv-1')
    expect(result.current.streamingRef.current?.accumulated).toBe('')
  })

  it('clears previous streamingContent on start', () => {
    const { result } = renderStreaming()
    act(() => {
      result.current.startStream('conv-1')
      result.current.onToken('Hello', 'conv-1')
    })
    act(() => { result.current.startStream('conv-2') })
    expect(result.current.streamingContent).toBe('')
  })

  it('sets up periodic saveInterval every 3 seconds', () => {
    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    expect(result.current.streamingRef.current?.saveInterval).not.toBeNull()
  })

  it('isActive returns true for started targetId', () => {
    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    expect(result.current.isActive('conv-1')).toBe(true)
    expect(result.current.isActive('conv-2')).toBe(false)
  })
})

// ──────────────────────────────────────────────
// onToken — token accumulation
// ──────────────────────────────────────────────
describe('onToken', () => {
  it('accumulates tokens in streamingRef', () => {
    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => {
      result.current.onToken('Hel', 'conv-1')
      result.current.onToken('lo', 'conv-1')
    })
    expect(result.current.streamingRef.current?.accumulated).toBe('Hello')
  })

  it('updates streamingContent for active targetId', () => {
    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => {
      result.current.onToken('World', 'conv-1')
    })
    expect(result.current.streamingContent).toBe('World')
  })

  it('ignores tokens for non-active targetId', () => {
    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => {
      result.current.onToken('ignored', 'conv-other')
    })
    expect(result.current.streamingContent).toBe('')
  })
})

// ──────────────────────────────────────────────
// savePartial — periodic save
// ──────────────────────────────────────────────
describe('savePartial', () => {
  it('saves accumulated content to storage', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => { result.current.onToken('partial text', 'conv-1') })
    act(() => { result.current.savePartial() })

    expect(mockSaveConversation).toHaveBeenCalled()
    const saved = mockSaveConversation.mock.calls[0]![0] as typeof conv
    const msg = saved.messages.find(m => m.id === 'streaming')
    expect(msg?.content).toBe('partial text')
  })

  it('does nothing when no accumulated content', () => {
    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => { result.current.savePartial() })
    expect(mockSaveConversation).not.toHaveBeenCalled()
  })

  it('does nothing when no streamingRef', () => {
    const { result } = renderStreaming()
    act(() => { result.current.savePartial() })
    expect(mockGetConversation).not.toHaveBeenCalled()
  })

  it('updates existing streaming message instead of pushing a new one', () => {
    const conv = makeConv('conv-1')
    conv.messages = [{ id: 'streaming', role: 'assistant', content: 'old', timestamp: 0 }]
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => { result.current.onToken('new content', 'conv-1') })
    act(() => { result.current.savePartial() })

    const saved = mockSaveConversation.mock.calls[0]![0] as typeof conv
    const streamingMsgs = saved.messages.filter(m => m.id === 'streaming')
    expect(streamingMsgs).toHaveLength(1)
    expect(streamingMsgs[0]!.content).toBe('new content')
  })

  it('triggers automatically every 3 seconds via interval', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => { result.current.onToken('auto-saved', 'conv-1') })

    // advance 3 seconds for interval to fire
    act(() => { vi.advanceTimersByTime(3000) })

    expect(mockSaveConversation).toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────
// onDone — finalize
// ──────────────────────────────────────────────
describe('onDone', () => {
  it('replaces streaming message with final message', () => {
    const conv = makeConv('conv-1')
    conv.messages = [{ id: 'streaming', role: 'assistant', content: 'partial', timestamp: 0 }]
    mockGetConversation.mockReturnValue(conv as never)

    const { result, refreshConversations } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => { result.current.onToken('final content', 'conv-1') })
    act(() => { result.current.onDone('conv-1') })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
    expect(result.current.streamingRef.current).toBeNull()
    expect(refreshConversations).toHaveBeenCalled()

    const saved = mockSaveConversation.mock.calls[0]![0] as typeof conv
    expect(saved.messages.some(m => m.id === 'streaming')).toBe(false)
    expect(saved.messages.some(m => m.content === 'final content')).toBe(true)
  })

  it('does not update state when called for non-active targetId', () => {
    const conv = makeConv('conv-other')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    // onDone for a different id — isStreaming should remain true
    act(() => { result.current.onDone('conv-other') })
    expect(result.current.isStreaming).toBe(true)
  })
})

// ──────────────────────────────────────────────
// onError — error handling with partial save
// ──────────────────────────────────────────────
describe('onError', () => {
  it('saves partial content with interruption notice', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => { result.current.onToken('partial', 'conv-1') })

    const err = new Error('Network error')
    act(() => { result.current.onError(err, 'conv-1') })

    expect(result.current.isStreaming).toBe(false)
    const saved = mockSaveConversation.mock.calls[0]![0] as typeof conv
    const lastMsg = saved.messages[saved.messages.length - 1]
    expect(lastMsg!.content).toContain('partial')
    expect(lastMsg!.content.toLowerCase()).toMatch(/interrompue|interrupted/)
  })

  it('returns the error object', () => {
    mockGetConversation.mockReturnValue(null)
    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })

    const err = new Error('boom')
    let returned: Error | undefined
    act(() => { returned = result.current.onError(err, 'conv-1') })
    expect(returned).toBe(err)
  })

  it('clears streamingRef after error', () => {
    mockGetConversation.mockReturnValue(null)
    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => { result.current.onError(new Error('fail'), 'conv-1') })
    expect(result.current.streamingRef.current).toBeNull()
  })
})

// ──────────────────────────────────────────────
// stopStreaming — abort + finalize
// ──────────────────────────────────────────────
describe('stopStreaming', () => {
  it('aborts the AbortController', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    const abort = vi.fn()
    act(() => {
      result.current.startStream('conv-1')
      result.current.abortRef.current = { abort } as unknown as AbortController
      result.current.onToken('some content', 'conv-1')
    })
    act(() => { result.current.stopStreaming() })

    expect(abort).toHaveBeenCalled()
  })

  it('saves partial content with stopped notice', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => { result.current.onToken('partial stop', 'conv-1') })
    act(() => { result.current.stopStreaming() })

    const saved = mockSaveConversation.mock.calls[0]![0] as typeof conv
    const lastMsg = saved.messages[saved.messages.length - 1]
    expect(lastMsg!.content).toContain('partial stop')
    expect(lastMsg!.content.toLowerCase()).toMatch(/arrêtée|stopped/)
  })

  it('resets isStreaming and streamingContent', () => {
    mockGetConversation.mockReturnValue(null)
    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => { result.current.stopStreaming() })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
  })
})

// ──────────────────────────────────────────────
// cleanupStreaming
// ──────────────────────────────────────────────
describe('cleanupStreaming', () => {
  it('clears interval and resets all state', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    const interval = result.current.streamingRef.current?.saveInterval
    act(() => { result.current.cleanupStreaming() })

    expect(clearIntervalSpy).toHaveBeenCalledWith(interval)
    expect(result.current.streamingRef.current).toBeNull()
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.abortRef.current).toBeNull()
  })
})

// ──────────────────────────────────────────────
// visibility / beforeunload auto-save
// ──────────────────────────────────────────────
describe('auto-save on visibility change / beforeunload', () => {
  it('saves partial when document becomes hidden', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => { result.current.onToken('auto-save-hidden', 'conv-1') })

    // simulate tab hidden
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })

    expect(mockSaveConversation).toHaveBeenCalled()
  })

  it('saves partial on beforeunload', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    act(() => { result.current.startStream('conv-1') })
    act(() => { result.current.onToken('before-unload-content', 'conv-1') })

    act(() => { window.dispatchEvent(new Event('beforeunload')) })

    expect(mockSaveConversation).toHaveBeenCalled()
  })
})
