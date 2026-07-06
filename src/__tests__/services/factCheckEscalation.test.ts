// Tests PR C-F (CDC visibilité modèle, décision D5) — escalade Haiku→Sonnet
// du fact-checker : la passe rapide Haiku est finale quand tout est vérifié,
// l'escalade (Sonnet + web_search, plus chère) ne part que sur du risque.
import { describe, expect, it } from 'vitest'
import { shouldEscalateToSonnet } from '../../services/factChecker'
import type { FactCheckResult, FactCheckClaim } from '../../types'

const result = (claims: FactCheckClaim[]): FactCheckResult => ({
  overallConfidence: 'medium',
  claims,
  modelLabel: 'Haiku 4.5',
  checkedAt: 1750000000000,
})

const claim = (verdict: FactCheckClaim['verdict']): FactCheckClaim => ({
  claim: 'La tour Eiffel mesure 330 m',
  verdict,
  explanation: 'test',
})

describe('shouldEscalateToSonnet — critère d\'escalade (D5)', () => {
  it('aucun claim → pas d\'escalade (réponse sans claims risqués)', () => {
    expect(shouldEscalateToSonnet(result([]))).toBe(false)
  })

  it('tous verified → pas d\'escalade (Haiku suffit, inutile de payer Sonnet)', () => {
    expect(shouldEscalateToSonnet(result([claim('verified'), claim('verified')]))).toBe(false)
  })

  it('un uncertain → escalade (Sonnet + web_search tranche)', () => {
    expect(shouldEscalateToSonnet(result([claim('verified'), claim('uncertain')]))).toBe(true)
  })

  it('un wrong → escalade (la correction doit être vérifiée en ligne)', () => {
    expect(shouldEscalateToSonnet(result([claim('wrong')]))).toBe(true)
  })
})
