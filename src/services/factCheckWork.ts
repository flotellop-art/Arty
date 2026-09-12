import type { FactCheckResult } from '../types'
import type { FactCheckOutcome } from './factChecker'
import { hasAcceptedFactProof } from '../../shared/factCheckEvidence'

export interface FactCheckWork {
  deadline: number
  context: string
  recoverEvidence: boolean
  isCurrent: () => boolean
  interim?: (result: FactCheckResult) => void
}
export interface FactCheckWorkOptions {
  onProgress?: (result: FactCheckResult) => void
  isCurrent?: () => boolean
}

/** Nonoverlapping spans. Keep paragraphs together where possible and rebalance
 * a short tail so every submitted lot meets the endpoint's 80-character floor. */
export function factCheckLots(text: string): Array<{ start: number; end: number }> {
  const lots: Array<{ start: number; end: number }> = []
  const limit = Math.min(text.length, 24_000)
  let start = 0
  while (start < limit && lots.length < 4) {
    let end = Math.min(start + 6000, limit)
    if (end < limit) {
      const paragraph = text.lastIndexOf('\n\n', end - 1)
      if (paragraph > start + 4800) end = paragraph + 2
      if (limit - end < 80) end = limit - 80
    }
    lots.push({ start, end })
    start = end
  }
  return lots
}

export async function runFactCheckWork(
  response: string,
  run: (text: string, work: FactCheckWork) => Promise<FactCheckOutcome>,
  options: FactCheckWorkOptions = {},
): Promise<FactCheckOutcome> {
  const lots = factCheckLots(response)
  const finished: FactCheckResult[] = []
  let submitted = 0
  let lastFailure: FactCheckOutcome | undefined
  const work: FactCheckWork = { deadline: Date.now() + 240_000, context: response.slice(0, 24_000), recoverEvidence: true,
    isCurrent: options.isCurrent ?? (() => true) }
  const aggregate = (phase: 'checking' | 'complete' | 'stopped', interim?: FactCheckResult): FactCheckResult => {
    const results = [...finished, ...(interim ? [interim] : [])]
    // Spans do not overlap. Keep every receipt, including disagreements; never
    // select the more favorable verdict or apply the per-lot cap to the total.
    const claims = results.flatMap(r => r.claims)
    const limitations = [...new Set(results.flatMap(r => r.limitations ?? []))]
    if (submitted < response.length && !limitations.includes('response_truncated')) limitations.push('response_truncated')
    if (phase === 'stopped' && !limitations.includes('completion_unknown')) limitations.push('completion_unknown')
    const accepted = claims.filter(c => hasAcceptedFactProof(c.review)).length
    return {
      overallConfidence: results.some(r => r.overallConfidence === 'low') ? 'low' : results.some(r => r.overallConfidence === 'medium') ? 'medium' : 'high',
      modelLabel: [...new Set(results.map(r => r.modelLabel))].join(' / ') || 'Vérification en cours…',
      checkedAt: Date.now(), claims, limitations,
      coverage: { inputChars: response.length, submittedChars: submitted, claimLimitReached: results.some(r => r.coverage?.claimLimitReached === true) },
      progress: { phase, batchesDone: finished.length, batchesTotal: lots.length, identified: claims.length, accepted },
      status: phase === 'checking' ? 'pending' : limitations.length ? 'partial' : claims.some(c => c.verdict !== 'verified') ? 'success-with-claims' : 'success-empty',
    }
  }
  for (const lot of lots) {
    if (!work.isCurrent() || Date.now() >= work.deadline) break
    work.interim = result => { if (work.isCurrent()) options.onProgress?.(aggregate('checking', result)) }
    options.onProgress?.(aggregate('checking'))
    const outcome = await run(response.slice(lot.start, lot.end), work)
    if (!work.isCurrent()) return { result: null, reason: 'vérification remplacée' }
    if (!outcome.result) { lastFailure = outcome; break }
    finished.push(outcome.result)
    submitted = lot.end
    options.onProgress?.(aggregate('checking'))
  }
  if (!finished.length) return lastFailure ?? { result: null, reason: 'vérification interrompue' }
  return { result: aggregate(finished.length === lots.length && submitted === response.length ? 'complete' : 'stopped') }
}
