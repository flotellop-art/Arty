// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readWithBrowser, READ_DEADLINE_MS } from '../../../services/url-reader/src/read'
const profile = { hosts: ['example.com'], resources: ['example.com'] }
function fakeBrowser() {
  const page = {
    setBypassServiceWorker: vi.fn(), setRequestInterception: vi.fn(), on: vi.fn(),
    createCDPSession: async () => ({ send: vi.fn() }), evaluateOnNewDocument: vi.fn(),
    goto: async () => ({ status: () => 200, headers: () => ({ 'content-type': 'text/html' }) }),
    evaluate: async () => ({ status: 'read', markdown: 'Visible body', receipt: {} }),
    url: () => 'https://example.com/',
  }
  return { page, browser: { newPage: async () => page, close: vi.fn().mockResolvedValue(undefined) } }
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
})
