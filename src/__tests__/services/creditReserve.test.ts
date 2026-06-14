import { describe, it, expect } from 'vitest'
import { estimateReserveMicro } from '../../../functions/api/_lib/creditPricing'

// Fix fuite F-A (audit 14 juin 2026) : la réserve DOIT inclure le coût d'entrée,
// pas seulement la sortie. Sans ça, un gros prompt (200k tokens) ne réservait que
// l'output (~centimes) alors que le settle débite l'input réel (plusieurs $) →
// un user avec 1 ct de crédits pouvait obtenir plusieurs $ d'IA. Ces tests
// garantissent que la régression ne revient pas.
describe('estimateReserveMicro — inclusion de l’input (fix F-A)', () => {
  const OPUS = 'claude-opus-4-8' // $15 input / $75 output par M tokens

  it('réserve plus quand l’input est gros (input compté)', () => {
    const sansInput = estimateReserveMicro(OPUS, 1000, 0)
    const avecGrosInput = estimateReserveMicro(OPUS, 1000, 200_000)
    expect(avecGrosInput).toBeGreaterThan(sansInput)
  })

  it('un gros input à lui seul exige une réserve substantielle', () => {
    // 200k tokens d'input Opus = 200000 × $15/M = $3 provider → ×1.5 markup
    // = $4.5 ≈ 4_500_000 µ$. La réserve doit être de cet ordre, pas ~centimes.
    const r = estimateReserveMicro(OPUS, undefined, 200_000)
    expect(r).toBeGreaterThan(4_000_000)
  })

  it('rétrocompatible : sans estInputTokens, comportement output-only inchangé', () => {
    const ancien = estimateReserveMicro(OPUS, 1000)
    const explicite = estimateReserveMicro(OPUS, 1000, 0)
    expect(ancien).toBe(explicite)
  })

  it('robuste aux valeurs non finies (NaN/négatif → 0)', () => {
    expect(estimateReserveMicro(OPUS, 1000, Number.NaN)).toBe(estimateReserveMicro(OPUS, 1000, 0))
    expect(estimateReserveMicro(OPUS, 1000, -5)).toBe(estimateReserveMicro(OPUS, 1000, 0))
    expect(Number.isFinite(estimateReserveMicro(OPUS, 1000, 200_000))).toBe(true)
  })
})
