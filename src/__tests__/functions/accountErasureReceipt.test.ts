/** @vitest-environment node */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { createRemoteErasure, erasureDigest, ERASURE_CAPABILITY_HEADER, ERASURE_OPERATION_HEADER, ERASURE_SUBJECT_HEADER } from '../../services/accountErasureProtocol'
const google = vi.hoisted(() => vi.fn())
vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({ verifyGoogleUserStrict: google }))
import { verifyEmailTrialToken } from '../../../functions/api/_lib/emailTrial'
import { onRequestGet, onRequestPost } from '../../../functions/api/account/erasure-v1'
import { onRequest as middleware } from '../../../functions/api/_middleware'
let h: D1Harness
const email = 'a@example.test', token = 'synthetic-email-token', path = 'https://tryarty.com/api/account/erasure-v1'
beforeAll(async () => { h = await makeD1Harness({ GOOGLE_CLIENT_ID: 'synthetic-client' }) })
afterAll(async () => { await h.dispose() })
beforeEach(async () => { await h.reset(); google.mockReset().mockResolvedValue(email) })
async function fixture(kind: 'google' | 'email-trial' = 'email-trial') {
  const intent = await createRemoteErasure(kind, email), operationId = crypto.randomUUID()
  const headers = { [ERASURE_OPERATION_HEADER]: operationId, [ERASURE_CAPABILITY_HEADER]: intent.capability, [ERASURE_SUBJECT_HEADER]: intent.subjectHash }
  const auth = kind === 'google' ? { 'x-google-token': 'synthetic-google' } : { 'x-arty-trial-token': token }
  await h.db.prepare("INSERT INTO email_trial_sessions (token_hash,email,created_at,expires_at) VALUES (?1,?2,unixepoch(),unixepoch()+1000)")
    .bind(await erasureDigest(token), email).run()
  for (const owner of [email, `trial-email:${email}`, 'b@example.test']) await h.db.prepare("INSERT INTO memory (user_id,category,data) VALUES (?1,'profil','private')").bind(owner).run()
  const post = () => onRequestPost({ request: new Request(path, { method: 'POST', headers: { ...headers, ...auth } }), env: h.env } as never)
  const get = (override = {}) => onRequestGet({ request: new Request(path, { headers: { ...headers, ...override } }), env: h.env } as never)
  return { intent, operationId, headers, post, get }
}
async function rows(table: string) { return (await h.db.prepare(`SELECT * FROM ${table}`).all()).results }
describe('atomic erasure receipt — actual D1/workerd', () => {
  it('survives a lost response and real email-token revocation; GET needs no auth', async () => {
    const f = await fixture()
    const response = await f.post() // deliberately discard its body (client never received it)
    expect(response.status).toBe(200)
    expect(await verifyEmailTrialToken(new Request(path, { headers: { 'x-arty-trial-token': token } }), h.env)).toBeNull()
    expect((await f.post()).status).toBe(401) // the old credential really is unusable
    const proof = await f.get()
    expect(proof.headers.get('cache-control')).toBe('no-store')
    expect(await proof.json()).toEqual({ protocol: 1, operationId: f.operationId, status: 'confirmed', subjectHash: f.intent.subjectHash })
    expect(google).not.toHaveBeenCalled()
    expect((await rows('memory')).map(r => r.user_id).sort()).toEqual(['a@example.test', 'b@example.test'])
    const receipt = JSON.stringify(await rows('account_erasure_receipts_v1'))
    expect(receipt).not.toContain(email); expect(receipt).not.toContain(token); expect(receipt).not.toContain(f.intent.capability)
  })
  it('concurrent duplicate Google POSTs and later replay cannot erase recreated data', async () => {
    const f = await fixture('google')
    expect((await Promise.all([f.post(), f.post()])).map(r => r.status)).toEqual([200, 200])
    expect(await rows('account_erasure_receipts_v1')).toHaveLength(1)
    await h.db.prepare("INSERT INTO memory (user_id,category,data) VALUES (?1,'profil','recreated')").bind(email).run()
    expect((await f.post()).status).toBe(200)
    expect((await rows('memory')).find(r => r.user_id === email)?.data).toBe('recreated')
  })
  it('a real mid-batch trigger failure rolls back earlier deletes AND the receipt', async () => {
    const f = await fixture()
    await h.db.prepare("INSERT INTO content_reports (id,reporter_email,category,message_excerpt) VALUES ('failure',?1,'other','private')").bind(`trial-email:${email}`).run()
    await h.db.prepare("CREATE TRIGGER receipt_test_failure BEFORE DELETE ON content_reports BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END").run()
    try {
      expect((await f.post()).status).toBe(503)
      expect(await rows('email_trial_sessions')).toHaveLength(1)
      expect(await rows('memory')).toHaveLength(3)
      expect(await rows('content_reports')).toHaveLength(1)
      expect(await rows('account_erasure_receipts_v1')).toHaveLength(0)
      expect(await (await f.get()).json()).toEqual({ protocol: 1, operationId: f.operationId, status: 'unknown' })
    } finally { await h.db.prepare('DROP TRIGGER receipt_test_failure').run() }
  })
  it('refuses a wrong captured subject before deletion and foreign capabilities do not reveal receipts', async () => {
    const f = await fixture('google')
    google.mockResolvedValueOnce('b@example.test')
    expect((await f.post()).status).toBe(409)
    expect(await rows('memory')).toHaveLength(3)
    expect(await rows('account_erasure_receipts_v1')).toHaveLength(0)
    expect((await f.post()).status).toBe(200)
    expect(await (await f.get({ [ERASURE_CAPABILITY_HEADER]: '0'.repeat(64) })).json()).toEqual({ protocol: 1, operationId: f.operationId, status: 'unknown' })
    const impostor = await createRemoteErasure('google', email)
    const foreign = await onRequestPost({ request: new Request(path, { method: 'POST', headers: { ...f.headers,
      [ERASURE_CAPABILITY_HEADER]: impostor.capability, [ERASURE_SUBJECT_HEADER]: impostor.subjectHash, 'x-google-token': 'synthetic' } }), env: h.env } as never)
    expect(foreign.status).toBe(409)
  })
  it('a Google subject cannot be applied by same-email trial credentials', async () => {
    const f = await fixture('google')
    expect((await onRequestPost({ request: new Request(path, { method: 'POST', headers: { ...f.headers, 'x-arty-trial-token': token } }), env: h.env } as never)).status).toBe(409)
    expect(await rows('memory')).toHaveLength(3)
  })
  it('status lookup never creates its table; invalid URL credentials fail before DB access', async () => {
    await h.db.prepare('DROP TABLE account_erasure_receipts_v1').run()
    try {
      const f = await fixture()
      expect(await (await f.get()).json()).toEqual({ protocol: 1, operationId: f.operationId, status: 'unknown' })
      expect(await h.db.prepare("SELECT name FROM sqlite_master WHERE name = 'account_erasure_receipts_v1'").first()).toBeNull()
      expect((await onRequestGet({ request: new Request(`${path}?capability=forbidden`), env: {} } as never)).status).toBe(400)
      await f.post() // lazy creation is confined to authenticated POST
    } finally { /* next fixture reset uses the recreated schema */ }
  })
  it('allows the bounded receipt headers in native Android CORS preflight', async () => {
    const res = await middleware({ request: new Request(path, { method: 'OPTIONS', headers: { Origin: 'https://localhost' } }) } as never)
    expect(res.status).toBe(204)
    for (const name of [ERASURE_OPERATION_HEADER, ERASURE_CAPABILITY_HEADER, ERASURE_SUBJECT_HEADER, 'x-arty-trial-token']) expect(res.headers.get('access-control-allow-headers')).toContain(name)
  })
})
