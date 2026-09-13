// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
const identity = vi.hoisted(() => vi.fn())
vi.mock('../../../functions/api/_lib/emailTrial', async original => ({ ...await original<object>(), resolveProxyIdentityDetailed: identity }))
import { onRequestPost } from '../../../functions/api/ai/openai-proxy'
let h: D1Harness
const email = 'luna-trial@example.test'
const upstream = vi.fn()
beforeAll(async () => { h = await makeD1Harness({ OPENAI_API_KEY: 'synthetic-server-key' }) })
afterAll(async () => h.dispose())
beforeEach(async () => {
  await h.reset(); vi.clearAllMocks()
  await h.db.prepare("INSERT INTO subscriptions (user_email,status,plan_type) VALUES (?1,'active','trial')").bind(email).run()
  upstream.mockImplementation(async () => Response.json({ model: 'gpt-5.6-luna', choices: [{ message: { content: 'Bonjour' } }], usage: { prompt_tokens: 12, completion_tokens: 2 } }))
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => vi.unstubAllGlobals())
async function call(model = 'gpt-5.6-luna') {
  const waits: Promise<unknown>[] = []
  const response = await onRequestPost({ request: new Request('https://tryarty.com/api/ai/openai-proxy', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Bonjour' }] }),
  }), env: h.env, waitUntil: (p: Promise<unknown>) => waits.push(p) } as never)
  await response.text(); await Promise.all(waits)
  return response
}
describe.each(['google', 'email-trial'])('real D1 Luna proxy accounting after %s authentication', kind => {
  beforeEach(() => identity.mockResolvedValue({ status: 'ok', identity: { kind, email } }))
  const table = () => kind === 'google' ? 'trial_usage' : 'email_trial_usage'
  async function used() { return (await h.db.prepare(`SELECT used FROM ${table()} WHERE email=?1`).bind(email).first<{ used: number }>())?.used ?? 0 }
  it('serves exactly thirty calls then refuses the thirty-first without any provider call', async () => {
    for (let i = 0; i < 30; i++) {
      const response = await call(); expect(response.status).toBe(200)
      expect(response.headers.get('x-trial-remaining')).toBe(String(29 - i))
    }
    expect(await used()).toBe(30); expect((await call()).status).toBe(403)
    expect(upstream).toHaveBeenCalledTimes(30); expect(await used()).toBe(30)
  })
  it('actually compensates rejected models and failed upstream in D1, preserving served usage', async () => {
    expect((await call()).status).toBe(200); expect(await used()).toBe(1)
    expect((await call('gpt-5.6-terra')).status).toBe(403); expect(await used()).toBe(1)
    upstream.mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 429 }))
    expect((await call()).status).toBe(429); expect(await used()).toBe(1)
    upstream.mockRejectedValueOnce(new Error('network unavailable'))
    expect((await call()).status).toBe(502); expect(await used()).toBe(1)
  })
})
