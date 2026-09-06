// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { onRequest } from '../../../functions/api/measurement/client-reply-v1'
import { PRODUCT_MEASUREMENT_SCHEMA_SQL, recordProductMeasurement } from '../../../functions/api/_lib/productMeasurement'
import { PRODUCT_MEASUREMENT_OUTCOMES, PRODUCT_MEASUREMENT_PATH } from '../../services/productMeasurementProtocol'
import { measurementSQL, renderMeasurement, validateAggregate } from '../../../scripts/lib/productMeasurement.mjs'
vi.mock('../../services/productMeasurementProtocol', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/productMeasurementProtocol')>(), PRODUCT_MEASUREMENT_RELEASED: true,
}))

let h: D1Harness
beforeAll(async () => { h = await makeD1Harness({ GOOGLE_CLIENT_ID: 'synthetic-client' }); await h.db.prepare(PRODUCT_MEASUREMENT_SCHEMA_SQL).run() })
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.db.prepare('DELETE FROM product_measurement_client_reply_v1').run()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ email: 'PRIVATE-CANARY@example.invalid', email_verified: true, aud: 'synthetic-client', sub: 'PRIVATE-SUB' })))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const body = (outcome = 'saved') => JSON.stringify({ version: 1, flow: 'client-reply', outcome, platform: 'web' })
const request = (payload = body(), headers = {}) => new Request('https://tryarty.com' + PRODUCT_MEASUREMENT_PATH, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-google-token': 'synthetic-access', ...headers }, body: payload,
})
const invoke = (req = request(), env = h.env) => onRequest({ request: req, env } as never)
const rows = async () => (await h.db.prepare('SELECT * FROM product_measurement_client_reply_v1').all()).results

describe('collector through real strict auth and isolated D1, synthetic Google only', () => {
  it('counts all six outcomes without storing identity, emits a bounded aggregate report', async () => {
    for (const outcome of PRODUCT_MEASUREMENT_OUTCOMES) expect((await invoke(request(body(outcome)))).status).toBe(204)
    expect(await rows()).toEqual([expect.objectContaining({ total: 6, saved: 1, empty: 1, error: 1, stopped: 1, not_saved: 1, not_started: 1 })])
    expect(JSON.stringify(await rows())).not.toMatch(/PRIVATE|synthetic|email|token|sub|client-reply/)
    const day = String((await rows())[0].day), next = new Date(new Date(day + 'T00:00:00Z').getTime() + 86_400_000).toISOString().slice(0, 10)
    const aggregate = validateAggregate(await h.db.prepare(measurementSQL(day, next)).first())
    for (const locale of ['fr', 'en']) for (const format of ['html', 'csv', 'json']) {
      const report = renderMeasurement(aggregate, format, locale)
      expect(report).not.toMatch(/PRIVATE|synthetic-access|tokeninfo|example.invalid/)
      expect(report).toContain('D7/D30')
    }
    expect(JSON.parse(renderMeasurement(aggregate, 'json')).totals.total).toBe(6)
  })
  it('atomically admits exactly the last three declarations under competing outcomes', async () => {
    await h.db.prepare("INSERT INTO product_measurement_client_reply_v1(day,saved,total) VALUES(date('now'),9997,9997)").run()
    const outcomes = Array.from({ length: 30 }, (_, index) => PRODUCT_MEASUREMENT_OUTCOMES[index % 6])
    const accepted = await Promise.all(outcomes.map(outcome => recordProductMeasurement(h.db, outcome)))
    expect(accepted.filter(Boolean)).toHaveLength(3)
    const row = (await rows())[0]
    expect(row.total).toBe(10_000)
    for (const outcome of PRODUCT_MEASUREMENT_OUTCOMES) expect(row[outcome]).toBe((outcome === 'saved' ? 9997 : 0) + outcomes.filter((key, index) => key === outcome && accepted[index]).length)
    expect((await invoke()).status).toBe(429)
  })
  it.each(['wrong-audience', 'unverified', 'missing', 'unavailable', 'unconfigured'] as const)('fails closed for %s without any D1 increment', async mode => {
    if (mode === 'wrong-audience') vi.mocked(fetch).mockResolvedValue(Response.json({ email: 'private@example.invalid', email_verified: true, aud: 'foreign' }))
    if (mode === 'unverified') vi.mocked(fetch).mockResolvedValue(Response.json({ email: 'private@example.invalid', email_verified: false, aud: 'synthetic-client' }))
    if (mode === 'unavailable') vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }))
    const result = await invoke(request(body(), mode === 'missing' ? { 'x-google-token': '', authorization: 'Bearer PRIVATE-BYOK' } : {}),
      mode === 'unconfigured' ? { ...h.env, GOOGLE_CLIENT_ID: '' } : h.env)
    expect(result.status).toBe(['unavailable', 'unconfigured'].includes(mode) ? 503 : 401)
    expect(await result.text()).toBe(''); expect(result.headers.get('cache-control')).toBe('no-store'); expect(await rows()).toEqual([])
    if (mode === 'missing' || mode === 'unconfigured') expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['{', body('private-error-message'), body().replace('"saved"', '"saved","email":"private@example.invalid"'),
    body().replace('"version":1', '"version":0,"version":1'), body().replace('"web"', '"android"'), body() + ' ', '[]'])('rejects an unrecognized payload before auth: %s', async input => {
    expect((await invoke(request(input))).status).toBe(400); expect(fetch).not.toHaveBeenCalled(); expect(await rows()).toEqual([])
  })
  it('bounds real chunks despite a false content length', async () => {
    const encoder = new TextEncoder(), stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(body())); controller.enqueue(encoder.encode(' '.repeat(300))); controller.close() } })
    const req = new Request('https://tryarty.com' + PRODUCT_MEASUREMENT_PATH, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '1' }, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' })
    expect((await invoke(req)).status).toBe(413); expect(fetch).not.toHaveBeenCalled(); expect(await rows()).toEqual([])
  })
  it('returns unavailable on an atomic failure without a partial admission or retry', async () => {
    await recordProductMeasurement(h.db, 'empty')
    await h.db.prepare("CREATE TRIGGER measurement_failure BEFORE UPDATE ON product_measurement_client_reply_v1 BEGIN SELECT RAISE(ABORT,'synthetic'); END").run()
    try {
      expect((await invoke()).status).toBe(503)
      expect(await rows()).toEqual([expect.objectContaining({ total: 1, empty: 1, saved: 0 })])
      expect(fetch).toHaveBeenCalledOnce()
    } finally { await h.db.prepare('DROP TRIGGER measurement_failure').run() }
  })
  it('does not claim server deduplication after a lost ack', async () => {
    await invoke(); expect((await rows())[0].total).toBe(1)
    // Deliberate external replay: the client service MUST NOT do this itself.
    await invoke(); expect((await rows())[0].total).toBe(2)
  })
  it('rejects incompatible methods and content types before auth', async () => {
    expect((await invoke(new Request('https://tryarty.com' + PRODUCT_MEASUREMENT_PATH))).status).toBe(405)
    expect((await invoke(request(body(), { 'content-type': 'text/plain' }))).status).toBe(415)
    expect(fetch).not.toHaveBeenCalled()
  })
})
