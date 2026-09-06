import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { captureCalendarContext, listEvents, prepareCalendarMutation } from '../../services/calendarClient'
import { blockProjectOperations } from '../../services/projects/localErasureGuard'
import { getDocumentStorageLayout } from '../../services/workspaceWriter/runtime'
import { deferred } from '../helpers/workspaceLocks'
import { google, resetCalendarFixture, installCalendarAccount, draft, created, syntheticEvent } from '../helpers/calendarFixture'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
beforeEach(resetCalendarFixture)
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Calendar transport — real Google leases, crypto, sessions and IDB', () => {
  it('lists with refreshed headers, bounded period and the original Google account', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ events: [syntheticEvent] })); vi.stubGlobal('fetch', fetcher)
    expect(await listEvents()).toEqual([syntheticEvent])
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ calendarProtocol: 1, calendarAccount: 'a@example.invalid', type: 'list', days: 7 })
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('x-google-token')).toBe('synthetic-a')
  })
  it('freezes operation, target and fields before refresh; joins double execute', async () => {
    await installCalendarAccount('a', true)
    const gate = deferred<Response>(), fetcher = vi.fn((url: string) => url.endsWith('/refresh') ? gate.promise : Promise.resolve(Response.json({ success: true, title: 'Frozen' })))
    vi.stubGlobal('fetch', fetcher)
    const input = { title: 'Frozen', location: '', type: 'delete', eventId: 'wrong' }
    const prepared = prepareCalendarMutation(captureCalendarContext(), 'update', input, 'original')
    const first = prepared.execute(), second = prepared.execute()
    input.title = 'Changed'; input.eventId = 'other'
    gate.resolve(Response.json({ access_token: 'refreshed-a', expires_in: 3600, oauth_profile: google.CURRENT_GOOGLE_OAUTH_PROFILE }))
    expect(await first).toEqual({ success: true, title: 'Frozen' }); expect(await second).toEqual(await first)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ calendarProtocol: 1, calendarAccount: 'a@example.invalid', type: 'update', eventId: 'original', title: 'Frozen', location: '' })
    expect(prepared.review).toContain('Frozen'); expect(prepared.review).not.toContain('Changed')
  })
  it.each(['same', 'B', 'ABA'])('refuses stale context after %s without Calendar dispatch', async transition => {
    const prepared = prepareCalendarMutation(captureCalendarContext(), 'create', draft)
    await installCalendarAccount(transition === 'same' ? 'a' : 'b')
    if (transition === 'ABA') await installCalendarAccount('a')
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(prepared.execute()).rejects.toMatchObject({ outcome: 'not-sent' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['memory', 'durable'])('refuses the %s erasure fence without a write', async kind => {
    const prepared = prepareCalendarMutation(captureCalendarContext(), 'create', draft)
    const unblock = kind === 'memory' ? blockProjectOperations('a') : () => {}
    if (kind === 'durable') {
      const layout = getDocumentStorageLayout().projects
      const db = await openDB(layout.name, layout.version, { upgrade(db) { db.createObjectStore('meta') } })
      await db.put('meta', 'new-fence', 'erasure-fence'); db.close()
    }
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    try { await expect(prepared.execute()).rejects.toMatchObject({ outcome: 'not-sent' }); expect(fetcher).not.toHaveBeenCalled() }
    finally { unblock() }
  })
  it('cancels its own wait during shared refresh without cancelling the other consumer', async () => {
    await installCalendarAccount('a', true)
    const gate = deferred<Response>(), fetcher = vi.fn(() => gate.promise); vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController(), prepared = prepareCalendarMutation(captureCalendarContext(), 'create', draft)
    const outcome = prepared.execute(controller.signal).catch(error => error)
    const other = google.getValidAccessToken()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    controller.abort()
    expect((await outcome).outcome).toBe('not-sent')
    gate.resolve(Response.json({ access_token: 'refreshed-a', expires_in: 3600, oauth_profile: google.CURRENT_GOOGLE_OAUTH_PROFILE }))
    expect(await other).toBe('refreshed-a')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['abort', 'relink', 'response-lost', 'invalid-200', 'legacy-403', 'after-write-503'])('reports %s after dispatch as unknown, never retries', async kind => {
    const gate = deferred<Response>(), fetcher = vi.fn(() => gate.promise); vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController(), context = captureCalendarContext()
    const prepared = prepareCalendarMutation(context, 'create', draft)
    const outcome = prepared.execute(controller.signal).catch(error => error)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    if (kind === 'abort') controller.abort()
    if (kind === 'relink') await installCalendarAccount('b')
    if (kind === 'response-lost') gate.reject(new Error('write occurred then connection lost'))
    else gate.resolve(kind === 'invalid-200' ? Response.json({}) : kind === 'legacy-403' ? Response.json({ error: '403' }, { status: 403 }) : kind === 'after-write-503' ? Response.json({ error: '503' }, { status: 503 }) : created())
    const error = await outcome
    expect(error.outcome).toBe('unknown'); expect(error.message).not.toMatch(/réessaie|retry/i)
    await expect(prepared.execute()).rejects.toMatchObject({ outcome: 'unknown' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('accepts only a versioned refusal known to occur before dispatch Google', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ calendarProtocol: 1, calendarOutcome: 'rejected-before-dispatch', error: 'scope' }, { status: 503 })))
    await expect(prepareCalendarMutation(captureCalendarContext(), 'delete', {}, 'id').execute()).rejects.toMatchObject({ outcome: 'rejected-before-dispatch' })
  })
  it('does not replay private cached results after a switch, or send a second prepared handle', async () => {
    const fetcher = vi.fn().mockImplementation(async () => created()); vi.stubGlobal('fetch', fetcher)
    const scope = captureCalendarContext(), first = prepareCalendarMutation(scope, 'create', draft), second = prepareCalendarMutation(scope, 'create', draft)
    await first.execute()
    await expect(second.execute()).rejects.toMatchObject({ outcome: 'already-attempted' })
    await installCalendarAccount('b')
    await expect(first.execute()).rejects.toMatchObject({ outcome: 'unknown' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed list JSON and invalid periods instead of reporting an empty agenda', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal('fetch', fetcher)
    await expect(listEvents()).rejects.toThrow()
    await expect(listEvents(0)).rejects.toThrow()
    await expect(listEvents(30, null)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('works without AbortSignal.any or AbortSignal.timeout on older browser engines', async () => {
    const any = Object.getOwnPropertyDescriptor(AbortSignal, 'any'), timeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined })
    Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined })
    vi.stubGlobal('fetch', vi.fn(async () => created()))
    try { expect(await prepareCalendarMutation(captureCalendarContext(), 'create', draft).execute()).toHaveProperty('id', syntheticEvent.id) }
    finally { if (any) Object.defineProperty(AbortSignal, 'any', any); if (timeout) Object.defineProperty(AbortSignal, 'timeout', timeout) }
  })
})
