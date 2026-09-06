import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
const fixture = vi.hoisted(() => ({ owner: 'a', epoch: 1, ready: true, read: vi.fn(), save: vi.fn() }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => fixture.owner, getActiveSessionEpoch: () => fixture.epoch, PROJECT_ERASURE_FENCE_KEY: 'fixture-fence' }))
vi.mock('../../services/storage', () => ({ getConversation: fixture.read, saveConversation: fixture.save, isCacheReady: () => fixture.ready }))
import { useStreaming } from '../../hooks/useStreaming'
import type { WorkflowObservation } from '../../services/workflows/outcome'

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); fixture.owner = 'a'; fixture.epoch = 1; fixture.ready = true
  fixture.save.mockReset(); fixture.read.mockReset()
  fixture.read.mockImplementation((id: string): Conversation => ({ id, title: 'Synthetic', createdAt: 1, updatedAt: 1, messages: [] }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
function setup(refresh = vi.fn()) {
  const hook = renderHook(() => useStreaming({ refreshConversations: refresh }))
  const observation = { settle: vi.fn(), discard: vi.fn() }
  act(() => {
    hook.result.current.startStream('chat')
    expect(hook.result.current.observeStreamCompletion('chat', hook.result.current.getInvocationId('chat')!, observation)).toBe(true)
  })
  return { ...hook, observation, refresh }
}
describe('exact stream terminal evidence, no telemetry transport', () => {
  it('acknowledges the local copy before reentrant UI notifications', () => {
    const order: string[] = [], { result, observation } = setup(vi.fn(() => { order.push('ui') }))
    fixture.save.mockImplementation(() => { order.push('saved') }); observation.settle.mockImplementation(() => { order.push('observed') })
    act(() => { result.current.onToken('Real synthetic answer', 'chat'); result.current.onDone('chat') })
    expect(order).toEqual(['saved', 'observed', 'ui']); expect(observation.settle).toHaveBeenCalledWith('saved')
    expect(result.current.hasStream('chat')).toBe(false); expect(observation.discard).not.toHaveBeenCalled()
  })
  it.each(['', ' \n\t '])('distinguishes empty output %j from a useful response', content => {
    const { result, observation } = setup()
    act(() => { result.current.onToken(content, 'chat'); result.current.onDone('chat') })
    expect(observation.settle).toHaveBeenCalledExactlyOnceWith('empty')
  })
  it.each(['quota', 'missing', 'closed'])('does not call a refused %s copy successful', mode => {
    const { result, observation } = setup()
    if (mode === 'quota') fixture.save.mockImplementation(() => { throw new DOMException('Synthetic quota', 'QuotaExceededError') })
    if (mode === 'missing') fixture.read.mockReturnValue(null)
    if (mode === 'closed') fixture.ready = false
    act(() => { result.current.onToken('Answer', 'chat'); result.current.onDone('chat') })
    expect(observation.settle).toHaveBeenCalledExactlyOnceWith('not_saved'); expect(result.current.hasStream('chat')).toBe(false)
  })
  it('keeps a committed success if the UI notification throws', () => {
    const { result, observation } = setup(vi.fn(() => { throw new Error('Synthetic UI failure') }))
    expect(() => act(() => { result.current.onToken('Answer', 'chat'); result.current.onDone('chat') })).not.toThrow()
    expect(observation.settle).toHaveBeenCalledExactlyOnceWith('saved'); expect(result.current.hasStream('chat')).toBe(false)
  })
  it('consumes evidence before a reentrant observer and still tears down', () => {
    const { result, observation } = setup()
    observation.settle.mockImplementation(() => { result.current.onDone('chat'); result.current.stopStreaming('chat'); throw new Error('Synthetic observer') })
    act(() => { result.current.onToken('Answer', 'chat'); result.current.onDone('chat'); result.current.onDone('chat') })
    expect(fixture.save).toHaveBeenCalledOnce(); expect(observation.settle).toHaveBeenCalledOnce(); expect(result.current.hasStream('chat')).toBe(false)
  })
  it('Stop cannot become success when abort synchronously calls done and error', () => {
    const { result, observation } = setup(), controller = new AbortController()
    controller.signal.addEventListener('abort', () => { result.current.onDone('chat'); result.current.onError(new Error('Abort callback'), 'chat') })
    act(() => { result.current.setAbortController('chat', controller); result.current.onToken('Partial', 'chat'); result.current.stopStreaming('chat') })
    expect(observation.settle).toHaveBeenCalledExactlyOnceWith('stopped'); expect(fixture.save).toHaveBeenCalledOnce()
    expect(fixture.save.mock.calls[0][0].messages.at(-1).interrupted).toBe(true); expect(result.current.hasStream('chat')).toBe(false)
  })
  it.each(['', 'Partial'])('keeps provider failure distinct with content %j', content => {
    const { result, observation } = setup()
    act(() => { result.current.onToken(content, 'chat'); result.current.onError(new Error('Synthetic provider failure'), 'chat'); result.current.onDone('chat') })
    expect(observation.settle).toHaveBeenCalledExactlyOnceWith('error')
  })
  it('does not remove a replacement stream created by a commit notification', () => {
    let replace = () => {}
    const { result, observation } = setup(vi.fn(() => replace())), old = result.current.getInvocationId('chat')
    replace = () => { result.current.discardStream('chat'); expect(result.current.startStream('chat')).toBe(true) }
    act(() => { result.current.onToken('Answer', 'chat'); result.current.onDone('chat') })
    expect(observation.settle).toHaveBeenCalledExactlyOnceWith('saved'); expect(result.current.hasStream('chat')).toBe(true)
    expect(result.current.getInvocationId('chat')).not.toBe(old)
  })
  it('abandons a lost owner without saving or reporting an error', () => {
    const { result, observation } = setup(); fixture.owner = 'b'; fixture.epoch++
    act(() => { result.current.onToken('Late A', 'chat'); result.current.onDone('chat') })
    expect(fixture.save).not.toHaveBeenCalled(); expect(observation.settle).not.toHaveBeenCalled(); expect(observation.discard).toHaveBeenCalledOnce()
  })
  it.each(['stop', 'error'])('does not write an old %s result into a reentrant replacement', mode => {
    const { result, observation } = setup()
    observation.settle.mockImplementation(() => {
      result.current.discardStream('chat'); result.current.startStream('chat'); result.current.onToken('New answer', 'chat')
    })
    const old = result.current.getInvocationId('chat')
    act(() => { result.current.onToken('Old partial', 'chat'); if (mode === 'stop') result.current.stopStreaming('chat'); else result.current.onError(new Error('Synthetic'), 'chat') })
    expect(fixture.save).not.toHaveBeenCalled(); expect(result.current.getInvocationId('chat')).not.toBe(old)
    expect(result.current.hasStream('chat')).toBe(true)
    act(() => result.current.onDone('chat'))
    expect(fixture.save.mock.calls[0][0].messages.at(-1).content).toBe('New answer')
  })
  it('consumes a periodic storage failure before abort callbacks run', () => {
    const { result, observation } = setup(), controller = new AbortController()
    controller.signal.addEventListener('abort', () => result.current.onDone('chat'))
    fixture.save.mockImplementation(() => { throw new Error('Synthetic quota') })
    act(() => { result.current.setAbortController('chat', controller); result.current.onToken('Partial', 'chat'); vi.advanceTimersByTime(3001) })
    expect(observation.settle).toHaveBeenCalledExactlyOnceWith('not_saved'); expect(result.current.hasStream('chat')).toBe(false)
  })
  it.each(['discard', 'unmount'])('abandons on %s without inventing a terminal failure', mode => {
    const { result, observation, unmount } = setup()
    act(() => { result.current.onToken('Partial', 'chat'); if (mode === 'discard') result.current.discardStream('chat'); else unmount() })
    expect(observation.settle).not.toHaveBeenCalled(); expect(observation.discard).toHaveBeenCalledOnce()
  })
  it.each(['pagehide', 'beforeunload'])('does not turn a failed closing flush into a %s failure declaration', event => {
    const { result, observation } = setup()
    fixture.save.mockImplementation(() => { throw new Error('quota') })
    act(() => { result.current.onToken('Partial', 'chat'); window.dispatchEvent(new Event(event)) })
    expect(observation.settle).not.toHaveBeenCalled(); expect(observation.discard).toHaveBeenCalledOnce()
  })
  it('refuses an observer for another invocation, an occupied stream or a missing target', () => {
    const { result } = setup(), observer: WorkflowObservation = { settle() {}, discard() {} }
    expect(result.current.observeStreamCompletion('chat', 'stale', observer)).toBe(false)
    expect(result.current.observeStreamCompletion('chat', result.current.getInvocationId('chat')!, observer)).toBe(false)
    expect(result.current.observeStreamCompletion('absent', 'id', observer)).toBe(false)
  })
})
