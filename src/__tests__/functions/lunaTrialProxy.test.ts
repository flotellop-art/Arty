// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ identity: vi.fn(), google: vi.fn(), email: vi.fn(), refundGoogle: vi.fn(), refundEmail: vi.fn(), usage: vi.fn() }))
vi.mock('../../../functions/api/_lib/checkAllowedUser', async (original) => ({
  ...await original<object>(), checkAllowedVerifiedUser: m.google, voidTrialMessage: m.refundGoogle,
}))
vi.mock('../../../functions/api/_lib/emailTrial', async (original) => ({
  ...await original<object>(), resolveProxyIdentityDetailed: m.identity, consumeEmailTrialMessage: m.email, voidEmailTrialMessage: m.refundEmail,
}))
vi.mock('../../../functions/api/_lib/quota', async (original) => ({ ...await original<object>(), recordUsage: m.usage }))
import { onRequestPost } from '../../../functions/api/ai/openai-proxy'

let waits: Promise<unknown>[]
const upstream = vi.fn()
beforeEach(() => {
  vi.clearAllMocks(); waits = []
  m.google.mockResolvedValue({ planType: 'trial', trialRemaining: 29, trialDebited: true })
  m.email.mockResolvedValue({ planType: 'trial', trialRemaining: 29, trialDebited: true })
  upstream.mockResolvedValue(Response.json({ model: 'gpt-5.6-luna', choices: [{ message: { content: 'Bonjour' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }))
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => vi.unstubAllGlobals())
async function call(body: Record<string, unknown> = {}, byok = false) {
  const request = new Request('https://tryarty.com/api/ai/openai-proxy', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(byok ? { 'x-openai-key': 'user-test-key' } : {}) },
    body: JSON.stringify({ model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'Bonjour' }], ...body }),
  })
  const response = await onRequestPost({ request, env: { OPENAI_API_KEY: 'server-test-key' }, waitUntil: (p: Promise<unknown>) => waits.push(p) } as never)
  const result = await response.json(); await Promise.all(waits)
  return { response, result }
}
describe.each(['google', 'email-trial'])('Luna trial %s proxy', kind => {
  beforeEach(() => m.identity.mockResolvedValue({ status: 'ok', identity: { kind, email: 'trial@example.test' } }))
  const refund = () => kind === 'google' ? m.refundGoogle : m.refundEmail
  it('admits one served request and enforces server cost limits', async () => {
    const { response } = await call({ n: 128, service_tier: 'priority', max_completion_tokens: 999999, store: true })
    expect(response.status).toBe(200); expect(response.headers.get('x-trial-remaining')).toBe('29')
    const sent = JSON.parse(upstream.mock.calls[0][1].body)
    expect(sent).toMatchObject({ model: 'gpt-5.6-luna', n: 1, service_tier: 'default', max_completion_tokens: 4096, store: false })
    expect(refund()).not.toHaveBeenCalled()
    expect(kind === 'google' ? m.google : m.email).toHaveBeenCalledOnce()
  })
  it.each(['gpt-5.6-terra','gpt-5.6-sol','gpt-6-astra','gpt-5.6-luna-mini'])('rejects %s without a net trial debit', async model => {
    const { response, result } = await call({ model })
    expect(response.status).toBe(403); expect(result.error).toBe('trial_model_restricted')
    expect(upstream).not.toHaveBeenCalled(); expect(refund()).toHaveBeenCalledOnce()
  })
  it.each([400, 429, 500])('refunds unserved HTTP %s exactly once', async status => {
    upstream.mockResolvedValue(Response.json({ error: 'unavailable' }, { status }))
    expect((await call()).response.status).toBe(status); expect(refund()).toHaveBeenCalledOnce()
  })
  it('rejects oversized UTF-8 context before the provider', async () => {
    expect((await call({ messages: [{ role: 'user', content: 'é'.repeat(40_000) }] })).result.error).toBe('trial_request_limit')
    expect(upstream).not.toHaveBeenCalled(); expect(refund()).toHaveBeenCalledOnce()
  })
  it('refunds a rejected network request exactly once', async () => {
    upstream.mockRejectedValue(new Error('network unavailable'))
    expect((await call()).response.status).toBe(502); expect(refund()).toHaveBeenCalledOnce()
  })
  it('never debits the trial or applies trial policy with BYOK', async () => {
    expect((await call({ model: 'gpt-5.6-terra', max_completion_tokens: 8000 }, true)).response.status).toBe(200)
    expect(m.google).not.toHaveBeenCalled(); expect(m.email).not.toHaveBeenCalled()
    expect(JSON.parse(upstream.mock.calls[0][1].body).max_completion_tokens).toBe(8000)
  })
  it('records the existing per-call tool continuation accounting honestly', async () => {
    await call(); upstream.mockResolvedValue(Response.json({ choices: [], usage: {} }))
    await call({ messages: [{ role: 'user', content: 'Bonjour' }, { role: 'tool', content: 'Résultat' }] })
    expect(kind === 'google' ? m.google : m.email).toHaveBeenCalledTimes(2)
  })
})
