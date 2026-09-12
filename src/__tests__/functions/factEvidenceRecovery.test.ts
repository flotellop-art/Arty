import { describe, expect, it, vi } from 'vitest'
import { verifyFactEvidence, type EvidenceClaim } from '../../../functions/api/_lib/factCheckEvidence'
import { hasAcceptedFactProof, factProofTarget } from '../../../shared/factCheckEvidence'

const original = 'https://example.com/old', fresh = 'https://example.com/new'
const quote = 'Le produit Alpha mesure trente centimètres.'
const page = (url: string) => ({ id: '', url, text: quote, sha256: 'a'.repeat(64), fetchedAt: 1 })
const claims: EvidenceClaim[] = Array.from({ length: 4 }, (_, i) => ({ claim: `Fait ${i}`, verdict: 'verified', explanation: 'À examiner' }))
const input = { question: 'Quelle taille ?', response: 'Contexte original complet', model: 'claude-sonnet-5', claims, sourceUrls: [original] }
const check = (index: number, decision = 'supported', sourceId = 's1') => ({ index, decision, contextMatches: true, sensitive: false, reason: 'Examen documentaire', evidence: [{ sourceId, quote }] })
const reply = (checks: unknown[], model = input.model) => ({ text: JSON.stringify({ checks }), complete: true, model })

describe('targeted evidence recovery', () => {
  it.each([null, 'contested'])('a recovered sensitive proposal still needs an independent accepted challenge (%s)', async decision => {
    const sensitive = { ...claims[0]!, verdict: 'wrong' as const, originalText: '20 mg', correction: '30 mg' }
    let ordinary = 0
    const review = vi.fn(async (_prompt, independent) => {
      if (independent) return decision ? reply([check(0, decision, 's2')], 'gemini-3.8-flash') : null
      return reply([check(0, ordinary++ ? 'supported' : 'unsupported', ordinary > 1 ? 's2' : 's1')])
    })
    const [result] = await verifyFactEvidence({ ...input, claims: [sensitive] }, { read: async url => page(url), review, discover: async () => [fresh] })
    expect(hasAcceptedFactProof(result)).toBe(false)
    expect(result!.challenge).toBe(decision ? 'rejected' : 'unavailable')
    expect(review.mock.calls.map(c => c[1])).toEqual([false, false, true])
  })
  it('keeps accepted receipts, immutable targets, original indices and old documents in recovery', async () => {
    const review = vi.fn().mockResolvedValueOnce(reply([check(0), check(1, 'unsupported'), check(2), check(3, 'unsupported')]))
      .mockResolvedValueOnce(reply([check(1, 'supported', 's2'), check(3, 'supported', 's2')]))
    const discover = vi.fn(async () => [original, fresh, fresh, 'http://127.0.0.1/private'])
    const read = vi.fn(async (url: string) => page(url))
    const results = await verifyFactEvidence(input, { read, review, discover })
    expect(results.every(hasAcceptedFactProof)).toBe(true)
    expect(results.map(r => r.target)).toEqual(claims.map(factProofTarget))
    expect(results[0]!.evidence[0]!.url).toBe(original)
    expect(results[1]!.evidence[0]!.url).toBe(fresh)
    expect(discover).toHaveBeenCalledWith([claims[1], claims[3]], [original])
    const prompt = JSON.parse(review.mock.calls[1]![0].split('DONNÉES :\n')[1])
    expect(prompt.claims.map((c: { index: number }) => c.index)).toEqual([1, 3])
    expect(prompt.response).toBe(input.response)
    expect(prompt.documents.map((d: { id: string }) => d.id)).toEqual(['s1', 's2'])
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('retains contradictions and only tries new public pages once, at most two', async () => {
    const read = vi.fn(async (url: string) => page(url))
    const review = vi.fn().mockResolvedValueOnce(reply([check(0, 'contested'), check(1, 'unsupported'), check(2), check(3)]))
      .mockResolvedValueOnce(null)
    const discover = vi.fn(async () => [fresh, 'https://example.org/new', 'https://example.net/new'])
    const results = await verifyFactEvidence(input, { read, review, discover })
    expect(discover.mock.calls).toHaveLength(1)
    expect(read).toHaveBeenCalledTimes(3)
    expect(results[0]!.status).toBe('contested')
    expect(results[1]!.status).toBe('unsupported')
    expect(hasAcceptedFactProof(results[2])).toBe(true)
  })
  it('recovers when initial pages are unavailable without treating search prose as proof', async () => {
    const review = vi.fn(async () => reply([check(0, 'supported')]))
    const [result] = await verifyFactEvidence({ ...input, claims: [claims[0]!] }, {
      read: async url => url === fresh ? page(url) : null, review, discover: async () => [fresh],
    })
    expect(hasAcceptedFactProof(result)).toBe(true)
    expect(review).toHaveBeenCalledTimes(1)
    const [unavailable] = await verifyFactEvidence({ ...input, claims: [claims[0]!] }, {
      read: async () => null, review, discover: async () => [fresh],
    })
    expect(unavailable!.status).toBe('unavailable')
    expect(review).toHaveBeenCalledTimes(1)
  })
  it('never retries a rejected sensitive challenge and keeps full quotation context', async () => {
    const claim: EvidenceClaim = { ...claims[0]!, verdict: 'wrong', originalText: '20 mg', correction: '30 mg' }
    const discover = vi.fn(async () => [fresh])
    const review = vi.fn(async (_prompt, independent) => reply([check(0, independent ? 'contested' : 'supported')], independent ? 'gemini-3.8-flash' : input.model))
    const [result] = await verifyFactEvidence({ ...input, question: 'Citation médicale à reproduire', claims: [claim] }, { read: async () => page(original), review, discover })
    expect(result).toMatchObject({ status: 'contested', challenge: 'rejected' })
    expect(discover).not.toHaveBeenCalled()
    expect(review.mock.calls.every(c => c[0].includes(input.response))).toBe(true)
  })
})
