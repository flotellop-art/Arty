// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readWithBrowser, READ_DEADLINE_MS } from '../../../services/url-reader/src/read'
const profile = { hosts: ['example.com'], resources: ['example.com'] }
function fakeBrowser() {
  const frame = {}, listeners = new Map<string, Array<(value: any) => void>>()
  const cdpListeners = new Map<string, Array<(value: any) => void>>()
  let loaderSequence = 0
  let currentUrl = 'https://example.com/'
  const emit = (name: string, value: unknown) => listeners.get(name)?.forEach(fn => fn(value))
  const cdpEmit = (name: string, value: unknown) => cdpListeners.get(name)?.forEach(fn => fn(value))
  const page = {
    setBypassServiceWorker: vi.fn(), setRequestInterception: vi.fn(),
    on: (name: string, fn: (value: any) => void) => { listeners.set(name, [...(listeners.get(name) ?? []), fn]) },
    mainFrame: () => frame,
    createCDPSession: async () => ({
      send: vi.fn(async method => method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } } : undefined),
      on: (name: string, fn: (value: any) => void) => { cdpListeners.set(name, [...(cdpListeners.get(name) ?? []), fn]) },
    }), evaluateOnNewDocument: vi.fn(),
    goto: vi.fn(async () => navigate(200).response),
    evaluate: async () => ({ status: 'read', markdown: 'Visible body', receipt: {} }),
    url: () => currentUrl,
  }
  function beginNavigate(status: number, url = 'https://example.com/', headers: Record<string, string> = { 'content-type': 'text/html' }) {
    const loaderId = `loader-${++loaderSequence}`
    const request = { isNavigationRequest: () => true, frame: () => frame, url: () => url, method: () => 'GET',
      resourceType: () => 'document', continue: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) }
    const response = { request: () => request, status: () => status, headers: () => headers }
    cdpEmit('Network.requestWillBeSent', { frameId: 'main', type: 'Document', loaderId })
    emit('request', request); emit('response', response)
    const commit = () => { currentUrl = url; cdpEmit('Page.frameNavigated', { frame: { id: 'main', loaderId } }); emit('framenavigated', frame) }
    return { request, response, commit }
  }
  function navigate(status: number, url = 'https://example.com/', headers: Record<string, string> = { 'content-type': 'text/html' }) {
    const navigation = beginNavigate(status, url, headers); navigation.commit(); return navigation
  }
  const navigateWithinDocument = (url: string) => { currentUrl = url; emit('framenavigated', frame) }
  return { page, navigate, beginNavigate, navigateWithinDocument, emit, browser: { newPage: async () => page, close: vi.fn().mockResolvedValue(undefined) } }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
describe('browser lifecycle', () => {
  it('closes a successful read before permitting lease release', async () => {
    const { browser } = fakeBrowser()
    const r = await readWithBrowser({} as never, 'https://example.com/', profile, new AbortController().signal, async () => browser as never)
    expect(r.result.status).toBe('read'); expect(r.cleanupConfirmed).toBe(true); expect(browser.close).toHaveBeenCalledTimes(1)
  })
  it('keeps admission slot if close fails', async () => {
    const { browser } = fakeBrowser(); browser.close.mockRejectedValue(new Error('unknown'))
    const r = await readWithBrowser({} as never, 'https://example.com/', profile, new AbortController().signal, async () => browser as never)
    expect(r.cleanupConfirmed).toBe(false)
  })
  it('bounded deadline closes a launch which resolves late without reading the page', async () => {
    vi.useFakeTimers()
    const { browser } = fakeBrowser(); const newPage = vi.spyOn(browser, 'newPage')
    let resolve!: (b: never) => void
    const launch = () => new Promise<never>(r => { resolve = r })
    const pending = readWithBrowser({} as never, 'https://example.com/', profile, new AbortController().signal, launch)
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS)
    const r = await pending
    expect(r.result).toMatchObject({ status: 'unreadable', reason: 'timeout' })
    expect(r.cleanupConfirmed).toBe(false)
    resolve(browser as never); await vi.advanceTimersByTimeAsync(0)
    expect(browser.close).toHaveBeenCalledTimes(1); expect(newPage).not.toHaveBeenCalled()
  })
  it('already aborted input does not acquire', async () => {
    const controller = new AbortController(); controller.abort()
    const launch = vi.fn()
    const r = await readWithBrowser({} as never, 'https://example.com/', profile, controller.signal, launch)
    expect(r.result.status).toBe('unreadable'); expect(launch).not.toHaveBeenCalled(); expect(r.cleanupConfirmed).toBe(true)
  })
  it('binding status closing is not an attested closure even if Puppeteer would resolve close', async () => {
    const { browser } = fakeBrowser()
    const binding = { closeSession: vi.fn().mockResolvedValue({ status: 'closing' }), getSession: vi.fn().mockResolvedValue({ sessionId: 'remote' }) }
    const r = await readWithBrowser(binding as never, 'https://example.com/', profile, new AbortController().signal,
      async (_binding, _domains, acquired) => { await acquired('remote'); return browser as never })
    expect(r.cleanupConfirmed).toBe(false); expect(await r.completion).toBe(false)
    expect(browser.close).not.toHaveBeenCalled()
  })
  it('discards a readable old DOM while a main navigation reaches a security refusal', async () => {
    vi.useFakeTimers()
    const { browser, page, navigate, emit } = fakeBrowser()
    let oldResponse: unknown
    page.goto.mockImplementation(async () => { const initial = navigate(200); oldResponse = initial.response; return initial.response })
    page.evaluate = vi.fn().mockImplementationOnce(async () => {
      navigate(403); emit('response', oldResponse) // late 200 must not overwrite this document's 403
      return { status: 'read', markdown: 'Stale article', receipt: {} }
    }).mockResolvedValue({ status: 'unreadable', reason: 'site_security', receipt: {} })
    const launcher = vi.fn(async () => browser as never)
    const pending = readWithBrowser({} as never, 'https://example.com/', profile, new AbortController().signal, launcher)
    await vi.advanceTimersByTimeAsync(2000)
    const r = await pending
    expect(r.result).toMatchObject({ status: 'unreadable', reason: 'site_security', httpStatus: 403 })
    expect(r.result).not.toHaveProperty('markdown'); expect(launcher).toHaveBeenCalledTimes(1); expect(page.goto).toHaveBeenCalledTimes(1)
    expect(r.cleanupConfirmed).toBe(true)
  })
  it('keeps the final status after an allowed redirect chain', async () => {
    vi.useFakeTimers()
    const { browser, page, navigate } = fakeBrowser()
    page.goto.mockImplementation(async () => {
      const initial = navigate(200)
      setTimeout(() => navigate(302), 50); setTimeout(() => navigate(201), 100)
      return initial.response
    })
    const pending = readWithBrowser({} as never, 'https://example.com/', profile, new AbortController().signal, async () => browser as never)
    await vi.advanceTimersByTimeAsync(1800)
    expect((await pending).result).toMatchObject({ status: 'read', receipt: { httpStatus: 201 } })
  })
  it('recovers context loss only when a new main navigation was observed during that extraction', async () => {
    vi.useFakeTimers()
    const { browser, page, navigate } = fakeBrowser()
    page.evaluate = vi.fn().mockImplementationOnce(async () => { navigate(200); throw new Error('Execution context was destroyed') })
      .mockResolvedValue({ status: 'read', markdown: 'New document', receipt: {} })
    const pending = readWithBrowser({} as never, 'https://example.com/', profile, new AbortController().signal, async () => browser as never)
    await vi.advanceTimersByTimeAsync(2000)
    expect((await pending).result).toMatchObject({ status: 'read', markdown: 'New document' })
    expect(page.goto).toHaveBeenCalledTimes(1); expect(page.evaluate).toHaveBeenCalledTimes(2)
  })
  it('reports unrelated extraction errors without retry or raw error leakage', async () => {
    vi.useFakeTimers()
    const { browser, page } = fakeBrowser()
    page.evaluate = vi.fn().mockRejectedValue(new Error('Execution context was destroyed; private-session-token'))
    const pending = readWithBrowser({} as never, 'https://example.com/', profile, new AbortController().signal, async () => browser as never)
    await vi.advanceTimersByTimeAsync(1200)
    const r = await pending
    expect(r.result).toMatchObject({ reason: 'extraction_failed', stage: 'extraction' })
    expect(JSON.stringify(r.result)).not.toContain('private-session-token'); expect(page.evaluate).toHaveBeenCalledTimes(1)
  })
  it('keeps a forbidden main navigation diagnosis when goto throws', async () => {
    const { browser, page, navigate } = fakeBrowser()
    let refused: ReturnType<typeof navigate> | undefined
    page.goto.mockImplementation(async () => { refused = navigate(200, 'https://foreign.example/'); throw new Error('net::ERR_ABORTED') })
    const r = await readWithBrowser({} as never, 'https://example.com/', profile, new AbortController().signal, async () => browser as never)
    expect(r.result).toMatchObject({ reason: 'restricted_navigation', stage: 'navigation' })
    expect(refused!.request.abort).toHaveBeenCalledTimes(1); expect(refused!.request.continue).not.toHaveBeenCalled()
  })
  it('Stop during a redirect wins over a stale successful extraction', async () => {
    vi.useFakeTimers()
    const { browser, page, navigate } = fakeBrowser(), controller = new AbortController()
    page.evaluate = vi.fn(async () => { navigate(200); controller.abort(); return { status: 'read', markdown: 'Too late', receipt: {} } })
    const pending = readWithBrowser({} as never, 'https://example.com/', profile, controller.signal, async () => browser as never)
    await vi.advanceTimersByTimeAsync(1200)
    const r = await pending
    expect(r.result).toMatchObject({ status: 'unreadable', reason: 'timeout' }); expect(r.result).not.toHaveProperty('markdown')
    expect(r.cleanupConfirmed).toBe(true)
  })
  it('distinguishes Cloudflare guardrails from a site refusal', async () => {
    vi.useFakeTimers()
    const { browser, page, navigate } = fakeBrowser()
    page.goto.mockImplementation(async () => navigate(403, 'https://example.com/', { 'content-type': 'text/html', 'cf-mitigated': 'guardrails' }).response)
    const evaluate = vi.spyOn(page, 'evaluate')
    const pending = readWithBrowser({} as never, 'https://example.com/', profile, new AbortController().signal, async () => browser as never)
    await vi.advanceTimersByTimeAsync(1000)
    expect((await pending).result).toMatchObject({ reason: 'guardrail', httpStatus: 403 }); expect(evaluate).not.toHaveBeenCalled()
  })
  it('invalidates a successful extraction after a same-document URL change without a network request', async () => {
    vi.useFakeTimers()
    const { browser, page, navigateWithinDocument } = fakeBrowser()
    page.evaluate = vi.fn().mockImplementationOnce(async () => {
      setTimeout(() => navigateWithinDocument('https://example.com/another-article'), 50)
      return { status: 'read', markdown: 'Previous article', receipt: {} }
    }).mockResolvedValue({ status: 'unreadable', reason: 'wrong_page', receipt: {} })
    const pending = readWithBrowser({} as never, 'https://example.com/', profile, new AbortController().signal, async () => browser as never)
    await vi.advanceTimersByTimeAsync(1800)
    const r = await pending
    expect(r.result).toMatchObject({ status: 'unreadable', reason: 'wrong_page' }); expect(r.result).not.toHaveProperty('markdown')
    expect(page.evaluate).toHaveBeenCalledTimes(2); expect(page.goto).toHaveBeenCalledTimes(1)
  })
  it('does not evaluate the old DOM when a new response arrives before its document commits', async () => {
    vi.useFakeTimers()
    const { browser, page, beginNavigate } = fakeBrowser()
    page.evaluate = vi.fn().mockImplementationOnce(async () => {
      const next = beginNavigate(201)
      setTimeout(next.commit, 900)
      return { status: 'read', markdown: 'Old document', receipt: {} }
    }).mockResolvedValue({ status: 'read', markdown: 'Committed document', receipt: {} })
    const pending = readWithBrowser({} as never, 'https://example.com/', profile, new AbortController().signal, async () => browser as never)
    await vi.advanceTimersByTimeAsync(1200)
    expect(page.evaluate).toHaveBeenCalledTimes(1) // response alone is insufficient
    await vi.advanceTimersByTimeAsync(1400)
    expect((await pending).result).toMatchObject({ status: 'read', markdown: 'Committed document', receipt: { httpStatus: 201 } })
    expect(page.goto).toHaveBeenCalledTimes(1)
  })
})
