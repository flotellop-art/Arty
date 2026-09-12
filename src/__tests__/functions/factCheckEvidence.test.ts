import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
const { quota, auth, usage } = vi.hoisted(() => ({ quota: vi.fn(), auth: vi.fn(), usage: vi.fn() }))
vi.mock('../../../functions/api/_lib/atomicQuota', () => ({ consumeCapAtomic: quota }))
vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({ checkAllowedUserPeek: auth }))
vi.mock('../../../functions/api/_lib/quota', () => ({ recordUsage: usage }))
import { admitEvidenceWork, evidenceClaims, readBoundedJSON, readEvidencePage, verifyFactEvidence, sensitiveFact, type EvidenceClaim } from '../../../functions/api/_lib/factCheckEvidence'
import { onRequestPost } from '../../../functions/api/ai/fact-check'
import { factCorrection, factProofTarget, hasAcceptedFactProof, isFactReview } from '../../../shared/factCheckEvidence'

// Deliberately fictitious documents: these test the protocol, not model accuracy.
const url = 'https://example.com/spec'
const quote = 'Le modèle Alpha version 2 mesure exactement 30 centimètres.'
const doc = { id: '', url, text: `Fiche fictive. ${quote} La version 1 mesurait 20 centimètres.`, fetchedAt: 100, sha256: 'a'.repeat(64) }
const claim: EvidenceClaim = { claim: 'Taille de la version 2', verdict: 'wrong', explanation: 'Version incorrecte', originalText: 'mesure exactement 20 centimètres', correction: 'mesure exactement 30 centimètres', evidenceUrls: [url] }
const input = { question: 'Quelle taille ?', response: 'Le modèle Alpha version 2 mesure exactement 20 centimètres.', claims: [claim], sourceUrls: [url], model: 'claude-sonnet-5' }
const checks = (extra = {}) => ({ checks: [{ index: 0, decision: 'supported', contextMatches: true, sensitive: false, reason: 'Version et dimensions confirmées.', evidence: [{ sourceId: 's1', quote }], ...extra }] })
const review = (extra = {}, model = 'claude-sonnet-5') => ({ text: JSON.stringify(checks(extra)), model, complete: true })
const db = { prepare: () => ({ run: async () => ({ success: true }) }) }
const env = { DB: db, LINKUP_API_KEY: 'synthetic', ANTHROPIC_API_KEY: 'synthetic', GEMINI_API_KEY: 'synthetic' } as never
beforeEach(() => { vi.clearAllMocks(); quota.mockResolvedValue({ status: 'consumed' }); auth.mockResolvedValue({ email: 'test@example.com', planType: 'vip' }); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => vi.unstubAllGlobals())

describe('documentary proof protocol', () => {
  it('reviews exactly the same replacement the client can apply, including leading whitespace', () => {
    const padded = { ...claim, originalText: ' '.repeat(600) + claim.originalText, correction: ' '.repeat(600) + claim.correction }
    const parsed = evidenceClaims(JSON.stringify({ claims: [padded] }))![0]!
    expect(parsed.originalText).toBe(claim.originalText)
    expect(parsed.correction).toBe(claim.correction)
    expect(factProofTarget(parsed)).toBe(factProofTarget(padded))
    expect(factCorrection({ ...claim, correction: 'x'.repeat(500) })).toEqual({})
  })
  it('stores the actual quote, surrounding context, retrieval time and page digest', async () => {
    const call = vi.fn(async () => review())
    const [result] = await verifyFactEvidence(input, { read: async () => doc, review: call })
    expect(hasAcceptedFactProof(result)).toBe(true)
    expect(isFactReview(result)).toBe(true)
    expect(result!.evidence[0]).toEqual({ sourceId: 's1', url, quote, context: doc.text, fetchedAt: 100, sha256: doc.sha256 })
    expect(call).toHaveBeenCalledTimes(1)
    expect(call.mock.calls[0]).toBeDefined()
  })
  it.each([
    { evidence: [{ sourceId: 's1', quote: 'Une preuve inventée par le modèle.' }] },
    { evidence: [{ sourceId: 's99', quote }] },
    { contextMatches: false }, { decision: 'contested' }, { decision: 'unsupported' },
  ])('refuses missing, invented or contradicted evidence: %j', async extra => {
    const [r] = await verifyFactEvidence(input, { read: async () => doc, review: async () => review(extra) })
    expect(hasAcceptedFactProof(r)).toBe(false)
  })
  it('refuses an ambiguous repeated quote and an incomplete review', async () => {
    const [r] = await verifyFactEvidence(input, { read: async () => ({ ...doc, text: `${quote}\n${quote}` }), review: async () => review() })
    expect(hasAcceptedFactProof(r)).toBe(false)
    const [cut] = await verifyFactEvidence(input, { read: async () => doc, review: async () => ({ ...review(), complete: false }) })
    expect(cut!.status).toBe('unavailable')
  })
  it.each(['{"checks":[]}', '{"checks":[{"index":0},{"index":0}]}', '```json\n[]\n```', 'prefix {"checks":[]}'])('rejects malformed grouped reviews: %s', async text => {
    const [r] = await verifyFactEvidence(input, { read: async () => doc, review: async () => ({ ...review(), text }) })
    expect(r!.status).toBe('unavailable')
  })
  it.each(['gemini-3.8-flash', 'claude-sonnet-5', null])('requires a completed independent challenge for sensitive corrections: %s', async model => {
    const call = vi.fn(async (_prompt: string, independent: boolean) => independent ? model ? review({}, model) : null : review())
    const [r] = await verifyFactEvidence({ ...input, question: 'Conséquences pour la santé ?' }, { read: async () => doc, review: call })
    expect(call.mock.calls.map(c => c[1])).toEqual([false, true])
    expect(hasAcceptedFactProof(r)).toBe(model === 'gemini-3.8-flash')
    expect(r!.challenge).toBe(model === 'gemini-3.8-flash' ? 'accepted' : 'unavailable')
  })
  it('keeps a contested sensitive correction unapplied and exposes the objection', async () => {
    const [r] = await verifyFactEvidence({ ...input, question: 'Un risque médical ?' }, { read: async () => doc,
      review: async (_p, independent) => independent ? review({ decision: 'contested', reason: 'Exception ignorée.' }, 'gemini-3.8-flash') : review() })
    expect(r).toMatchObject({ status: 'contested', challenge: 'rejected', reason: 'Exception ignorée.' })
  })
  it('bounds and deduplicates source reads, excluding private and invented URLs', async () => {
    const read = vi.fn(async () => doc)
    await verifyFactEvidence({ ...input, claims: [{ ...claim, evidenceUrls: ['https://invented.example/page'] }], sourceUrls: [url, url, 'http://127.0.0.1', 'https://example.org/a', 'https://example.net/a', 'https://example.edu/a'] }, { read, review: async () => review() })
    expect(read.mock.calls).toHaveLength(3)
    expect(read).not.toHaveBeenCalledWith('https://invented.example/page')
    expect(read).not.toHaveBeenCalledWith('http://127.0.0.1')
  })
  it('does not pay for reviewing when every page is unavailable', async () => {
    const call = vi.fn()
    const [r] = await verifyFactEvidence(input, { read: async () => { throw new Error('unavailable') }, review: call })
    expect(call).not.toHaveBeenCalled(); expect(r!.status).toBe('unavailable')
  })
  it('cannot disable sensitive classification with a model flag', () => {
    expect(sensitiveFact('Quelle dose en mg ?', '', { ...claim, sensitive: false })).toBe(true)
    expect(sensitiveFact('Un rendement financier garanti ?', '', claim)).toBe(true)
    expect(sensitiveFact('Quelle taille ?', '', claim)).toBe(false)
  })
  it('rejects coerced enums in persisted receipts', async () => {
    const [r] = await verifyFactEvidence(input, { read: async () => doc, review: async () => review() })
    expect(isFactReview({ ...r, status: ['supported'] })).toBe(false)
    expect(isFactReview({ ...r, challenge: ['not_required'] })).toBe(false)
  })
})
describe('bounded paid reads and admission', () => {
  it.each(['cap_reached', 'fail_open'])('does not call the page service if quota is %s', async status => {
    quota.mockResolvedValue({ status }); const http = vi.fn(); vi.stubGlobal('fetch', http)
    expect(await readEvidencePage(env, 'test@example.com', url, Date.now() + 5000)).toBeNull()
    expect(http).not.toHaveBeenCalled()
  })
  it('fails closed without a database', async () => {
    expect(await admitEvidenceWork({} as never, 'test@example.com', 'review')).toBe(false)
    expect(quota).not.toHaveBeenCalled()
  })
  it('fetches only through the fixed page service and hashes the actual content', async () => {
    const http = vi.fn(async () => Response.json({ markdown: doc.text })); vi.stubGlobal('fetch', http)
    const result = await readEvidencePage(env, 'test@example.com', url, Date.now() + 5000)
    expect(result?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(http).toHaveBeenCalledWith('https://api.linkup.so/v1/fetch', expect.objectContaining({ body: JSON.stringify({ url, includeRawHtml: false, extractImages: false }) }))
    expect(quota.mock.calls[0]![2].slice(2)).toEqual(['fact-check-pages', 45])
  })
  it.each([{ markdown: 'x'.repeat(20001) }, { markdown: doc.text, truncated: true }, { markdown: '' }])('rejects incomplete pages: %j', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)))
    expect(await readEvidencePage(env, 'test@example.com', url, Date.now() + 5000)).toBeNull()
  })
  it('enforces bytes even when the server omits content-length', async () => {
    await expect(readBoundedJSON(Response.json({ text: 'x'.repeat(101) }), 100)).rejects.toThrow('size')
  })
})
describe('real endpoint with synthetic provider responses', () => {
  it.each([['sonnet', true], ['gemini', true], ['sonnet', false], ['gemini', false]] as const)('routes %s through independent review, attested identity = %s', async (tier, attested) => {
    const geminiPrimary = tier === 'gemini'
    const initial = JSON.stringify({ overall_confidence: 'low', claims: [{ ...claim, sensitive: true }] })
    const anthropic = (text: string, identity = true) => Response.json({ stop_reason: 'end_turn', ...(identity ? { model: 'claude-sonnet-5' } : {}), content: [{ type: 'text', text, citations: [{ type: 'web_search_result_location', url }] }], usage: { input_tokens: 10, output_tokens: 5 } })
    const gemini = (text: string, identity = true) => Response.json({ ...(identity ? { modelVersion: 'gemini-3.8-flash' } : {}), candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] }, groundingMetadata: { groundingChunks: [{ web: { uri: url } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })
    const http = vi.fn().mockResolvedValueOnce(geminiPrimary ? gemini(initial) : anthropic(initial))
      .mockResolvedValueOnce(Response.json({ markdown: doc.text }))
      .mockResolvedValueOnce(geminiPrimary ? gemini(review().text) : anthropic(review().text))
      .mockResolvedValueOnce(geminiPrimary ? anthropic(review().text, attested) : gemini(review().text, attested))
    vi.stubGlobal('fetch', http)
    const res = await onRequestPost({ env, request: new Request('https://tryarty.com/api/ai/fact-check', { method: 'POST', body: JSON.stringify({ tier, question: input.question, response: input.response.repeat(2) }) }) } as never)
    expect(res.status).toBe(200)
    const result = await res.json() as { evidenceVersion: number; evidenceChecks: unknown[]; reviewUsage: unknown[] }
    expect(result.evidenceVersion).toBe(1)
    expect(result.evidenceChecks[0]).toMatchObject(attested
      ? { status: 'supported', challenge: 'accepted', challengerModel: geminiPrimary ? 'claude-sonnet-5' : 'gemini-3.8-flash' }
      : { status: 'unavailable', challenge: 'unavailable' })
    expect(result.reviewUsage).toHaveLength(2)
    expect(http).toHaveBeenCalledTimes(4); expect(usage).toHaveBeenCalledTimes(3)
    expect(quota.mock.calls.map(c => c[2][2])).toEqual(['fact-check-sonnet', 'fact-check-pages', 'fact-check-sonnet', 'fact-check-sonnet'])
    const body = JSON.parse(http.mock.calls[2]![1].body)
    expect(body.tools).toBeUndefined()
    if (geminiPrimary) expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
    else expect(body.output_config).toEqual({ effort: 'medium' })
    if (geminiPrimary) expect(JSON.parse(http.mock.calls[3]![1].body).output_config).toEqual({ effort: 'high' })
  })
  it('refuses the initial paid call without confirmed admission', async () => {
    quota.mockResolvedValue({ status: 'fail_open' }); const http = vi.fn(); vi.stubGlobal('fetch', http)
    const res = await onRequestPost({ env, request: new Request('https://tryarty.com/api/ai/fact-check', { method: 'POST', body: JSON.stringify({ response: input.response.repeat(2) }) }) } as never)
    expect(res.status).toBe(503); expect(http).not.toHaveBeenCalled()
  })
})
