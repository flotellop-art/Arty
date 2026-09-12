import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'

const { auth, quota, usage } = vi.hoisted(() => ({ auth: vi.fn(), quota: vi.fn(), usage: vi.fn() }))
vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({ checkAllowedUserPeek: auth }))
vi.mock('../../../functions/api/_lib/atomicQuota', () => ({ consumeCapAtomic: quota }))
vi.mock('../../../functions/api/_lib/quota', () => ({ recordUsage: usage }))
import { normalizeVerdictContent, onRequestPost } from '../../../functions/api/ai/fact-check'

const http = vi.fn()
const env = { DB: { prepare: () => ({ run: async () => ({ success: true }) }) }, ANTHROPIC_API_KEY: 'test-a', GEMINI_API_KEY: 'test-g' }
const call = (tier = 'sonnet', extra = {}, runtime = env) => onRequestPost({ env: runtime, request: new Request('https://tryarty.com/api/ai/fact-check', {
  method: 'POST', body: JSON.stringify({ tier, question: 'Quels faits ?', response: 'Réponse publique à vérifier avec ses dates et son contexte. '.repeat(3), ...extra }),
}) } as never)
const timeout = () => Object.assign(new Error('synthetic'), { name: 'TimeoutError' })
const anthropic = (extra = {}) => Response.json({ model: 'claude-sonnet-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: '{"overall_confidence":"high","claims":[]}' }], usage: {}, ...extra })
const gemini = () => Response.json({ modelVersion: 'gemini-3.8-flash', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"overall_confidence":"high","claims":[]}' }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 } })

beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ email: 'test@example.test', planType: 'vip' }); quota.mockResolvedValue({ status: 'consumed' }); vi.stubGlobal('fetch', http) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('bounded balanced fact-check', () => {
  it('attaches receipts to a complete verdict after a preamble in the same text block', async () => {
    http.mockResolvedValueOnce(anthropic({ content: [{ type: 'text', text: 'Voici le résultat demandé :\n```json\n' + JSON.stringify({ overall_confidence: 'high', claims: [{ claim: 'Fait', verdict: 'verified', explanation: 'À vérifier.' }] }) + '\n```' }] }))
    const result = await (await call('haiku')).json()
    expect(result.content[0].text).toBe('{"overall_confidence":"high","claims":[{"claim":"Fait","verdict":"verified","explanation":"À vérifier."}]}')
    expect(result.evidenceChecks).toHaveLength(1)
    expect(result.evidenceChecks[0].target).toBe('["Fait","verified",null,null]')
  })
  it.each([
    '[{"overall_confidence":"high","claims":[]}]',
    '{"overall_confidence":"high","claims":[]} {"claims":[]}',
    '{"overall_confidence":"high","claims":[]} {"claims":[',
    '{"overall_confidence":"high","claims":[]} puis un commentaire',
  ])('rejects an invalid terminal verdict at the endpoint instead of allowing client salvage: %s', async text => {
    http.mockResolvedValueOnce(anthropic({ content: [{ type: 'text', text }] }))
    const response = await call('haiku')
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'fact_check_failed' })
  })
  it('uses one metered discovery and actual page reviews within the same request', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const url = 'https://example.com/old', next = 'https://example.com/new'
    const quote = 'Une source précise confirme la taille de trente centimètres.'
    const claim = { claim: 'Taille', verdict: 'verified', explanation: '', evidenceUrls: [url] }
    const content = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }]
    const checks = (decision: string, sourceId: string) => ({ checks: [{ index: 0, decision, contextMatches: true, sensitive: false, reason: 'Lecture réelle', evidence: [{ sourceId, quote }] }] })
    http.mockReset()
    http.mockResolvedValueOnce(anthropic({ content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url }] }, ...content({ overall_confidence: 'high', claims: [claim] })] }))
      .mockResolvedValueOnce(Response.json({ markdown: quote }))
      .mockResolvedValueOnce(anthropic({ content: content(checks('unsupported', 's1')) }))
      .mockResolvedValueOnce(anthropic({ content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: next }] }] }))
      .mockResolvedValueOnce(Response.json({ markdown: quote }))
      .mockResolvedValueOnce(anthropic({ content: content(checks('supported', 's2')) }))
    const response = 'Réponse publique à vérifier avec ses dates et son contexte. '.repeat(3)
    const result = await (await call('sonnet', { context: `Citation avec restriction : ${response}` }, { ...env, LINKUP_API_KEY: 'synthetic' } as typeof env)).json()
    expect(result).toMatchObject({ evidenceRecoveryAttempted: true, evidenceChecks: [{ status: 'supported' }] })
    expect(http).toHaveBeenCalledTimes(6)
    expect(JSON.parse(http.mock.calls[3]![1].body).tools[0]).toMatchObject({ max_uses: 1, allowed_callers: ['direct'] })
    expect(JSON.parse(http.mock.calls[5]![1].body).messages[0].content).toContain('Citation avec restriction')
    expect(quota).toHaveBeenCalledTimes(6)
    expect(usage).toHaveBeenCalledTimes(4)
  })
  it('rejects an unrelated or oversized batch context before spending quota', async () => {
    expect((await call('sonnet', { context: 'Un autre texte' })).status).toBe(400)
    expect((await call('sonnet', { context: 'x'.repeat(24_001) })).status).toBe(400)
    expect(quota).not.toHaveBeenCalled()
  })
  it('does not launch a fallback after the remaining work budget has expired', async () => {
    let now = 0; vi.spyOn(Date, 'now').mockImplementation(() => now)
    http.mockReset().mockImplementationOnce(async () => { now = 3000; throw timeout() })
    expect((await call('sonnet', { budgetMs: 3000 })).status).toBe(503)
    expect(http).toHaveBeenCalledTimes(1)
  })
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
