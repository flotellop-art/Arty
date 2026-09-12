import type { FactReview } from '../../../shared/factCheckEvidence'
/** Synthetic receipt for transport/persistence tests, never a real fact verdict. */
export function proof(overrides: Partial<FactReview> = {}): FactReview {
  return { target: JSON.stringify(['Une affirmation factuelle', 'verified', null, null]), status: 'supported', model: 'claude-sonnet-5', sensitive: false, contextMatches: true,
    reason: 'Preuve synthétique contrôlée.', challenge: 'not_required', evidence: [{
      sourceId: 's1', url: 'https://example.com/source', quote: 'Extrait synthétique de la source.',
      context: 'Contexte avant. Extrait synthétique de la source. Contexte après.', fetchedAt: 100, sha256: 'a'.repeat(64),
    }], ...overrides }
}
