import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { factCheckResponse, applyClaimCorrections } from '../../services/factChecker'
import { recordUsage } from '../../services/costTracker'
import { projectLocalSyncConversationShape } from '../../services/workspaceSync/captureProjection'
import { mapCapturedConversation } from '../../services/workspaceBackup/captureMapping'
import { validateSnapshot } from '../../services/workspaceBackup/schema'
import type { FactCheckClaim, Conversation } from '../../types'
vi.mock('../../services/apiBase', () => ({ apiUrl: (p: string) => p }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn(async () => 'synthetic') }))
vi.mock('../../services/costTracker', () => ({ recordUsage: vi.fn() }))
const answer = 'Une réponse factuelle suffisamment longue pour tester la vérification, ses sources et les limites de sa couverture.'
const claim = (verdict = 'verified') => ({ claim: 'Une affirmation factuelle', verdict, explanation: 'Une explication' })
const response = (claims: unknown = [], extra: object = {}) => Response.json({
  content: [{ type: 'text', text: JSON.stringify({ overall_confidence: 'high', claims }) }], completion: 'complete', webEvidence: true, ...extra,
})
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())
describe('fact-check integrity through the real client', () => {
  it.each([{}, [{ overall_confidence: 'high', claims: [] }], { claims: null }, { claims: 'none' }, { claims: [null] }, { claims: [claim(), { claim: '', verdict: 'verified', explanation: '' }] },
    { claims: [{ ...claim(), verdict: 'true' }] }, { claims: [{ ...claim(), claim: 3 }] }, { claims: [] }])('rejects malformed provider results: %j', async payload => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ completion: 'complete', content: [{ type: 'text', text: JSON.stringify(payload) }] })))
    expect((await factCheckResponse('Question', answer, 'haiku')).result).toBeNull()
  })
  it('accepts an explicit valid empty result, but rejects a provider cutoff and keeps its paid usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    expect((await factCheckResponse('Question', answer, 'haiku')).result?.status).toBe('success-empty')
    vi.stubGlobal('fetch', vi.fn(async () => response([], { completion: 'incomplete', usage: { input_tokens: 12, output_tokens: 5 } })))
    expect((await factCheckResponse('Question', answer, 'haiku')).result).toBeNull()
    expect(recordUsage).toHaveBeenCalledWith(expect.any(String), 12, 5)
  })
  it.each(['```json\n[{"overall_confidence":"high","claims":[]}]\n```', '[{"overall_confidence":"high","claims":[]}',
    'Voici le résultat : [{"overall_confidence":"high","claims":[]}]', 'Voici le résultat : [{"overall_confidence":"high","claims":[]}'])('rejects wrapped or truncated arrays: %s', async text => {
    vi.stubGlobal('fetch', vi.fn(async () => response([], { content: [{ type: 'text', text }] })))
    expect((await factCheckResponse('Question', answer, 'haiku')).result).toBeNull()
  })
  it('treats an older server without completion attestation conservatively', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([], { completion: undefined })))
    expect((await factCheckResponse('Question', answer, 'haiku')).result).toMatchObject({ status: 'partial', limitations: ['completion_unknown'] })
  })
  it.each([[], [claim()]])('rejects low confidence with no risky conclusion: %j', async claims => {
    vi.stubGlobal('fetch', vi.fn(async () => response(claims, { content: [{ type: 'text', text: JSON.stringify({ claims, overall_confidence: 'low' }) }] })))
    expect((await factCheckResponse('Question', answer, 'haiku')).result).toBeNull()
  })
  it('marks missing research after a failed escalation and after a no-web model fallback', async () => {
    const http = vi.fn().mockResolvedValueOnce(response([claim()], { webEvidence: false })).mockResolvedValueOnce(new Response('', { status: 503 }))
    vi.stubGlobal('fetch', http)
    expect((await factCheckResponse('Question', answer, 'auto')).result).toMatchObject({ status: 'partial', limitations: ['search_unavailable'] })
    expect(http).toHaveBeenCalledTimes(2)
    http.mockReset().mockResolvedValue(response([], { webEvidence: false, fallback: 'model', model: 'claude-sonnet-5' }))
    expect((await factCheckResponse('Question', answer, 'auto')).result?.status).toBe('partial')
    expect(http).toHaveBeenCalledTimes(1)
  })
  it.each([6000, 6001])('records submitted prefix honestly at %i characters, including empty claims', async length => {
    const http = vi.fn(async (_url: unknown, _init: RequestInit) => response()); vi.stubGlobal('fetch', http)
    const result = (await factCheckResponse('Question', 'x'.repeat(length), 'haiku')).result!
    expect(result.status).toBe(length > 6000 ? 'partial' : 'success-empty')
    expect(result.coverage).toEqual({ inputChars: length, submittedChars: Math.min(length, 6000), claimLimitReached: false })
    expect(JSON.parse(String(http.mock.calls[0]![1].body)).response.length).toBe(Math.min(length, 6000))
  })
  it('keeps a failed web escalation partial even when the first pass had some sources', async () => {
    const http = vi.fn().mockResolvedValueOnce(response([claim('uncertain')])).mockResolvedValueOnce(response([], { webEvidence: false, fallback: 'without_web_search' }))
    vi.stubGlobal('fetch', http)
    const result = await factCheckResponse('Question', answer, 'auto', { provider: 'synthetic', query: 'Question', answer: 'Une source ne couvrant pas tout.' })
    expect(result.result).toMatchObject({ status: 'partial', limitations: ['search_unavailable'] })
    expect(http).toHaveBeenCalledTimes(2)
  })
  it.each([{ inputChars: 6001, submittedChars: 6001 }, { inputChars: 10, submittedChars: 11 }])('rejects inconsistent synchronized coverage: %j', coverage => {
    expect(() => projectLocalSyncConversationShape({ id: 'c', title: '', createdAt: 1, updatedAt: 1,
      messages: [{ id: 'm', role: 'assistant', content: answer, timestamp: 1, factCheck: {
        overallConfidence: 'high', claims: [], modelLabel: 'test', checkedAt: 1, status: 'partial',
        coverage: { ...coverage, claimLimitReached: false },
      } }],
    })).toThrow()
  })
  it.each([9, 10, 11])('signals the display limit for %i returned claims', async count => {
    vi.stubGlobal('fetch', vi.fn(async () => response(Array.from({ length: count }, () => claim()))))
    const result = (await factCheckResponse('Question', answer, 'haiku')).result!
    expect(result.claims).toHaveLength(Math.min(count, 10))
    expect(result.status).toBe(count >= 10 ? 'partial' : 'success-empty')
  })
  it('preserves limitations in sync and backup capture, with old results still readable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    const result = (await factCheckResponse('Question', 'x'.repeat(6001), 'haiku')).result!
    const conv: Conversation = { id: 'c1', title: 'test', createdAt: 1, updatedAt: 1, messages: [{ id: 'a1', role: 'assistant', content: answer, timestamp: 1, factCheck: result }] }
    const restored = projectLocalSyncConversationShape(JSON.parse(JSON.stringify(conv)))
    expect(restored.messages[0]!.factCheck).toEqual(result)
    const captured = mapCapturedConversation(restored)
    expect(captured.messages[0]!.factCheck).toEqual(result)
    expect(() => validateSnapshot({ conversations: [captured], projects: [], files: [], objects: [] })).not.toThrow()
    delete result.coverage; delete result.limitations; result.status = 'success-empty'
    expect(projectLocalSyncConversationShape(conv).messages[0]!.factCheck).toEqual(result)
  })
  it('keeps a successful first pass partial when the required second tier has exhausted its quota', async () => {
    const http = vi.fn().mockResolvedValueOnce(response([claim()], { webEvidence: false })).mockResolvedValueOnce(new Response('', { status: 429 }))
    vi.stubGlobal('fetch', http)
    expect((await factCheckResponse('Question', answer, 'auto')).result?.status).toBe('partial')
    http.mockClear().mockResolvedValue(response([claim()], { webEvidence: false }))
    expect((await factCheckResponse('Question', answer, 'auto')).result?.status).toBe('partial')
    expect(http).toHaveBeenCalledTimes(1)
  })
})
const correction = (originalText: string, corrected = 'une valeur corrigée'): FactCheckClaim => ({ ...claim('wrong'), verdict: 'wrong', originalText, correction: corrected })
describe('safe correction spans', () => {
  it.each([
    ['Le chiffre 5 apparaît aussi dans 50.', '5'],
    ['valeur de 2025 puis valeur de 2025', 'valeur de 2025'],
    ["risque d'orage demain et risque d’orage demain", "risque d'orage demain"],
    ['prefixevaleur incorrecteSuffixe', 'valeur incorrecte'],
    ['[valeur incorrecte](https://example.com)', 'valeur incorrecte'],
    ['`valeur incorrecte`', 'valeur incorrecte'],
    ['```text\nvaleur incorrecte\n```', 'valeur incorrecte'],
    ['https://example.com/valeur-incorrecte', 'valeur-incorrecte'],
    ['La **valeur** incorrecte', 'valeur incorrecte'],
    ['e\u0301abcdefghijklmnop.', 'abcdefghijklmnop'],
    ['𐐀abcdefghijklmnop.', 'abcdefghijklmnop'],
  ])('preserves an ambiguous or protected span: %s', (text, original) => {
    const c = correction(original)
    expect(applyClaimCorrections(text, [c])).toEqual({ correctedContent: text, appliedCount: 0 })
    expect(c.applied).toBe(false)
  })
  it('applies disjoint corrections against the original, never cascading into a replacement', () => {
    const a = correction('la première valeur', 'la seconde valeur'), b = correction('la seconde valeur', 'la troisième valeur')
    expect(applyClaimCorrections('Voici la première valeur, puis la seconde valeur.', [a, b])).toEqual({ correctedContent: 'Voici la seconde valeur, puis la troisième valeur.', appliedCount: 2 })
  })
  it('refuses both overlapping proposals', () => {
    const text = 'Une première valeur incorrecte dans le texte.'
    expect(applyClaimCorrections(text, [correction('première valeur incorrecte'), correction('valeur incorrecte')])).toEqual({ correctedContent: text, appliedCount: 0 })
  })
  it('keeps offsets after a letter that expands when lowercased', () => {
    expect(applyClaimCorrections('İstanbul : erreur manifeste. Puis autre chose.', [correction(': erreur manifeste.', ': vérité vérifiée.')]))
      .toEqual({ correctedContent: 'İstanbul : vérité vérifiée. Puis autre chose.', appliedCount: 1 })
  })
  it.each([['# Correction', '\\# Correction'], ['1. Correction', '1\\. Correction'], ['- Correction', '\\- Correction']])('preserves prose when the replacement resembles Markdown: %s', (proposal, escaped) => {
    expect(applyClaimCorrections('Une phrase incorrecte.', [correction('Une phrase incorrecte.', proposal)]))
      .toEqual({ correctedContent: escaped, appliedCount: 1 })
  })
  it.each([['Titre\nUne phrase incorrecte.', '===='], ['> Une phrase incorrecte.', '- Correction']])('keeps a proposal unapplied if it changes surrounding Markdown: %s', (text, proposal) => {
    const c = correction('Une phrase incorrecte.', proposal)
    expect(applyClaimCorrections(text, [c])).toEqual({ correctedContent: text, appliedCount: 0 })
    expect(c.applied).toBe(false)
  })
})
