import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStreaming, MAX_CONCURRENT_STREAMS } from '../../hooks/useStreaming'

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

type TestMsg = { id: string; role: string; content: string; timestamp: number; interrupted?: boolean }
type TestConv = { id: string; messages: TestMsg[]; updatedAt: number }

function makeConv(id = 'conv-1'): TestConv {
  return { id, messages: [], updatedAt: 0 }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function renderStreaming() {
  const refreshConversations = vi.fn()
  const { result } = renderHook(() => useStreaming({ refreshConversations }))
  return { result, refreshConversations }
}

type Streaming = ReturnType<typeof renderStreaming>['result']

// L'API multi-stream découple "un stream existe" (streamsRef) de "ce stream est
// affiché" (activeIdRef). Pour reproduire l'ancien comportement mono-stream où
// startStream rendait la conv visible, on la rend active AVANT de la démarrer.
function startActive(result: Streaming, id = 'conv-1') {
  act(() => {
    result.current.setActiveStream(id)
    result.current.startStream(id)
  })
}

// onToken pousse le contenu affiché via requestAnimationFrame (coalescing 1
// setState/frame). Sous fake timers, avancer le temps flush le RAF en attente.
function flushRaf() {
  act(() => {
    vi.advanceTimersByTime(50)
  })
}

function lastSaved(): TestConv {
  const calls = mockSaveConversation.mock.calls
  return calls[calls.length - 1]![0] as unknown as TestConv
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
    expect(result.current.streamingConvIds.size).toBe(0)
    expect(result.current.hasStream('conv-1')).toBe(false)
    expect(result.current.canStart('conv-1')).toBe(true)
  })
})

// ──────────────────────────────────────────────
// startStream
// ──────────────────────────────────────────────
describe('startStream', () => {
  it('sets isStreaming=true for the active conv and tracks the stream', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.hasStream('conv-1')).toBe(true)
    expect(result.current.isStreamingFor('conv-1')).toBe(true)
  })

  it('does NOT touch the visible UI when the started conv is not the active one', () => {
    const { result } = renderStreaming()
    // No active conv selected → background stream, UI stays idle.
    act(() => {
      result.current.startStream('conv-1')
    })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
    // …but the stream is tracked for the Sidebar indicator.
    expect(result.current.isStreamingFor('conv-1')).toBe(true)
  })

  it('clears streamingContent when (re)starting a stream for the active conv', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('Hello', 'conv-1')
    })
    flushRaf()
    expect(result.current.streamingContent).toBe('Hello')

    act(() => {
      result.current.completeStreaming('conv-1')
    })
    act(() => {
      result.current.startStream('conv-1')
    })
    expect(result.current.streamingContent).toBe('')
  })

  it('sets up a periodic save interval', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('auto', 'conv-1')
    })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(mockSaveConversation).toHaveBeenCalled()
  })

  it('isActive reflects the active conv, not merely the existence of a stream', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    expect(result.current.isActive('conv-1')).toBe(true)
    expect(result.current.isActive('conv-2')).toBe(false)
  })

  it('returns false when a stream already exists for that conv', () => {
    const { result } = renderStreaming()
    let first = false
    let second = true
    act(() => {
      first = result.current.startStream('conv-1')
    })
    act(() => {
      second = result.current.startStream('conv-1')
    })
    expect(first).toBe(true)
    expect(second).toBe(false)
  })
})

// ──────────────────────────────────────────────
// Concurrency cap (multi-stream)
// ──────────────────────────────────────────────
describe('concurrency cap', () => {
  it('caps concurrent streams at MAX_CONCURRENT_STREAMS', () => {
    const { result } = renderStreaming()
    const outcomes: boolean[] = []
    act(() => {
      for (let i = 0; i <= MAX_CONCURRENT_STREAMS; i++) {
        outcomes.push(result.current.startStream(`conv-${i}`))
      }
    })
    // The first MAX_CONCURRENT_STREAMS succeed, the next one is rejected.
    expect(outcomes.slice(0, MAX_CONCURRENT_STREAMS).every(Boolean)).toBe(true)
    expect(outcomes[MAX_CONCURRENT_STREAMS]).toBe(false)
    expect(result.current.canStart(`conv-${MAX_CONCURRENT_STREAMS}`)).toBe(false)
  })

  it('canStart is false for a conv that already streams', () => {
    const { result } = renderStreaming()
    act(() => {
      result.current.startStream('conv-1')
    })
    expect(result.current.canStart('conv-1')).toBe(false)
  })
})

// ──────────────────────────────────────────────
// onToken — token accumulation
// ──────────────────────────────────────────────
describe('onToken', () => {
  it('accumulates tokens (observed via savePartialAll)', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('Hel', 'conv-1')
      result.current.onToken('lo', 'conv-1')
    })
    act(() => {
      result.current.savePartialAll()
    })
    const msg = lastSaved().messages.find((m) => m.id === 'streaming')
    expect(msg?.content).toBe('Hello')
  })

  it('updates streamingContent for the active conv', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('World', 'conv-1')
    })
    flushRaf()
    expect(result.current.streamingContent).toBe('World')
  })

  it('ignores tokens for a conv without a stream', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('ignored', 'conv-unknown')
    })
    flushRaf()
    expect(result.current.streamingContent).toBe('')
  })

  it('does not change the visible content for a background (non-active) stream', () => {
    const conv = makeConv()
    mockGetConversation.mockImplementation(((id: string) => makeConv(id)) as never)
    void conv
    const { result } = renderStreaming()
    startActive(result, 'conv-1') // active
    act(() => {
      result.current.startStream('conv-2') // background
    })
    act(() => {
      result.current.onToken('background tokens', 'conv-2')
    })
    flushRaf()
    expect(result.current.streamingContent).toBe('')
  })
})

// ──────────────────────────────────────────────
// savePartialAll — periodic / on-demand save
// ──────────────────────────────────────────────
describe('savePartialAll', () => {
  it('saves accumulated content to storage', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('partial text', 'conv-1')
    })
    act(() => {
      result.current.savePartialAll()
    })

    expect(mockSaveConversation).toHaveBeenCalled()
    const msg = lastSaved().messages.find((m) => m.id === 'streaming')
    expect(msg?.content).toBe('partial text')
  })

  it('does nothing when there is no accumulated content', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.savePartialAll()
    })
    expect(mockSaveConversation).not.toHaveBeenCalled()
  })

  it('does nothing when there are no streams', () => {
    const { result } = renderStreaming()
    act(() => {
      result.current.savePartialAll()
    })
    expect(mockGetConversation).not.toHaveBeenCalled()
  })

  it('updates the existing streaming message instead of pushing a new one', () => {
    const conv = makeConv('conv-1')
    conv.messages = [{ id: 'streaming', role: 'assistant', content: 'old', timestamp: 0 }]
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('new content', 'conv-1')
    })
    act(() => {
      result.current.savePartialAll()
    })

    const streamingMsgs = lastSaved().messages.filter((m) => m.id === 'streaming')
    expect(streamingMsgs).toHaveLength(1)
    expect(streamingMsgs[0]!.content).toBe('new content')
  })

  it('flushes ALL open streams, not just the active one', () => {
    mockGetConversation.mockImplementation(((id: string) => makeConv(id)) as never)
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.startStream('conv-2')
    })
    act(() => {
      result.current.onToken('one', 'conv-1')
      result.current.onToken('two', 'conv-2')
    })
    act(() => {
      result.current.savePartialAll()
    })
    const savedIds = mockSaveConversation.mock.calls.map((c) => (c[0] as unknown as TestConv).id)
    expect(savedIds).toContain('conv-1')
    expect(savedIds).toContain('conv-2')
  })
})

// ──────────────────────────────────────────────
// onDone — finalize
// ──────────────────────────────────────────────
describe('onDone', () => {
  it('replaces the streaming message with the final message', () => {
    const conv = makeConv('conv-1')
    conv.messages = [{ id: 'streaming', role: 'assistant', content: 'partial', timestamp: 0 }]
    mockGetConversation.mockReturnValue(conv as never)

    const { result, refreshConversations } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('final content', 'conv-1')
    })
    act(() => {
      result.current.onDone('conv-1')
    })

    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
    expect(result.current.hasStream('conv-1')).toBe(false)
    expect(refreshConversations).toHaveBeenCalled()

    const saved = lastSaved()
    expect(saved.messages.some((m) => m.id === 'streaming')).toBe(false)
    expect(saved.messages.some((m) => m.content === 'final content')).toBe(true)
  })

  it('finishing a background stream does not disturb the active conv UI', () => {
    mockGetConversation.mockImplementation(((id: string) => makeConv(id)) as never)
    const { result } = renderStreaming()
    startActive(result, 'conv-1') // active + streaming
    act(() => {
      result.current.startStream('conv-2') // background
    })
    act(() => {
      result.current.onDone('conv-2')
    })
    // conv-1 is still the active stream → UI keeps streaming.
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.hasStream('conv-2')).toBe(false)
  })
})

// ──────────────────────────────────────────────
// onError — error handling with partial save
// ──────────────────────────────────────────────
describe('onError', () => {
  it('saves partial content flagged as interrupted', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('partial', 'conv-1')
    })

    const err = new Error('Network error')
    act(() => {
      result.current.onError(err, 'conv-1')
    })

    expect(result.current.isStreaming).toBe(false)
    const lastMsg = lastSaved().messages.at(-1)!
    expect(lastMsg.content).toContain('partial')
    expect(lastMsg.interrupted).toBe(true)
  })

  it('returns the error object', () => {
    mockGetConversation.mockReturnValue(null as never)
    const { result } = renderStreaming()
    startActive(result, 'conv-1')

    const err = new Error('boom')
    let returned: Error | undefined
    act(() => {
      returned = result.current.onError(err, 'conv-1')
    })
    expect(returned).toBe(err)
  })

  it('clears the stream after an error', () => {
    mockGetConversation.mockReturnValue(null as never)
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onError(new Error('fail'), 'conv-1')
    })
    expect(result.current.hasStream('conv-1')).toBe(false)
  })
})

// ──────────────────────────────────────────────
// stopStreaming — abort + finalize
// ──────────────────────────────────────────────
describe('stopStreaming', () => {
  it('aborts the registered AbortController of the active conv', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    const abort = vi.fn()
    startActive(result, 'conv-1')
    act(() => {
      result.current.setAbortController('conv-1', { abort } as unknown as AbortController)
      result.current.onToken('some content', 'conv-1')
    })
    act(() => {
      result.current.stopStreaming()
    })

    expect(abort).toHaveBeenCalled()
  })

  it('saves partial content flagged as interrupted', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('partial stop', 'conv-1')
    })
    act(() => {
      result.current.stopStreaming()
    })

    const lastMsg = lastSaved().messages.at(-1)!
    expect(lastMsg.content).toContain('partial stop')
    expect(lastMsg.interrupted).toBe(true)
  })

  it('resets isStreaming and streamingContent for the active conv', () => {
    mockGetConversation.mockReturnValue(null as never)
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.stopStreaming()
    })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
  })

  it('can stop a specific background stream by id without touching the active one', () => {
    mockGetConversation.mockImplementation(((id: string) => makeConv(id)) as never)
    const { result } = renderStreaming()
    startActive(result, 'conv-1') // active
    act(() => {
      result.current.startStream('conv-2') // background
    })
    act(() => {
      result.current.stopStreaming('conv-2')
    })
    expect(result.current.hasStream('conv-2')).toBe(false)
    expect(result.current.isStreaming).toBe(true) // active conv-1 untouched
  })
})

// ──────────────────────────────────────────────
// completeStreaming — teardown after manual publish
// ──────────────────────────────────────────────
describe('completeStreaming', () => {
  it('clears the interval and resets the active UI state', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.completeStreaming('conv-1')
    })

    expect(clearIntervalSpy).toHaveBeenCalled()
    expect(result.current.hasStream('conv-1')).toBe(false)
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
  })
})

// ──────────────────────────────────────────────
// active-stream switching (multi-stream UI)
// ──────────────────────────────────────────────
describe('setActiveStream', () => {
  it('switches the displayed content to the newly active conv, then idles on null', () => {
    mockGetConversation.mockImplementation(((id: string) => makeConv(id)) as never)
    const { result } = renderStreaming()
    act(() => {
      result.current.setActiveStream('conv-1')
      result.current.startStream('conv-1')
      result.current.startStream('conv-2') // background
    })
    act(() => {
      result.current.onToken('alpha', 'conv-1')
      result.current.onToken('beta', 'conv-2')
    })
    flushRaf()
    expect(result.current.streamingContent).toBe('alpha')

    act(() => {
      result.current.setActiveStream('conv-2')
    })
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.streamingContent).toBe('beta')

    act(() => {
      result.current.setActiveStream(null)
    })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.streamingContent).toBe('')
  })
})

// ──────────────────────────────────────────────
// setHideContent / setProgressContent
// ──────────────────────────────────────────────
describe('display overrides', () => {
  it('setHideContent hides the live content of the active conv', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('secret', 'conv-1')
    })
    flushRaf()
    expect(result.current.streamingContent).toBe('secret')
    act(() => {
      result.current.setHideContent(true, 'conv-1')
    })
    expect(result.current.streamingContent).toBe('')
  })

  it('setProgressContent shows an ephemeral message for the active conv', () => {
    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.setProgressContent('📄 Reading PDF...', 'conv-1')
    })
    expect(result.current.streamingContent).toBe('📄 Reading PDF...')
  })
})

// ──────────────────────────────────────────────
// visibility / beforeunload auto-save
// ──────────────────────────────────────────────
describe('auto-save on visibility change / beforeunload', () => {
  it('saves partial when the document becomes hidden', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('auto-save-hidden', 'conv-1')
    })

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockSaveConversation).toHaveBeenCalled()
  })

  it('saves partial on beforeunload', () => {
    const conv = makeConv('conv-1')
    mockGetConversation.mockReturnValue(conv as never)

    const { result } = renderStreaming()
    startActive(result, 'conv-1')
    act(() => {
      result.current.onToken('before-unload-content', 'conv-1')
    })

    act(() => {
      window.dispatchEvent(new Event('beforeunload'))
    })

    expect(mockSaveConversation).toHaveBeenCalled()
  })
})
