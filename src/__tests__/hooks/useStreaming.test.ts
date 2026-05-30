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
// L'API multi-conv n'expose plus les refs internes : un stream ne s'affiche
// (isStreaming / streamingContent) que pour la conv rendue active via
// setActiveStream. `activate` reproduit le flux réel "conv affichée + envoi".
function renderStreaming() {
  const refreshConversations = vi.fn()
  const { result } = renderHook(() => useStreaming({ refreshConversations }))
  return { result, refreshConversations }
}

function startActive(result: ReturnType<typeof renderStreaming>['result'], id: string) {
  act(() => {
    result.current.setActiveStream(id)
    result.current.startStream(id)
  })
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
    expect(result.current.hasStream('conv-1')).toBe(false)
  })
})

// ──────────────────────────────────────────────
// startStream
// ──────────────────────────────────────────────
describe('startStream', () => {
  it('sets isStreaming=true and tracks targetId when active', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.hasStream('conv-1')).toBe(true)
    expect(result.current.isStreamingFor('conv-1')).toBe(true)
  })

  it('does not show in UI when the started conv is not the active one', () => {
    const { result } = renderStreaming()
    act(() => { result.current.setActiveStream('conv-1') })
    act(() => { result.current.startStream('conv-2') }) // background stream
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
    expect(result.current.hasStream('conv-2')).toBe(true)
  })

  it('refuses to start past the concurrency cap', () => {
    const { result } = renderStreaming()
    let started: boolean[] = []
    act(() => {
      started = [
        result.current.startStream('c1'),
        result.current.startStream('c2'),
        result.current.startStream('c3'),
        result.current.startStream('c4'), // over MAX_CONCURRENT_STREAMS (3)
      ]
    })
    expect(started).toEqual([true, true, true, false])
    expect(result.current.canStart('c5')).toBe(false)
  })

  it('isActive returns true for the active targetId', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    expect(result.current.isActive('conv-1')).toBe(true)
    expect(result.current.isActive('conv-2')).toBe(false)
  })
})

// ──────────────────────────────────────────────
// onToken — token accumulation
// ──────────────────────────────────────────────
describe('onToken', () => {
  it('accumulates tokens and reflects them in streamingContent', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('Hel', 'conv-1')
      result.current.onToken('lo', 'conv-1')
    })
    // Le flush vers streamingContent passe par requestAnimationFrame (throttle).
    act(() => { vi.advanceTimersByTime(50) })
    expect(result.current.streamingContent).toBe('Hello')
  })

  it('updates streamingContent for active targetId', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => { result.current.onToken('World', 'conv-1') })
    act(() => { vi.advanceTimersByTime(50) })
    expect(result.current.streamingContent).toBe('World')
  })

  it('ignores tokens for non-active targetId', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => { result.current.onToken('ignored', 'conv-other') })
    act(() => { vi.advanceTimersByTime(50) })
    expect(result.current.streamingContent).toBe('')
  })
})

// ──────────────────────────────────────────────
// savePartialAll — periodic / lifecycle save
// ──────────────────────────────────────────────
describe('savePartialAll', () => {
  it('saves accumulated content to storage', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => { result.current.onToken('partial text', 'conv-1') })
    act(() => { result.current.savePartialAll() })

    expect(mockSaveConversation).toHaveBeenCalled()
    const saved = mockSaveConversation.mock.calls[0]![0] as typeof conv
    const msg = saved.messages.find(m => m.id === 'streaming')
    expect(msg?.content).toBe('partial text')
  })

  it('does nothing when no accumulated content', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => { result.current.savePartialAll() })
    expect(mockSaveConversation).not.toHaveBeenCalled()
  })

  it('does nothing when there is no active stream', () => {
    const { result } = renderStreaming()
    act(() => { result.current.savePartialAll() })
    expect(mockGetConversation).not.toHaveBeenCalled()
  })

  it('updates existing streaming message instead of pushing a new one', () => {
    const conv = makeConv('conv-1')
    conv.messages = [{ id: 'streaming', role: 'assistant', content: 'old', timestamp: 0 }]
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => { result.current.onToken('new content', 'conv-1') })
    act(() => { result.current.savePartialAll() })

    const saved = mockSaveConversation.mock.calls[0]![0] as typeof conv
    const streamingMsgs = saved.messages.filter(m => m.id === 'streaming')
    expect(streamingMsgs).toHaveLength(1)
    expect(streamingMsgs[0]!.content).toBe('new content')
  })

  it('triggers automatically every 3 seconds via interval', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => { result.current.onToken('auto-saved', 'conv-1') })

    // advance 3 seconds for the per-stream saveInterval to fire
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
    startActive(result, 'conv-1')
    act(() => { result.current.onToken('final content', 'conv-1') })
    act(() => { result.current.onDone('conv-1') })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
    expect(result.current.hasStream('conv-1')).toBe(false)
    expect(refreshConversations).toHaveBeenCalled()

    const saved = mockSaveConversation.mock.calls.at(-1)![0] as typeof conv
    expect(saved.messages.some(m => m.id === 'streaming')).toBe(false)
    expect(saved.messages.some(m => m.content === 'final content')).toBe(true)
  })

  it('does not update active UI when called for a non-active targetId', () => {
    const conv = makeConv('conv-other')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    startActive(result, 'conv-1')          // active stream → isStreaming true
    act(() => { result.current.startStream('conv-other') }) // background stream
    act(() => { result.current.onDone('conv-other') })
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.hasStream('conv-1')).toBe(true)
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
    startActive(result, 'conv-1')
    act(() => { result.current.onToken('partial', 'conv-1') })

    const err = new Error('Network error')
    act(() => { result.current.onError(err, 'conv-1') })

    expect(result.current.isStreaming).toBe(false)
    const saved = mockSaveConversation.mock.calls.at(-1)![0] as typeof conv
    const lastMsg = saved.messages[saved.messages.length - 1]
    expect(lastMsg!.content).toContain('partial')
    expect((lastMsg as { interrupted?: boolean }).interrupted).toBe(true)
  })

  it('returns the error object', () => {
    mockGetConversation.mockReturnValue(null as never)
    const { result } = renderStreaming()
    startActive(result, 'conv-1')

    const err = new Error('boom')
    let returned: Error | undefined
    act(() => { returned = result.current.onError(err, 'conv-1') })
    expect(returned).toBe(err)
  })

  it('clears the stream after error', () => {
    mockGetConversation.mockReturnValue(null as never)
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => { result.current.onError(new Error('fail'), 'conv-1') })
    expect(result.current.hasStream('conv-1')).toBe(false)
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
    startActive(result, 'conv-1')
    const abort = vi.fn()
    act(() => {
      result.current.setAbortController('conv-1', { abort } as unknown as AbortController)
      result.current.onToken('some content', 'conv-1')
    })
    act(() => { result.current.stopStreaming() })

    expect(abort).toHaveBeenCalled()
  })

  it('saves partial content with interruption notice', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => { result.current.onToken('partial stop', 'conv-1') })
    act(() => { result.current.stopStreaming() })

    const saved = mockSaveConversation.mock.calls.at(-1)![0] as typeof conv
    const lastMsg = saved.messages[saved.messages.length - 1]
    expect(lastMsg!.content).toContain('partial stop')
    expect((lastMsg as { interrupted?: boolean }).interrupted).toBe(true)
  })

  it('resets isStreaming and streamingContent', () => {
    mockGetConversation.mockReturnValue(null as never)
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => { result.current.stopStreaming() })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
  })
})

// ──────────────────────────────────────────────
// completeStreaming — teardown
// ──────────────────────────────────────────────
describe('completeStreaming', () => {
  it('clears interval and resets all state', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => { result.current.completeStreaming('conv-1') })

    expect(clearIntervalSpy).toHaveBeenCalled()
    expect(result.current.hasStream('conv-1')).toBe(false)
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
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
    startActive(result, 'conv-1')
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
    startActive(result, 'conv-1')
    act(() => { result.current.onToken('before-unload-content', 'conv-1') })

    act(() => { window.dispatchEvent(new Event('beforeunload')) })

    expect(mockSaveConversation).toHaveBeenCalled()
  })
})
