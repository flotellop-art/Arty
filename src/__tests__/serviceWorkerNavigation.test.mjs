// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
const currentName = source.match(/const CACHE_NAME = '([^']+)'/)[1]
const origin = 'https://tryarty.com'
const cacheKey = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href

function worker({ online = false, status = 200, body = 'NETWORK', openFails = false, matchFails = false, putFails = false, current = {}, old = {} } = {}) {
  const listeners = {}
  const values = new Map(Object.entries(current).map(([key, text]) => [cacheKey(key), text instanceof Response ? text : new Response(text)]))
  const cache = {
    match: vi.fn(async (key) => {
      if (matchFails) throw new Error('unavailable')
      return values.get(cacheKey(key))?.clone()
    }),
    put: vi.fn(async (key, response) => {
      if (putFails) throw new Error('quota exceeded')
      values.set(cacheKey(key), response)
    }),
  }
  const caches = {
    open: vi.fn(async (name) => { if (openFails) throw new Error('unavailable'); expect(name).toBe(currentName); return cache }),
    // A global match would incorrectly serve an old cache in offlineNavigation.
    match: vi.fn(async (key) => old[cacheKey(key)] ? new Response(old[cacheKey(key)]) : cache.match(key)),
  }
  const fetch = vi.fn(async () => { if (!online) throw new TypeError('network'); return new Response(body, { status }) })
  runInNewContext(source, { self: { location: { origin }, addEventListener: (name, handler) => { listeners[name] = handler } }, URL, Response, caches, fetch, setTimeout })
  async function request(path, { method = 'GET', mode = 'navigate' } = {}) {
    const pending = []
    const event = {
      request: { url: new URL(path, origin).href, method, mode },
      respondWith: vi.fn(),
      waitUntil: (promise) => pending.push(promise),
    }
    listeners.fetch(event)
    const response = event.respondWith.mock.calls.length ? await event.respondWith.mock.calls[0][0] : undefined
    await Promise.all(pending)
    return { response, event }
  }
  return { request, caches, cache, fetch, values }
}

describe('actual public service worker navigation', () => {
  it('uses v55 and preserves the cached guide security headers offline', async () => {
    expect(currentName).toBe('arty-cache-v55')
    const headers = { 'Content-Security-Policy': "default-src 'none'; script-src 'none'", 'Cache-Control': 'public, no-cache, no-transform', 'Content-Type': 'text/html; charset=utf-8' }
    const runtime = worker({ current: { '/install/': new Response('PUBLIC GUIDE', { headers }) } })
    const { response } = await runtime.request('/install/')
    for (const [name, value] of Object.entries(headers)) expect(response.headers.get(name)).toBe(value)
    expect(await response.text()).toBe('PUBLIC GUIDE')
  })

  it.each(['/install/', '/install/en/', '/install', '/install/en'])('serves only the exact current cached guide for %s', async (path) => {
    const runtime = worker({ current: { '/': 'PRIVATE SHELL', [path]: 'PUBLIC GUIDE' } })
    const { response } = await runtime.request(path)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('PUBLIC GUIDE')
    expect(runtime.caches.match).not.toHaveBeenCalled()
    expect(runtime.cache.match).toHaveBeenCalledWith(expect.objectContaining({ url: origin + path }))
  })

  it.each(['/install/', '/install/en/', '/install/?source=test'])('does not use the root or old cache when %s is absent', async (path) => {
    const runtime = worker({ current: { '/': 'PRIVATE SHELL' }, old: { [origin + path]: 'STALE SHELL' } })
    const { response } = await runtime.request(path)
    expect(response.status).toBe(503)
    expect(await response.text()).toContain('Hors ligne / Offline')
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(runtime.caches.match).not.toHaveBeenCalled()
  })

  it.each(['/install/inexistant', '/install/en/typo', '/install/index.html'])('rejects a cached SPA shell at unknown guide path %s', async (path) => {
    const runtime = worker({ current: { '/': 'PRIVATE SHELL', [path]: 'FAKE GUIDE SHELL' } })
    const { response } = await runtime.request(path)
    expect(response.status).toBe(503)
    expect(runtime.cache.match).not.toHaveBeenCalled()
  })

  it.each([{ openFails: true }, { matchFails: true }, {}])('returns a real 503 on cache failure or absence: %j', async (options) => {
    const runtime = worker(options)
    for (const path of ['/install/', '/connections']) {
      const { response } = await runtime.request(path)
      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(503)
    }
  })

  it('preserves the current root shell fallback for normal app navigation', async () => {
    const runtime = worker({ current: { '/': 'APP SHELL' } })
    const { response } = await runtime.request('/connections')
    expect(await response.text()).toBe('APP SHELL')
    expect(runtime.cache.match).toHaveBeenCalledWith('/')
  })

  it.each([404, 500])('does not mask or cache HTTP %s with an old success response', async (status) => {
    const runtime = worker({ online: true, status, body: 'ERROR', current: { '/install/': 'OLD GUIDE', '/': 'APP' } })
    const { response } = await runtime.request('/install/')
    expect(response.status).toBe(status)
    expect(await response.text()).toBe('ERROR')
    expect(runtime.cache.put).not.toHaveBeenCalled()
    expect(runtime.cache.match).not.toHaveBeenCalled()
  })

  it.each([{ putFails: true }, { openFails: true }, {}])('keeps the successful network response despite cache writes: %j', async (options) => {
    const runtime = worker({ ...options, online: true })
    const { response } = await runtime.request('/install/')
    expect(await response.text()).toBe('NETWORK')
    expect(runtime.cache.match).not.toHaveBeenCalled()
  })

  it.each([
    ['/api', 'GET'], ['/api/', 'GET'], ['/api/subscription/status', 'GET'],
    ['/api/calendar/events', 'POST'], ['/install/', 'POST'], ['/', 'HEAD'], ['/', 'DELETE'],
    ['https://other.example/asset.js', 'GET'], ['https://api.anthropic.com/v1/messages', 'GET'],
  ])('does not intercept %s %s', async (path, method) => {
    const runtime = worker()
    const { event } = await runtime.request(path, { method })
    expect(event.respondWith).not.toHaveBeenCalled()
    expect(runtime.fetch).not.toHaveBeenCalled()
    expect(runtime.caches.open).not.toHaveBeenCalled()
  })

  it('does not confuse /apiary with the API segment', async () => {
    const runtime = worker({ online: true })
    const { event, response } = await runtime.request('/apiary')
    expect(event.respondWith).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
  })
})
