import puppeteer, { type Browser, type HTTPRequest, type HTTPResponse } from '@cloudflare/puppeteer'
import { extractRenderedPage } from './extract'
import { permitsRequest, type ReaderProfile } from './policy'
import type { BrowserReadStage } from '../../../shared/browserReaderFailure'

export const READ_DEADLINE_MS = 20_000
export const CLEANUP_DEADLINE_MS = 3_000
export type ReaderBrowserBinding = Fetcher & {
  closeSession(id: string): Promise<{ status: 'closed' | 'closing' }>
  getSession(id: string): Promise<unknown | null>
}
export type BrowserLauncher = (binding: ReaderBrowserBinding, domains: string[], acquired: (id: string) => Promise<void>, stage?: (value: BrowserReadStage) => void) => Promise<Browser>
const launch: BrowserLauncher = async (binding, domains, acquired, stage) => {
  stage?.('acquisition')
  const session = await puppeteer.acquire(binding, { guardrails: { allowedDomains: domains } })
  stage?.('session_tracking')
  await acquired(session.sessionId)
  stage?.('connection')
  return puppeteer.connect(binding, session.sessionId)
}

export async function readWithBrowser(binding: ReaderBrowserBinding, url: string, profile: ReaderProfile,
  signal: AbortSignal, launcher = launch, onAcquire?: (id: string) => Promise<void>) {
  let browser: Browser | undefined, expired = false, interceptedNavigation = false, closed = false, launchAttempted = false
  let closePromise: Promise<void> | undefined
  let sessionId: string | undefined
  let stage: BrowserReadStage = 'acquisition', siteHttpStatus: number | undefined
  const setStage = (value: BrowserReadStage) => { stage = value }
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
      setStage('session_tracking')
      await onAcquire?.(id)
      if (expired) { closePromise = undefined; await close(); throw new Error('reader_timeout') }
    }, setStage)
    if (expired) { closePromise = undefined; await close(); throw new Error('reader_timeout') }
    setStage('setup')
    const page = await browser.newPage()
    await page.setBypassServiceWorker(true)
    await page.setRequestInterception(true)
    page.on('popup', popup => { void popup?.close().catch(() => undefined) })
    let navigationVersion = 0, documentVersion = 0, settledAt = Date.now()
    let currentRequest: HTTPRequest | undefined
    let documentResponse: { status: number; headers: Record<string, string> } | undefined
    const versions = new WeakMap<HTTPRequest, number>()
    page.on('request', (req: HTTPRequest) => {
      const navigation = req.isNavigationRequest()
      if (navigation && req.frame() === page.mainFrame()) {
        versions.set(req, ++navigationVersion)
        currentRequest = req
        documentResponse = undefined
        siteHttpStatus = undefined
        settledAt = Date.now()
      }
      const allowed = !expired && permitsRequest(profile, req.url(), req.method(), req.resourceType(), navigation)
      if (!allowed && navigation && req.frame() === page.mainFrame()) interceptedNavigation = true
      void (allowed ? req.continue() : req.abort()).catch(() => undefined)
    })
    page.on('response', (response: HTTPResponse) => {
      const req = response.request()
      // A URL or reused CDP request ID cannot distinguish redirect responses.
      if (req === currentRequest && versions.get(req) === navigationVersion) {
        documentResponse = { status: response.status(), headers: response.headers() }
        siteHttpStatus = documentResponse.status
        settledAt = Date.now()
      }
    })
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) { documentVersion++; settledAt = Date.now() }
    })
    const cdp = await page.createCDPSession()
    const { frameTree } = await cdp.send('Page.getFrameTree')
    const mainFrameId = frameTree.frame.id
    let requestedLoader: string | undefined, committedLoader: string | undefined
    // CDP loader IDs bind a response to its committed document, including when
    // request/response arrive while the previous DOM is still on screen.
    cdp.on('Network.requestWillBeSent', event => {
      if (event.frameId === mainFrameId && event.type === 'Document') requestedLoader = event.loaderId
    })
    cdp.on('Page.frameNavigated', event => {
      if (event.frame.id === mainFrameId) committedLoader = event.frame.loaderId
    })
    await cdp.send('Page.enable')
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
    setStage('navigation')
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12_000 })
    let lastResult: ReturnType<typeof extractRenderedPage> | undefined, lastResultVersion = -1, lastDocumentVersion = -1, lastLoader: string | undefined
    // Same session and original deadline. Observe settling, never reload a URL.
    while (Date.now() - started < 17_000 && !expired) {
      if (interceptedNavigation) return { status: 'unreadable', reason: 'restricted_navigation', stage, httpStatus: siteHttpStatus }
      if (!documentResponse || !requestedLoader || requestedLoader !== committedLoader || Date.now() - settledAt < 350) {
        await new Promise(resolve => setTimeout(resolve, 100))
        continue
      }
      const version = navigationVersion, pageVersion = documentVersion, loader = committedLoader, observedUrl = page.url(), response = documentResponse
      const httpStatus = response.status, headers = response.headers
      const httpFailure = [401, 403].includes(httpStatus) ? 'blocked' : 'http_error'
      if (httpStatus >= 300 && httpStatus < 400) {
        await new Promise(resolve => setTimeout(resolve, 100))
        continue
      }
      if (headers['cf-mitigated'] === 'guardrails') return { status: 'unreadable', reason: 'guardrail', stage: 'navigation', httpStatus }
      if (headers['cf-mitigated']) return { status: 'unreadable', reason: 'blocked', stage: 'navigation', httpStatus }
      if (!headers['content-type']?.includes('text/html')) return { status: 'unreadable', reason: httpStatus >= 400 ? httpFailure : 'unsupported_content', stage: 'navigation', httpStatus }
      setStage('extraction')
      let extracted: ReturnType<typeof extractRenderedPage>
      try { extracted = await page.evaluate(extractRenderedPage, url) }
      catch (error) {
        // Only an observed main navigation during THIS extraction permits recovery.
        if ((navigationVersion !== version || documentVersion !== pageVersion || committedLoader !== loader)
          && /Execution context was destroyed|Cannot find context with specified id/.test(String((error as Error)?.message))) continue
        throw error
      }
      if (expired) throw new Error('reader_timeout')
      if (navigationVersion !== version || documentVersion !== pageVersion || page.url() !== observedUrl || requestedLoader !== loader || committedLoader !== loader) continue
      await new Promise(resolve => setTimeout(resolve, 150))
      if (expired) throw new Error('reader_timeout')
      if (navigationVersion !== version || documentVersion !== pageVersion || page.url() !== observedUrl || requestedLoader !== loader || committedLoader !== loader) continue
      if (interceptedNavigation) return { status: 'unreadable', reason: 'restricted_navigation', stage: 'navigation', httpStatus }
      if (!profile.hosts.includes(new URL(page.url()).hostname)) return { status: 'unreadable', reason: 'wrong_page', stage, httpStatus }
      if (extracted.reason === 'document_loading') continue
      if (httpStatus >= 400) return { status: 'unreadable', reason: extracted.reason === 'site_security' ? 'site_security' : httpFailure, stage: 'navigation', httpStatus }
      lastResult = extracted
      lastResultVersion = version
      lastDocumentVersion = pageVersion
      lastLoader = loader
      if (extracted.status !== 'read' && ['missing_body', 'missing_post_body'].includes(extracted.reason ?? '')) {
        await new Promise(resolve => setTimeout(resolve, 350))
        continue
      }
      return { ...extracted, stage, receipt: { ...extracted.receipt, httpStatus } }
    }
    if (expired) throw new Error('reader_timeout')
    if (interceptedNavigation) return { status: 'unreadable', reason: 'restricted_navigation', stage: 'navigation', httpStatus: siteHttpStatus }
    return lastResult && lastResultVersion === navigationVersion && lastDocumentVersion === documentVersion
      && lastLoader === requestedLoader && lastLoader === committedLoader ? { ...lastResult, stage, receipt: { ...lastResult.receipt, httpStatus: siteHttpStatus } }
      : { status: 'unreadable', reason: 'navigation_failed', stage: 'navigation', httpStatus: siteHttpStatus }
  })()
  let result: Awaited<typeof work> | { status: string; reason: string; stage: BrowserReadStage; httpStatus?: number }
  try {
    result = await Promise.race([work, stop])
  } catch {
    result = { status: 'unreadable', reason: expired ? 'timeout' : interceptedNavigation ? 'restricted_navigation' : `${stage}_failed`, stage, httpStatus: siteHttpStatus }
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
