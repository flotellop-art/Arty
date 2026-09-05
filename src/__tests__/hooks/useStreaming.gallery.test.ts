import { act, renderHook } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useStreaming } from '../../hooks/useStreaming'
import * as storage from '../../services/storage'
import { setActiveSession, clearActiveSession } from '../../services/userSession'
import { invalidateLocalDataViews } from '../../services/localDataInvalidation'

const id1 = '123e4567-e89b-12d3-a456-426614174000', id2 = '123e4567-e89b-12d3-a456-426614174001'
beforeEach(() => {
  localStorage.clear(); storage.resetConversationMemCache()
  setActiveSession({ userId: 'gallery', authMethod: 'demo', displayName: 'Synthetic', createdAt: 1 })
  localStorage.setItem('arty-conv-encryption-disabled', '1')
  storage.saveConversation({ id: 'c1', title: 'Gallery', messages: [], createdAt: 1, updatedAt: 1 })
})
afterEach(() => vi.restoreAllMocks())
function setup() {
  const hook = renderHook(() => useStreaming({ refreshConversations: vi.fn() }))
  const controller = new AbortController()
  act(() => { hook.result.current.setActiveStream('c1'); hook.result.current.startStream('c1'); hook.result.current.setAbortController('c1', controller) })
  const adopt = (id: string) => hook.result.current.adoptGeneratedImage('c1', hook.result.current.getInvocationId('c1')!, id, () => {})
  return { ...hook, adopt, controller }
}
describe('gallery receipt commit with real localStorage', () => {
  it('commits two receipts immediately without text and keeps them across accumulation reset', () => {
    const { result, adopt, unmount } = setup()
    act(() => { adopt(id1); adopt(id2); result.current.resetAccumulated('c1') })
    const durable = JSON.parse(localStorage.getItem('arty-gallery-conversations')!)
    expect(durable[0].messages[0].generatedImages).toEqual([id1, id2])
    act(() => result.current.onDone('c1'))
    expect(storage.getConversation('c1')?.messages[0]).toMatchObject({ content: '', generatedImages: [id1, id2] })
    unmount()
  })
  it.each([false, true])('quota failure never publishes a phantom receipt (prior=%s)', prior => {
    const { result, adopt, unmount } = setup()
    if (prior) act(() => adopt(id1))
    const before = structuredClone(storage.getConversations())
    const plain = localStorage.getItem('arty-gallery-conversations')
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    act(() => { expect(() => adopt(id2)).toThrow() })
    expect(storage.getConversations()).toEqual(before)
    expect(localStorage.getItem('arty-gallery-conversations')).toBe(plain)
    expect(result.current.streamingImages).toEqual(prior ? [id1] : [])
    write.mockRestore(); unmount()
  })
  it.each(['bus', 'storage', 'logoutFailure'] as const)('revokes live image scope on %s, no late final write', change => {
    const { result, adopt, controller, unmount } = setup()
    act(() => adopt(id1))
    const before = localStorage.getItem('arty-gallery-conversations')
    act(() => {
      if (change === 'bus') invalidateLocalDataViews()
      else if (change === 'storage') window.dispatchEvent(new StorageEvent('storage', { key: 'arty-project-erasure-fence' }))
      else {
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
        expect(() => clearActiveSession()).toThrow()
      }
      result.current.onToken('LATE', 'c1'); result.current.onDone('c1')
    })
    expect(controller.signal.aborted).toBe(true)
    expect(result.current.streamingImages).toEqual([])
    expect(result.current.isStreaming).toBe(false)
    expect(localStorage.getItem('arty-gallery-conversations')).toBe(before)
    unmount()
  })
  it('rejects stale invocation and duplicate receipt does not write twice', () => {
    const { result, adopt, unmount } = setup()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    act(() => { adopt(id1); adopt(id1) })
    expect(write).toHaveBeenCalledTimes(1)
    act(() => { expect(() => result.current.adoptGeneratedImage('c1', 'stale', id2, () => {})).toThrow() })
    expect(result.current.streamingImages).toEqual([id1]); unmount()
  })
})
