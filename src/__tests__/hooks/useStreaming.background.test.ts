import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useStreaming } from '../../hooks/useStreaming'
import { invalidateLocalDataViews } from '../../services/localDataInvalidation'

const mock = vi.hoisted(() => ({ acquire: vi.fn(), save: vi.fn(), user: 'a', epoch: 1 }))
vi.mock('../../services/native/generation', () => ({ acquireGeneration: mock.acquire }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => mock.user, getActiveSessionEpoch: () => mock.epoch, PROJECT_ERASURE_FENCE_KEY: 'fence' }))
vi.mock('../../services/storage', () => ({ isCacheReady: () => true, getConversation: (id: string) => ({ id, messages: [] }), saveConversation: mock.save }))
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mock.user = 'a'; mock.epoch = 1
  mock.acquire.mockImplementation(() => ({ ready: Promise.resolve(), release: vi.fn() }))
})
afterEach(() => vi.useRealTimers())

it('keeps the second generation active and persists the first before releasing its lease', () => {
  const { result, unmount } = renderHook(() => useStreaming({ refreshConversations: vi.fn() }))
  act(() => { result.current.startStream('a'); result.current.startStream('b'); result.current.onToken('complete', 'a') })
  const a = mock.acquire.mock.results[0]!.value, b = mock.acquire.mock.results[1]!.value
  a.release.mockImplementation(() => expect(mock.save).toHaveBeenCalled())
  act(() => result.current.onDone('a'))
  expect(a.release).toHaveBeenCalledTimes(1); expect(b.release).not.toHaveBeenCalled()
  expect(result.current.hasStream('b')).toBe(true)
  unmount(); expect(b.release).toHaveBeenCalledTimes(1)
})

it.each(['stop', 'account', 'invalidate'] as const)('%s while starting prevents a late dispatch', async reason => {
  let resolve!: () => void
  const release = vi.fn()
  mock.acquire.mockReturnValue({ ready: new Promise<void>(r => { resolve = r }), release })
  const { result } = renderHook(() => useStreaming({ refreshConversations: vi.fn() }))
  act(() => { result.current.startStream('a') })
  const fetch = vi.fn(), request = result.current.awaitStreamReady('a').then(fetch)
  const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' })
  act(() => {
    if (reason === 'stop') result.current.stopStreaming('a')
    else if (reason === 'account') { mock.user = 'b'; mock.epoch++ }
    else invalidateLocalDataViews()
  })
  resolve(); await rejection; expect(fetch).not.toHaveBeenCalled()
  if (reason !== 'account') expect(release).toHaveBeenCalledTimes(1)
})

it('native expiry preserves a partial reply, cancels transport, and frees the slot', () => {
  const { result } = renderHook(() => useStreaming({ refreshConversations: vi.fn() }))
  const controller = new AbortController()
  act(() => { result.current.startStream('a'); result.current.setAbortController('a', controller); result.current.onToken('partial', 'a') })
  act(() => mock.acquire.mock.calls[0]![0]())
  expect(controller.signal.aborted).toBe(true)
  expect(result.current.hasStream('a')).toBe(false)
  expect(mock.save.mock.calls[0]![0].messages[0]).toMatchObject({ content: 'partial', interrupted: true })
})

it('expiry while still thinking surfaces an error even without any received token', () => {
  const onBackgroundError = vi.fn()
  const { result } = renderHook(() => useStreaming({ refreshConversations: vi.fn(), onBackgroundError }))
  act(() => result.current.startStream('a'))
  act(() => mock.acquire.mock.calls[0]![0]())
  expect(onBackgroundError).toHaveBeenCalledWith(expect.any(String), 'a')
  expect(result.current.hasStream('a')).toBe(false)
  expect(mock.save).not.toHaveBeenCalled()
})
