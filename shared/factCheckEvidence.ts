/** Bounded, inert receipts shared by the server, chat, archives and sync. */
export interface FactEvidence {
  sourceId: string
  url: string
  quote: string
  context: string
  fetchedAt: number
  sha256: string
}
export interface FactReview {
  target: string
  status: 'supported' | 'unsupported' | 'contested' | 'unavailable' | 'not_checked'
  model: string
  sensitive: boolean
  contextMatches: boolean
  reason: string
  challenge: 'not_required' | 'accepted' | 'rejected' | 'unavailable'
  challengerModel?: string
  evidence: FactEvidence[]
}
export function isFactReview(v: unknown): v is FactReview {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const r = v as Record<string, unknown>
  const keys = ['target', 'status', 'model', 'sensitive', 'contextMatches', 'reason', 'challenge', 'challengerModel', 'evidence']
  if (Object.keys(r).some(k => !keys.includes(k))) return false
  const text = (s: unknown, max: number) => typeof s === 'string' && s.length <= max
  return typeof r.status === 'string' && ['supported', 'unsupported', 'contested', 'unavailable', 'not_checked'].includes(r.status) &&
    text(r.target, 10000) && text(r.model, 100) && text(r.reason, 1000) && typeof r.sensitive === 'boolean' && typeof r.contextMatches === 'boolean' &&
    typeof r.challenge === 'string' && ['not_required', 'accepted', 'rejected', 'unavailable'].includes(r.challenge) &&
    (r.challengerModel === undefined || text(r.challengerModel, 100)) && Array.isArray(r.evidence) && r.evidence.length <= 2 &&
    r.evidence.every((e: unknown) => {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return false
      const p = e as FactEvidence
      if (Object.keys(p).some(k => !['sourceId', 'url', 'quote', 'context', 'fetchedAt', 'sha256'].includes(k))) return false
      let publicLink = false
      try { const url = new URL(p.url); publicLink = /^https?:$/.test(url.protocol) && !url.username && !url.password } catch { /* invalid */ }
      return text(p.sourceId, 20) && text(p.url, 2048) && publicLink && text(p.quote, 600) && p.quote.length >= 10 &&
        text(p.context, 2400) && p.context.includes(p.quote) && Number.isSafeInteger(p.fetchedAt) && p.fetchedAt >= 0 &&
        typeof p.sha256 === 'string' && /^[a-f0-9]{64}$/.test(p.sha256)
    })
}
/** Identical normalization on both ends. Never review a truncated replacement. */
export function factCorrection(c: { verdict: string; originalText?: unknown; correction?: unknown }): { originalText?: string; correction?: string } {
  if (c.verdict !== 'wrong' || typeof c.originalText !== 'string' || typeof c.correction !== 'string') return {}
  const originalText = c.originalText.trim(), correction = c.correction.trim()
  return originalText.length > 0 && originalText.length < 500 && correction.length > 0 && correction.length < 500
    ? { originalText, correction } : {}
}
export function factProofTarget(c: { claim: string; verdict: string; originalText?: unknown; correction?: unknown }): string {
  const replacement = factCorrection(c)
  return JSON.stringify([c.claim.trim().slice(0, 500), c.verdict, replacement.originalText ?? null, replacement.correction ?? null])
}
export function hasAcceptedFactProof(review: FactReview | undefined): boolean {
  return !!review && review.status === 'supported' && review.contextMatches && review.evidence.length > 0 &&
    (!review.sensitive || (review.challenge === 'accepted' && !!review.challengerModel && review.challengerModel !== review.model))
}
