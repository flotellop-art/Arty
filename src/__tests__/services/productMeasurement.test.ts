import 'fake-indexeddb/auto'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import * as google from '../../services/googleAuth'
import * as c from '../../services/crypto'
import { setActiveSession, PROJECT_ERASURE_FENCE_KEY } from '../../services/userSession'
import * as store from '../../services/projects/store'
import { getDocumentStorageLayout } from '../../services/workspaceWriter/runtime'
import { parseOwnedLocalKey } from '../../services/workspaceWriter/localOwnership'
import * as measurement from '../../services/productMeasurement'
import { PRODUCT_MEASUREMENT_PATH } from '../../services/productMeasurementProtocol'

vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/productMeasurementProtocol', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/productMeasurementProtocol')>(), PRODUCT_MEASUREMENT_RELEASED: true,
})) // Exercise the prospective opt-in pilot; the production gate has its own test.
let serial = 0, owner = ''
const key = () => `arty-${owner}-${measurement.PRODUCT_MEASUREMENT_SETTING}`
const session = (id: string, authMethod: 'google' | 'email' | 'apikey' | 'demo' = 'google') =>
  ({ userId: id, authMethod, email: 'PRIVATE-CANARY@example.invalid', displayName: 'PRIVATE NAME', createdAt: 1 })
const tokens = (patch = {}) => ({ access_token: 'synthetic-access', refresh_token: 'PRIVATE-REFRESH', expires_at: Date.now() + 3600_000, ...patch })
const drain = () => new Promise(resolve => setTimeout(resolve, 30))
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); google.resetGoogleMemCache()
  owner = `measure-${++serial}`; setActiveSession(session(owner))
  await c.initCrypto(`synthetic-key-${serial}`)
  await google.storeUser({ email: session(owner).email, name: 'Synthetic', picture: '' })
  await google.storeMailboxFreeGrant(tokens(), undefined, { verifiedEmail: session(owner).email })
  await google.bootstrapGoogleStorage()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('optional measurement, real owner/crypto/Google storage scopes', () => {
  it('is OFF without any mount write and does not arm retroactively', async () => {
    const before = { ...localStorage }, old = measurement.beginClientReplyMeasurement()
    expect(measurement.isProductMeasurementEnabled()).toBe(false); expect({ ...localStorage }).toEqual(before)
    measurement.setProductMeasurementEnabled(true); old.settle('saved'); await drain()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([null, '{}', '{bad', '{"version":1,"enabled":false,"enabled":true,"generation":"00000000-0000-0000-0000-000000000000"}',
    '{"version":1,"enabled":true,"generation":"bad"}'])('refuses malformed consent %s', async raw => {
    if (raw !== null) localStorage.setItem(key(), raw)
    measurement.beginClientReplyMeasurement().settle('saved'); await drain(); expect(fetch).not.toHaveBeenCalled()
  })
  it('sends exactly the scalar projection once with a ready token, no refresh or credential fallback', async () => {
    measurement.setProductMeasurementEnabled(true)
    const observation = measurement.beginClientReplyMeasurement()
    observation.settle('saved'); observation.settle('error'); observation.discard()
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(PRODUCT_MEASUREMENT_PATH)
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-google-token': 'synthetic-access' },
      body: '{"version":1,"flow":"client-reply","outcome":"saved","platform":"web"}' })
    expect(JSON.stringify(init)).not.toMatch(/PRIVATE|refresh|email|conversationId|timestamp|model/)
  })
  it.each(['off-on', 'owner-roundtrip', 'fence', 'crypto', 'logout', 'discard'] as const)('drops pending results on %s', async mode => {
    measurement.setProductMeasurementEnabled(true); const observation = measurement.beginClientReplyMeasurement()
    if (mode === 'off-on') { measurement.setProductMeasurementEnabled(false); measurement.setProductMeasurementEnabled(true) }
    if (mode === 'owner-roundtrip') { setActiveSession(session('other')); setActiveSession(session(owner)) }
    if (mode === 'fence') localStorage.setItem(PROJECT_ERASURE_FENCE_KEY, 'other-fence')
    if (mode === 'crypto') await c.initCrypto('different-synthetic-key')
    if (mode === 'logout') google.logout()
    if (mode === 'discard') observation.discard()
    observation.settle('saved'); await drain(); expect(fetch).not.toHaveBeenCalled()
  })
  it('withdraws in RAM when persisting OFF fails and preserves other owner consent', async () => {
    measurement.setProductMeasurementEnabled(true); const observation = measurement.beginClientReplyMeasurement()
    const other = `arty-other-${measurement.PRODUCT_MEASUREMENT_SETTING}`; localStorage.setItem(other, 'neighbor')
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (name, value) { if (name === key()) throw new Error('quota'); real.call(this, name, value) })
    expect(() => measurement.setProductMeasurementEnabled(false)).toThrow()
    expect(measurement.isProductMeasurementEnabled()).toBe(false)
    observation.settle('saved'); await drain(); expect(fetch).not.toHaveBeenCalled(); expect(localStorage.getItem(other)).toBe('neighbor')
  })
  it('does not move an OFF write to B through synchronous abort reentrance', async () => {
    measurement.setProductMeasurementEnabled(true)
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      init!.signal!.addEventListener('abort', () => setActiveSession(session('other')), { once: true })
      return new Promise<Response>(() => {})
    })
    measurement.beginClientReplyMeasurement().settle('saved'); await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(() => measurement.setProductMeasurementEnabled(false)).toThrow()
    expect(localStorage.getItem(`arty-other-${measurement.PRODUCT_MEASUREMENT_SETTING}`)).toBeNull()
  })
  it('does not reuse an expired token or start/await an OAuth refresh', async () => {
    await google.storeMailboxFreeGrant(tokens({ expires_at: Date.now() - 1 }), undefined, { verifiedEmail: session(owner).email })
    measurement.setProductMeasurementEnabled(true); measurement.beginClientReplyMeasurement().settle('saved')
    await drain(); expect(google.captureReadyGoogleToken()).toBeNull(); expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['pagehide', 'beforeunload', 'hidden'])('abandons queued measurement on %s', async event => {
    measurement.setProductMeasurementEnabled(true); const observation = measurement.beginClientReplyMeasurement()
    observation.settle('saved') // already queued, not merely unstarted
    if (event === 'hidden') {
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'))
      visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'))
    } else window.dispatchEvent(new Event(event))
    observation.settle('saved')
    await drain()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not wait for or add a refresh when one is already pending', async () => {
    await google.storeMailboxFreeGrant(tokens({ expires_at: Date.now() - 1 }), undefined, { verifiedEmail: session(owner).email })
    measurement.setProductMeasurementEnabled(true)
    let release!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const refresh = google.getValidAccessToken()
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    measurement.beginClientReplyMeasurement().settle('saved'); await drain()
    expect(fetch).toHaveBeenCalledOnce()
    release(Response.json({ access_token: 'refreshed', expires_in: 3600, oauth_profile: google.CURRENT_GOOGLE_OAUTH_PROFILE }))
    await refresh; await drain(); expect(fetch).toHaveBeenCalledOnce()
  })
  it.each(['token', 'owner', 'consent'] as const)('rechecks %s after asynchronous durable validation', async change => {
    measurement.setProductMeasurementEnabled(true)
    const actual = store.captureLocalReadScope; let release!: () => void, entered = false
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(store, 'captureLocalReadScope').mockImplementation(signal => {
      const scope = actual(signal)
      return { ...scope, async validateReadOnly() { entered = true; await gate; await scope.validateReadOnly() } }
    })
    measurement.beginClientReplyMeasurement().settle('saved'); await waitFor(() => expect(entered).toBe(true))
    if (change === 'token') await google.storeMailboxFreeGrant(tokens({ access_token: 'replacement' }), undefined, { verifiedEmail: session(owner).email })
    if (change === 'owner') setActiveSession(session('other'))
    if (change === 'consent') measurement.setProductMeasurementEnabled(false)
    release(); await drain(); expect(fetch).not.toHaveBeenCalled()
  })
  it('refuses a durable IDB erasure fence mismatch even if localStorage is unchanged', async () => {
    const { name, version } = getDocumentStorageLayout().projects
    const db = await openDB(name, version, { upgrade(db) { db.createObjectStore('meta') } })
    await db.put('meta', 'other-fence', 'erasure-fence')
    measurement.setProductMeasurementEnabled(true); measurement.beginClientReplyMeasurement().settle('saved')
    await drain(); expect(fetch).not.toHaveBeenCalled()
    await db.delete('meta', 'erasure-fence'); db.close()
  })
  it.each(['email', 'apikey', 'demo'] as const)('excludes %s sessions even with an old ready Google grant', async authMethod => {
    setActiveSession(session(owner, authMethod))
    expect(measurement.productMeasurementAvailable()).toBe(false)
    expect(() => measurement.setProductMeasurementEnabled(true)).toThrow()
    measurement.beginClientReplyMeasurement().settle('saved'); await drain(); expect(fetch).not.toHaveBeenCalled()
  })
  it.each([401, 429, 503, 'lost-ack'] as const)('does not retry %s', async result => {
    vi.mocked(fetch).mockImplementation(async () => { if (result === 'lost-ack') throw new Error('lost ack'); return new Response(null, { status: result }) })
    measurement.setProductMeasurementEnabled(true); measurement.beginClientReplyMeasurement().settle('saved')
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); await drain(); expect(fetch).toHaveBeenCalledOnce()
  })
  it('inventories exact owner settings for cold migration and erasure', () => {
    expect(parseOwnedLocalKey(key())).toEqual({ owner, kind: 'setting', slot: measurement.PRODUCT_MEASUREMENT_SETTING })
    expect(parseOwnedLocalKey(`arty-${owner}-neighbor-${measurement.PRODUCT_MEASUREMENT_SETTING}`)?.owner).toBe(`${owner}-neighbor`)
  })
})
