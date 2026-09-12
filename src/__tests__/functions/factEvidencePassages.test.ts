import { describe, expect, it, vi } from 'vitest'
import { evidencePassages, verifyFactEvidence } from '../../../functions/api/_lib/factCheckEvidence'
import { hasAcceptedFactProof, isFactReview } from '../../../shared/factCheckEvidence'

const url = 'https://example.com/page'
const text = '**Le modèle Alpha ne mesure pas trente centimètres.**\n' + 'Contexte avec espace\u00a0insécable. '.repeat(40)
const document = { id: '', url, text, fetchedAt: 100, sha256: 'a'.repeat(64) }
const input = { question: 'Quelle taille ?', response: 'Contexte original', sourceUrls: [url], model: 'claude-sonnet-5',
  claims: [{ claim: 'La négation doit rester visible', verdict: 'verified' as const, explanation: '' }] }
const reply = (evidence: unknown) => ({ model: input.model, complete: true, text: JSON.stringify({ checks: [{ index: 0, decision: 'supported', contextMatches: true, sensitive: false, reason: 'Le passage contient la négation.', evidence }] }) })
describe('server-selected evidence passages', () => {
  it.each([40, 600, 601, 609, 20_000])('presents the complete %i-character document without duplicating it', length => {
    const text = 'x'.repeat(length), passages = evidencePassages(text)
    expect(passages.map(p => p.text).join('')).toBe(text)
    expect(passages.every(p => p.text.length >= 10 && p.text.length <= 600 && p.text === text.slice(p.start, p.end))).toBe(true)
  })
  it('extracts the actual Markdown and surrounding negation without asking the model to retype it', async () => {
    const review = vi.fn(async () => reply([{ sourceId: 's1', passageId: 'p1' }]))
    const [result] = await verifyFactEvidence(input, { read: async () => document, review })
    expect(hasAcceptedFactProof(result)).toBe(true)
    expect(isFactReview(result)).toBe(true)
    expect(result!.evidence[0]!.quote).toBe(evidencePassages(text)[1]!.text)
    expect(result!.evidence[0]!.context).toContain('ne mesure pas')
    const data = JSON.parse((review.mock.calls[0] as unknown as string[])[0]!.split('DONNÉES :\n')[1]!)
    expect(data.documents[0].text).toBeUndefined()
    expect(data.documents[0].passages.map((p: { text: string }) => p.text).join('')).toBe(text)
  })
  it.each([
    [{ sourceId: 's1', passageId: 'p999' }], [{ sourceId: 's2', passageId: 'p0' }],
    [{ sourceId: 's1', passageId: 'p00' }], [{ sourceId: 's1', passageId: 0 }],
    [{ sourceId: 's1', passageId: 'p0', quote: 'Une citation inventée...' }],
    [{ sourceId: 's1', passageId: 'p0' }, { sourceId: 's1', passageId: 'p0' }],
    [{ sourceId: 's1', quote: 'Le modèle Alpha... trente centimètres.' }],
  ])('rejects unknown, ambiguous and fabricated selections: %j', async selection => {
    const [result] = await verifyFactEvidence(input, { read: async () => document, review: async () => reply(selection) })
    expect(hasAcceptedFactProof(result)).toBe(false)
  })
  it('resolves a repeated passage by its explicit position while legacy ambiguous quotes stay rejected', async () => {
    const repeated = 'Texte répété avec contexte. '.padEnd(600, 'x').repeat(2)
    const read = async () => ({ ...document, text: repeated })
    const [located] = await verifyFactEvidence(input, { read, review: async () => reply([{ sourceId: 's1', passageId: 'p1' }]) })
    expect(hasAcceptedFactProof(located)).toBe(true)
    const [legacy] = await verifyFactEvidence(input, { read, review: async () => reply([{ sourceId: 's1', quote: 'Texte répété avec contexte.' }]) })
    expect(hasAcceptedFactProof(legacy)).toBe(false)
  })
})
