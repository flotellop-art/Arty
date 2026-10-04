import puppeteer, { type Browser, type HTTPRequest } from '@cloudflare/puppeteer'
import { extractRenderedPage } from './extract'
import { permitsRequest, type ReaderProfile } from './policy'

export const READ_DEADLINE_MS = 20_000
export const CLEANUP_DEADLINE_MS = 3_000
export type ReaderBrowserBinding = Fetcher & {
  closeSession(id: string): Promise<{ status: 'closed' | 'closing' }>
  getSession(id: string): Promise<unknown | null>
}
export type BrowserLauncher = (binding: ReaderBrowserBinding, domains: string[], acquired: (id: string) => Promise<void>) => Promise<Browser>
const launch: BrowserLauncher = async (binding, domains, acquired) => {
  const session = await puppeteer.acquire(binding, { guardrails: { allowedDomains: domains } })
  await acquired(session.sessionId)
  return puppeteer.connect(binding, session.sessionId)
}

export async function readWithBrowser(binding: ReaderBrowserBinding, url: string, profile: ReaderProfile,
  signal: AbortSignal, launcher = launch, onAcquire?: (id: string) => Promise<void>) {
  let browser: Browser | undefined, expired = false, interceptedNavigation = false, closed = false, launchAttempted = false
  let closePromise: Promise<void> | undefined
  let sessionId: string | undefined
  const close = () => closePromise ??= (async () => {
    if (sessionId) {
      // Puppeteer's CF adapter swallows Browser.close errors. Use the binding's
      // typed API and explicit closed/absent-session attestation instead.
      const result = await binding.closeSession(sessionId)
      closed = result.status === 'closed' || await binding.getSession(sessionId) === null
      browser?.disconnect()
    } else if (browser) {
      // Test/custom launcher without a remote session handle.
      await browser.close(); closed = true
    }
  })().catch(() => undefined)
  let timeout!: ReturnType<typeof setTimeout>
  let abort!: () => void
  const stop = new Promise<never>((_, reject) => {
    abort = () => { expired = true; void close(); reject(new Error('reader_timeout')) }
    timeout = setTimeout(abort, READ_DEADLINE_MS)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  const started = Date.now()
  const work = (async () => {
    if (expired) throw new Error('reader_timeout')
    if (launcher === launch && (typeof binding.closeSession !== 'function' || typeof binding.getSession !== 'function')) {
      throw new Error('binding_unavailable')
    }
    // Late acquisition still closes: racing a launch does not cancel it remotely.
    launchAttempted = true
    browser = await launcher(binding, profile.resources, async id => {
      sessionId = id
      await onAcquire?.(id)
      if (expired) { closePromise = undefined; await close(); throw new Error('reader_timeout') }
    })
    if (expired) { closePromise = undefined; await close(); throw new Error('reader_timeout') }
    const page = await browser.newPage()
    await page.setBypassServiceWorker(true)
    await page.setRequestInterception(true)
    page.on('popup', popup => { void popup?.close().catch(() => undefined) })
    page.on('request', (req: HTTPRequest) => {
      const navigation = req.isNavigationRequest()
      const allowed = !expired && permitsRequest(profile, req.url(), req.method(), req.resourceType(), navigation)
      if (!allowed && navigation && req.frame() === page.mainFrame()) interceptedNavigation = true
      void (allowed ? req.continue() : req.abort()).catch(() => undefined)
    })
    const cdp = await page.createCDPSession()
    await cdp.send('Network.enable')
    await cdp.send('Network.setBlockedURLs', { urls: ['ws://*', 'wss://*', 'file://*', 'ftp://*'] })
    await page.evaluateOnNewDocument(() => {
      // No secondary communication channel or background registration.
      for (const name of ['WebSocket', 'WebTransport', 'RTCPeerConnection', 'SharedWorker', 'Worker']) {
        Object.defineProperty(globalThis, name, { value: undefined, configurable: false })
      }
      if (navigator.serviceWorker) {
        Object.defineProperty(navigator.serviceWorker, 'register', { value: () => Promise.reject(new Error('disabled')) })
      }
    })
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12_000 })
    const httpStatus = response?.status() ?? null
    const headers = response?.headers() ?? {}
    if (!httpStatus || httpStatus >= 400 || headers['cf-mitigated']) {
      return { status: 'unreadable', reason: 'blocked', httpStatus }
    }
    if (!headers['content-type']?.includes('text/html')) return { status: 'unreadable', reason: 'unsupported_content', httpStatus }
    // Wait for visible content, not network idleness (analytics can run forever).
    let result = await page.evaluate(extractRenderedPage, url)
    while (result.status !== 'read' && ['missing_body', 'missing_post_body'].includes(result.reason ?? '')
      && Date.now() - started < 17_000 && !expired) {
      await new Promise(resolve => setTimeout(resolve, 350))
      result = await page.evaluate(extractRenderedPage, url)
    }
    if (interceptedNavigation || !profile.hosts.includes(new URL(page.url()).hostname)) {
      return { status: 'unreadable', reason: 'wrong_page', httpStatus }
    }
    return { ...result, receipt: { ...result.receipt, httpStatus } }
  })()
  let result: Awaited<typeof work> | { status: string; reason: string }
  try {
    result = await Promise.race([work, stop])
  } catch {
    result = { status: 'unreadable', reason: expired ? 'timeout' : 'navigation_failed' }
  } finally {
    expired = true
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    // No unhandled rejection if a pending acquisition or evaluate finishes late.
    void work.catch(() => undefined)
    let cleanupTimer!: ReturnType<typeof setTimeout>
    await Promise.race([close(), new Promise<void>(resolve => { cleanupTimer = setTimeout(resolve, CLEANUP_DEADLINE_MS) })])
    clearTimeout(cleanupTimer)
  }
  const completion = work.then(() => close(), () => close()).then(() => closed || !launchAttempted)
  return { result, cleanupConfirmed: closed || !launchAttempted, completion }
}
