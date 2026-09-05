import { describe, expect, it, vi } from 'vitest'
import { createDocumentWorkspaceLock, DOCUMENT_WORKSPACE_LOCK } from '../../services/workspaceWriter/documentLock'
import { getWorkspaceEntryRoute } from '../../services/workspaceWriter/entryRoute'
import { sharedWorkspaceLocks, deferred } from '../helpers/workspaceLocks'

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

describe('document-lifetime workspace lock', () => {
  it('reserves once even for simultaneous or reentrant acquisition', async () => {
    const locks = sharedWorkspaceLocks(), doc = createDocumentWorkspaceLock(() => locks.source)
    let reentrant: Promise<string> | undefined
    doc.subscribe(() => { if (doc.getSnapshot() === 'acquiring') reentrant = doc.acquire() })
    const first = doc.acquire()
    expect(doc.acquire()).toBe(first); expect(reentrant).toBe(first)
    expect(() => doc.assertHeld()).toThrow('workspace_document_unavailable')
    expect(await first).toBe('held'); doc.assertHeld()
    expect(await doc.acquire()).toBe('held')
    expect(locks.requested).toEqual([{ name: DOCUMENT_WORKSPACE_LOCK, options: { mode: 'exclusive', ifAvailable: true } }])
    expect('release' in doc).toBe(false)
  })

  it('does not queue or steal from another document, independent of accounts', async () => {
    const locks = sharedWorkspaceLocks(), a = createDocumentWorkspaceLock(() => locks.source), b = createDocumentWorkspaceLock(() => locks.source)
    expect(await a.acquire()).toBe('held'); expect(await b.acquire()).toBe('busy')
    expect(() => b.assertHeld()).toThrow()
    expect(await b.acquire()).toBe('busy'); await flush()
    expect(b.getSnapshot()).toBe('busy'); expect(locks.held.size).toBe(1)
    // Simulate browser document destruction, NOT an application release API.
    locks.held.clear(); await flush()
    expect(b.getSnapshot()).toBe('busy')
    expect(await b.acquire()).toBe('held')
  })

  it('observer unsubscribe / remount does not release or reacquire', async () => {
    const locks = sharedWorkspaceLocks(), doc = createDocumentWorkspaceLock(() => locks.source)
    const off = doc.subscribe(() => {})
    await doc.acquire(); off(); doc.subscribe(() => {}); await doc.acquire()
    expect(locks.requested).toHaveLength(1); expect(locks.held.size).toBe(1)
  })

  it('has no timeout or visibility event release', async () => {
    const locks = sharedWorkspaceLocks(), doc = createDocumentWorkspaceLock(() => locks.source)
    await doc.acquire()
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
    await flush(); doc.assertHeld(); expect(locks.held.size).toBe(1)
  })

  it.each(['unsupported', 'denied-getter', 'sync-request', 'async-request'])('fails closed for %s without storage writes', async kind => {
    const write = vi.spyOn(Storage.prototype, 'setItem'), source = () => {
      if (kind === 'unsupported') return undefined
      if (kind === 'denied-getter') throw new DOMException('denied', 'SecurityError')
      return { request() { if (kind === 'sync-request') throw new Error('denied'); return Promise.reject(new Error('denied')) } }
    }
    const doc = createDocumentWorkspaceLock(source)
    expect(await doc.acquire()).toBe(kind === 'unsupported' ? 'unsupported' : 'failed')
    expect(() => doc.assertHeld()).toThrow(); expect(write).not.toHaveBeenCalled(); write.mockRestore()
  })

  it('retry from a terminal-state observer does not recurse or create a second request', async () => {
    const get = vi.fn(() => undefined), doc = createDocumentWorkspaceLock(get)
    doc.subscribe(() => { if (doc.getSnapshot() === 'unsupported') void doc.acquire() })
    expect(await doc.acquire()).toBe('unsupported'); expect(get).toHaveBeenCalledOnce()
  })

  it('explicit retry after a temporary refusal succeeds; throwing observers are isolated', async () => {
    let available = false
    const locks = sharedWorkspaceLocks(), doc = createDocumentWorkspaceLock(() => { if (!available) throw new Error('denied'); return locks.source })
    doc.subscribe(() => { throw new Error('observer') })
    expect(await doc.acquire()).toBe('failed')
    available = true; expect(await doc.acquire()).toBe('held')
  })

  it.each(['reject', 'return'])('loss after grant (%s) is terminal before any abort observer runs', async mode => {
    const result = deferred(), requests = vi.fn((_name, _opts, callback) => { void callback({}); return result.promise })
    const doc = createDocumentWorkspaceLock(() => ({ request: requests }))
    await doc.acquire()
    const checks: string[] = []
    doc.signal.addEventListener('abort', () => { checks.push(doc.getSnapshot()); expect(() => doc.assertHeld()).toThrow() })
    if (mode === 'reject') result.reject(new Error('exceptional loss')); else result.resolve()
    await flush()
    expect(checks).toEqual(['lost']); expect(doc.signal.aborted).toBe(true)
    expect(await doc.acquire()).toBe('lost'); expect(requests).toHaveBeenCalledOnce()
  })
})

describe('public entry routing without session module hydration', () => {
  const route = (pathname = '/', search = '', native = false, preview = false, values: Record<string, string> = {}) =>
    getWorkspaceEntryRoute(pathname, search, native, preview, { getItem: key => values[key] ?? null })
  it('keeps pristine web landing public, not native/preview/onboarding entry', () => {
    expect(route()).toBe('landing'); expect(route('/', '?utm_source=test')).toBe('landing')
    expect(route('/', '?start=1')).toBe('private'); expect(route('/', '', true)).toBe('private'); expect(route('/', '', false, true)).toBe('private')
    expect(route('/', '?start')).toBe('private'); expect(route('/', '?start=')).toBe('private')
  })
  it.each(['/login', '/auth/callback', '/auth/callback/', '/conversation/id', '/upgrade', '/share/id/more', '/unknown'])('never exempts %s', path => {
    expect(route(path, '?code=not-consumed&state=not-consumed')).toBe('private')
  })
  it('keeps public sharing and brochure accessible even with known accounts', () => {
    const stored = { 'arty-active-session': '{private}' }
    expect(route('/share/abc', '', false, false, stored)).toBe('share')
    expect(route('/share/abc/')).toBe('share'); expect(route('/discover', '', false, false, stored)).toBe('landing')
  })
  it.each([
    { 'arty-active-session': '{private}' }, { 'arty-onboarding-choice-done': '1' },
    { 'arty-known-sessions': '[{}]' }, { 'arty-known-sessions': '{}' }, { 'arty-known-sessions': 'broken' },
  ])('known or ambiguous stored state enters private only under the lock: %j', values => {
    expect(route('/', '', false, false, values)).toBe('private')
  })
  it('empty known list remains public, inaccessible storage fails to private gate', () => {
    expect(route('/', '', false, false, { 'arty-known-sessions': '[]' })).toBe('landing')
    expect(getWorkspaceEntryRoute('/', '', false, false, { getItem() { throw new Error('denied') } })).toBe('private')
  })
})
