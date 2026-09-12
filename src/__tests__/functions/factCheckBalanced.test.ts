import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, quota, usage } = vi.hoisted(() => ({ auth: vi.fn(), quota: vi.fn(), usage: vi.fn() }))
vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({ checkAllowedUserPeek: auth }))
vi.mock('../../../functions/api/_lib/atomicQuota', () => ({ consumeCapAtomic: quota }))
vi.mock('../../../functions/api/_lib/quota', () => ({ recordUsage: usage }))
import { normalizeVerdictContent, onRequestPost } from '../../../functions/api/ai/fact-check'

const http = vi.fn()
const env = { DB: { prepare: () => ({ run: async () => ({ success: true }) }) }, ANTHROPIC_API_KEY: 'test-a', GEMINI_API_KEY: 'test-g' }
const call = (tier = 'sonnet') => onRequestPost({ env, request: new Request('https://tryarty.com/api/ai/fact-check', {
  method: 'POST', body: JSON.stringify({ tier, question: 'Quels faits ?', response: 'Réponse publique à vérifier avec ses dates et son contexte. '.repeat(3) }),
}) } as never)
const timeout = () => Object.assign(new Error('synthetic'), { name: 'TimeoutError' })
const anthropic = (extra = {}) => Response.json({ model: 'claude-sonnet-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: '{"overall_confidence":"high","claims":[]}' }], usage: {}, ...extra })
const gemini = () => Response.json({ modelVersion: 'gemini-3.8-flash', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"overall_confidence":"high","claims":[]}' }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 } })

beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ email: 'test@example.test', planType: 'vip' }); quota.mockResolvedValue({ status: 'consumed' }); vi.stubGlobal('fetch', http) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('bounded balanced fact-check', () => {
  it('uses the final strict verdict after search progress, without empty non-correction fields', async () => {
    const claim = { claim: 'Hauteur en 2000', verdict: 'verified', explanation: 'La source confirme la date.', originalText: '', correction: '' }
    http.mockResolvedValueOnce(anthropic({ content: [
      { type: 'text', text: 'Je recherche la valeur historique.' },
      { type: 'text', text: JSON.stringify({ overall_confidence: 'high', claims: [claim] }) },
    ] }))
    const result = await (await call('haiku')).json() as { content: Array<{text:string}>; evidenceChecks: unknown[] }
    expect(result.content).toHaveLength(1)
    expect(JSON.parse(result.content[0]!.text).claims).toEqual([{ claim: claim.claim, verdict: claim.verdict, explanation: claim.explanation }])
    expect(result.evidenceChecks).toHaveLength(1)
  })
  it('does not repair invalid corrections, truncate claim coverage, or parse an unfinished object', () => {
    const claim = { claim: 'Valeur', verdict: 'wrong', explanation: 'Erreur', originalText: '20', correction: '' }
    const blocks = [{type:'text' as const,text:JSON.stringify({claims:Array.from({length:12},()=>claim)})}]
    expect(JSON.parse(normalizeVerdictContent(blocks)[0]!.text).claims).toEqual(Array.from({length:12},()=>claim))
    const incomplete = [{type:'text' as const,text:'{"claims":['}]
    expect(normalizeVerdictContent(incomplete)).toBe(incomplete)
    const olderThenIncomplete = [...blocks, ...incomplete]
    expect(normalizeVerdictContent(olderThenIncomplete)).toBe(olderThenIncomplete)
  })
  it('separates Gemini progress parts from the final JSON without including thinking', async () => {
    http.mockResolvedValueOnce(Response.json({ modelVersion: 'gemini-3.8-flash', candidates: [{ finishReason: 'STOP', content: { parts: [
      { thought: true, text: 'Private reasoning' }, { text: 'Recherche en cours.' },
      { text: '{"overall_confidence":"high","claims":[]}' },
    ] } }] }))
    const result = await (await call('gemini')).json()
    expect(result.content).toEqual([{ type: 'text', text: '{"overall_confidence":"high","claims":[]}' }])
    expect(result.completion).toBe('complete')
  })
  it.each(['haiku', 'sonnet'])('sets an explicit Sonnet effort without changing Haiku (%s)', async tier => {
    http.mockResolvedValueOnce(anthropic())
    expect((await call(tier)).status).toBe(200)
    const body = JSON.parse(http.mock.calls[0]![1].body)
    if (tier === 'sonnet') {
      expect(body.thinking).toEqual({ type: 'adaptive' })
      expect(body.output_config).toEqual({ effort: 'medium' })
      expect(body.tools).toEqual([expect.objectContaining({ type: 'web_search_20260318', max_uses: 3, allowed_callers: ['direct'] })])
    } else {
      expect(body.thinking).toBeUndefined(); expect(body.output_config).toBeUndefined(); expect(body.tools).toBeUndefined()
    }
  })
  it('reaches Gemini after both Anthropic calls time out, with one initial quota debit', async () => {
    http.mockRejectedValueOnce(timeout()).mockRejectedValueOnce(timeout()).mockResolvedValueOnce(gemini())
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ fallback: 'provider', model: 'gemini-3.8-flash', completion: 'complete' })
    expect(http).toHaveBeenCalledTimes(3)
    expect(String(http.mock.calls[2]![0])).toContain('generativelanguage.googleapis.com')
    const fallbackBody = JSON.parse(http.mock.calls[1]![1].body)
    expect(fallbackBody.tools).toBeUndefined(); expect(fallbackBody.output_config).toEqual({ effort: 'medium' })
    expect(quota).toHaveBeenCalledTimes(1); expect(usage).toHaveBeenCalledTimes(1)
  })
  it('does not restart the shared deadline to reach Gemini', async () => {
    let now = 0; vi.spyOn(Date, 'now').mockImplementation(() => now)
    http.mockImplementationOnce(async () => { now = 50_000; throw timeout() })
      .mockImplementationOnce(async () => { now = 125_000; throw timeout() })
    const res = await call()
    expect(res.status).toBe(503); expect(http).toHaveBeenCalledTimes(2)
    expect(await res.json()).toMatchObject({ error: 'fact_check_failed' })
  })
  it('retains structured direct-search sources while ignoring a search-tool error', async () => {
    http.mockResolvedValueOnce(anthropic({ content: [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.org/source' }] },
      { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } },
      { type: 'text', text: '{"overall_confidence":"high","claims":[]}' },
    ] }))
    expect(await (await call()).json()).toMatchObject({ completion: 'complete', webEvidence: true })
    expect(http).toHaveBeenCalledTimes(1)
  })
  it.each(['max_tokens', 'pause_turn'])('does not call incomplete output verified or pay for another pass (%s)', async stop_reason => {
    http.mockResolvedValueOnce(anthropic({ stop_reason }))
    expect(await (await call()).json()).toMatchObject({ completion: 'incomplete' })
    expect(http).toHaveBeenCalledTimes(1)
  })
  it('keeps the provider response byte limit with direct search', async () => {
    http.mockResolvedValueOnce(new Response('oversized', { headers: { 'content-length': '200001' } }))
    expect((await call()).status).toBe(503)
    expect(http).toHaveBeenCalledTimes(1)
  })
})
