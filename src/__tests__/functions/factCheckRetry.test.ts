import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAnthropicWithRetry,
  isRetryableAnthropicResponse,
} from '../../../functions/api/ai/fact-check'

describe('endpoint fact-check, reprise sur erreurs Anthropic', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('réessaie deux fois les 5xx transitoires avant de réussir', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 529 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const pending = fetchAnthropicWithRetry('{}', 'test-key', 5_000, 3)
    await vi.runAllTimersAsync()
    const response = await pending

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('ne répète pas une erreur déclarée déterministe par Anthropic', async () => {
    fetchMock.mockResolvedValue(new Response('', {
      status: 500,
      headers: { 'x-should-retry': 'false' },
    }))

    const response = await fetchAnthropicWithRetry('{}', 'test-key', 5_000, 3)

    expect(response.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(isRetryableAnthropicResponse(response)).toBe(false)
  })

  it('reprend aussi après une coupure réseau brève', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network reset'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const pending = fetchAnthropicWithRetry('{}', 'test-key', 5_000, 3)
    await vi.runAllTimersAsync()
    const response = await pending

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
