// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createStreamBudget } from '../../../functions/api/_lib/streamBudget'
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('active streaming survives the former 50-second wall clock deadline', async () => {
  const budget = createStreamBudget(50_000, 90_000)
  let source!: ReadableStreamDefaultController<Uint8Array>
  const response = budget.accept(new Response(new ReadableStream({ start(c) { source = c } })))
  budget.dispose() // proxy returns while its body is still being read
  const reader = response.body!.getReader()
  for (let n = 0; n < 4; n++) {
    const next = reader.read()
    await vi.advanceTimersByTimeAsync(40_000)
    source.enqueue(new TextEncoder().encode(String(n)))
    expect((await next).done).toBe(false)
    expect(budget.signal.aborted).toBe(false)
  }
  source.close(); expect((await reader.read()).done).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('a silent upstream is cancelled even if its body ignores AbortSignal', async () => {
  const cancel = vi.fn(), budget = createStreamBudget(50_000, 90_000)
  const response = budget.accept(new Response(new ReadableStream({ cancel })))
  const rejection = expect(response.body!.getReader().read()).rejects.toMatchObject({ name: 'TimeoutError' })
  await vi.advanceTimersByTimeAsync(90_001); await rejection
  expect(budget.signal.aborted).toBe(true); expect(cancel).toHaveBeenCalledTimes(1)
})

it('connection attempts share a single deadline and disposal removes it', async () => {
  const budget = createStreamBudget(50_000, 90_000)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(budget.signal.aborted).toBe(false)
  // A fallback still sees the original signal/deadline.
  await vi.advanceTimersByTimeAsync(20_001)
  expect(budget.signal.aborted).toBe(true)
  budget.dispose(); expect(vi.getTimerCount()).toBe(0)
})

it('reader cancellation aborts the upstream and clears timers', async () => {
  const cancel = vi.fn(), budget = createStreamBudget(50_000, 90_000)
  const response = budget.accept(new Response(new ReadableStream({ cancel })))
  await response.body!.cancel('user stop')
  expect(budget.signal.aborted).toBe(true); expect(cancel).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancellation during a pending read closes once without a late controller error', async () => {
  const cancel = vi.fn(), budget = createStreamBudget(50_000, 90_000)
  const reader = budget.accept(new Response(new ReadableStream({ cancel }))).body!.getReader()
  const pending = reader.read()
  await vi.advanceTimersByTimeAsync(1)
  await reader.cancel('stopped')
  expect((await pending).done).toBe(true)
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('a parent deadline interrupts a pending read even for a non-cooperative body', async () => {
  const parent = new AbortController(), cancel = vi.fn()
  const budget = createStreamBudget(50_000, 90_000, parent.signal)
  const reader = budget.accept(new Response(new ReadableStream({ cancel }))).body!.getReader()
  const failure = expect(reader.read()).rejects.toThrow('video deadline')
  await vi.advanceTimersByTimeAsync(1)
  parent.abort(new Error('video deadline'))
  await failure
  expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
})
