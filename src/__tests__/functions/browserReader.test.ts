// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBrowserPage } from '../../../functions/api/_lib/browserReader'
import { onRequestPost } from '../../../functions/api/fetch/url'
import type { Env } from '../../../functions/env'
vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({ checkAllowedUserPeek: vi.fn() }))
vi.mock('../../../functions/api/_lib/freeQuota', () => ({
  consumeOwnerApiQuota: vi.fn(), ownerApiLimitResponse: vi.fn(), planSubjectToOwnerApiCap: () => false,
}))
import { checkAllowedUserPeek } from '../../../functions/api/_lib/checkAllowedUser'
const url = 'https://www.reddit.com/r/ChatGPT/comments/1vqo6kl/'
const request = (body: unknown = { url, readerPolicy: 'public-browser' }) => new Request('https://tryarty.com/api/fetch/url', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
let service: ReturnType<typeof vi.fn>, env: Env
beforeEach(() => {
  service = vi.fn().mockResolvedValue(Response.json({ status: 'read', markdown: 'Actual post body',
    receipt: { provider: 'arty-browser', requestedUrl: url, imagesIncluded: false } }))
  env = { URL_READER_ENABLED: 'true', URL_READER: { fetch: service }, LINKUP_API_KEY: 'synthetic' } as unknown as Env
  vi.mocked(checkAllowedUserPeek).mockResolvedValue({ email: 'reader@example.test', planType: 'vip' } as never)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ markdown: 'Legacy document' })))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('private browser gateway', () => {
  it('returns content and receipt without token, email, cookie or context transfer', async () => {
    const res = await onRequestPost({ request: request(), env } as never)
    expect(res.status).toBe(200)
    expect((await res.json()).receipt.provider).toBe('arty-browser')
    const options = service.mock.calls[0][1]
    const payload = JSON.parse(options.body)
    expect(payload).toEqual({ url, subject: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('auth failure cannot launch a browser', async () => {
    vi.mocked(checkAllowedUserPeek).mockResolvedValue(null)
    expect((await onRequestPost({ request: request(), env } as never)).status).toBe(401)
    expect(service).not.toHaveBeenCalled()
  })
  it.each([{}, { url: 'http://127.0.0.1/' }, { url, readerPolicy: 'anything' }])('invalid input refuses before service %j', async body => {
    expect((await onRequestPost({ request: request(body), env } as never)).status).toBe(400)
    expect(service).not.toHaveBeenCalled()
  })
  it.each(['blocked', 'wrong_page', 'missing_post_body', 'timeout'])('no legacy retry after %s', async reason => {
    service.mockResolvedValue(Response.json({ status: 'unreadable', reason }))
    expect((await onRequestPost({ request: request(), env } as never)).status).toBe(502)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rate limit and missing binding fail closed', async () => {
    service.mockResolvedValue(Response.json({ status: 'unavailable' }, { status: 429 }))
    expect((await fetchBrowserPage(env, request(), url, 'a')).status).toBe(429)
    delete env.URL_READER
    expect((await fetchBrowserPage(env, request(), url, 'a')).status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('unsupported profile alone permits legacy', async () => {
    service.mockResolvedValue(Response.json({ status: 'unsupported' }))
    const res = await onRequestPost({ request: request(), env } as never)
    expect((await res.json()).provider).toBe('linkup')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([{ url }, { url, readerPolicy: 'eu-only' }, { url: 'https://example.com/book.pdf', readerPolicy: 'public-browser' }])('legacy policy, EU and PDF do not enter browser %j', async body => {
    expect((await onRequestPost({ request: request(body), env } as never)).status).toBe(200)
    expect(service).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects mismatched receipt rather than exposing text', async () => {
    service.mockResolvedValue(Response.json({ status: 'read', markdown: 'Wrong post',
      receipt: { provider: 'arty-browser', requestedUrl: 'https://example.com/' } }))
    expect((await fetchBrowserPage(env, request(), url, 'a')).status).toBe(502)
  })
  it('propagates only bounded reason, stage and upstream status after a refusal', async () => {
    service.mockResolvedValue(Response.json({ status: 'unreadable', reason: 'site_security', stage: 'navigation', httpStatus: 403,
      message: 'private-provider-error', sessionId: 'private-session', receipt: { finalUrl: 'https://reddit.com/?challenge=secret' } }))
    const res = await fetchBrowserPage(env, request(), url, 'a')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Page unreadable', provider: 'arty-browser', reason: 'site_security', stage: 'navigation', upstreamHttpStatus: 403 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('discards unrecognised reasons and invalid diagnostic fields', async () => {
    service.mockResolvedValue(Response.json({ status: 'unreadable', reason: 'raw private error', stage: 'raw stack', httpStatus: '403' }))
    const first = await fetchBrowserPage(env, request(), url, 'a')
    expect(await first.json()).toEqual({ error: 'Page unreadable', provider: 'arty-browser', reason: 'not_read' })
    service.mockResolvedValue(Response.json({ status: 'unreadable', reason: 'blocked', stage: 'raw stack', httpStatus: 1000 }))
    expect(await (await fetchBrowserPage(env, request(), url, 'a')).json()).toEqual({ error: 'Page unreadable', provider: 'arty-browser', reason: 'blocked' })
  })
})
