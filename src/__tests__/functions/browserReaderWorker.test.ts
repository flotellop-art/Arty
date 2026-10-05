// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import worker from '../../../services/url-reader/src/index'
describe('private Worker lifecycle integration', () => {
  it('retains completion in waitUntil and releases admission when Stop precedes launch', async () => {
    const controller = new AbortController(); controller.abort()
    const calls: unknown[] = [], background: Promise<unknown>[] = []
    const stub = { fetch: vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body); calls.push(body)
      return Response.json(body.release ? { released: true } : { allowed: true, lease: 'test-lease' })
    }) }
    const acquire = vi.fn()
    const env = { BROWSER: { fetch: acquire }, READER_PROFILES: '[{"hosts":["example.com"],"resources":[]}]',
      ADMISSION: { idFromName: () => 'test-id', get: () => stub } }
    const req = new Request('https://reader.internal/', { method: 'POST', signal: controller.signal,
      body: JSON.stringify({ url: 'https://example.com/', subject: 'a'.repeat(64) }) })
    const pending = worker.fetch(req, env as never, { waitUntil: p => background.push(p) } as never)
    expect(background).toHaveLength(1) // retained while the operation is still suspended
    const res = await pending
    expect((await res.json()).status).toBe('unreadable')
    expect(background).toHaveLength(2)
    await Promise.all(background)
    expect(calls).toContainEqual({ release: 'test-lease' }); expect(acquire).not.toHaveBeenCalled()
  })
  it('reconciliation only releases sessions attested absent, preserves unknown and live leases', async () => {
    const fetch = vi.fn(async (_url: string, init: { body: string }) => {
      return Response.json(JSON.parse(init.body).inspect ? { leases: { gone: { sessionId: 'gone' }, live: { sessionId: 'live' }, unknown: {} } } : { released: true })
    })
    const env = { BROWSER: { getSession: async id => id === 'gone' ? null : { sessionId: id } },
      ADMISSION: { idFromName: () => 'id', get: () => ({ fetch }) } }
    const res = await worker.fetch(new Request('https://reader.internal/reconcile', { method: 'POST' }), env as never, { waitUntil: () => {} } as never)
    expect(await res.json()).toEqual({ released: 1, retained: 2 })
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ release: 'gone' })
  })
})
