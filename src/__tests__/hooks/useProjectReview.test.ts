import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useProjectReview } from '../../hooks/useProjectReview'
import type { ProjectReview } from '../../services/projects/chatPreparation'
const request: ProjectReview = { kind: 'confirm', provider: 'claude', context: null, question: 'Q', textChars: 32_000, binaryBytes: 0, historyMessages: 0, files: [], systemPrompt: 'SP' }
describe('invocation-bound review answers', () => {
  it('an old confirmation cannot approve a replacement request, even in one React batch', async () => {
    const hook = renderHook(() => useProjectReview()), first = new AbortController(), second = new AbortController()
    let a!: ReturnType<typeof hook.result.current.review>, b!: typeof a
    act(() => { a = hook.result.current.review(request, first.signal) })
    const oldId = hook.result.current.request!.reviewId
    act(() => { first.abort(); b = hook.result.current.review(request, second.signal) })
    const newId = hook.result.current.request!.reviewId
    expect(newId).not.toBe(oldId)
    act(() => hook.result.current.answer(oldId, true))
    expect(hook.result.current.request?.reviewId).toBe(newId)
    act(() => hook.result.current.answer(newId, true))
    expect(await a).toBeNull(); expect(await b).toBe(true); hook.unmount()
  })
  it('unmount and Stop resolve cancellation, never a hanging composer promise', async () => {
    const hook = renderHook(() => useProjectReview()), controller = new AbortController()
    let pending!: ReturnType<typeof hook.result.current.review>
    act(() => { pending = hook.result.current.review(request, controller.signal) })
    hook.unmount(); expect(await pending).toBeNull()
  })
})
