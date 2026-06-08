import { describe, it, expect } from 'vitest'
import { decideBillingAdvice, type BillingUsage, type ModelUsageAgg } from '../../services/billingAdvisor'

// Répartit un coût fournisseur total sur n jours distincts, sans pic.
function evenDays(n: number, totalMicro: number): Record<string, number> {
  const d: Record<string, number> = {}
  const per = totalMicro / n
  for (let i = 0; i < n; i++) d[`2026-06-${String(i + 1).padStart(2, '0')}`] = per
  return d
}

function usage(
  byModel: ModelUsageAgg[],
  currentMode: BillingUsage['currentMode'],
  activeDays = 12,
): BillingUsage {
  const providerTotal = byModel.reduce((s, m) => s + m.providerCostMicro, 0)
  return { byModel, byDayCostMicro: evenDays(activeDays, providerTotal), windowDays: 30, currentMode }
}

describe('decideBillingAdvice — honnêteté', () => {
  it('recommande BYOK à un gros utilisateur quand c\'est vraiment le moins cher (rapporte ~0 au owner)', () => {
    // 1000 messages Opus : forfait explose en packs, crédits = markup élevé,
    // clé perso = coût fournisseur brut → la clé perso gagne, payback < 4 mois.
    const a = decideBillingAdvice(
      usage(
        [{ model: 'claude-opus-4-8', count: 1000, providerCostMicro: 21_700_000, creditsMicro: 32_600_000 }],
        'credits',
        20,
      ),
    )
    expect(a.recommend).toBe('byok')
    expect(a.reasonCode).toBe('recommend_byok')
    expect(a.byokPaybackMonths).not.toBeNull()
    expect(a.byokPaybackMonths!).toBeLessThanOrEqual(4)
    // La clé perso est bien le moins cher des trois.
    expect(a.byokEur).toBeLessThan(a.creditsEur)
    expect(a.byokEur).toBeLessThan(a.subscriptionEur)
  })

  it('dit à un abonné de passer aux crédits si c\'est moins cher (contre le revenu récurrent du owner)', () => {
    const a = decideBillingAdvice(
      usage(
        [{ model: 'claude-sonnet-4-6', count: 40, providerCostMicro: 1_000_000, creditsMicro: 1_500_000 }],
        'subscription',
        10,
      ),
    )
    expect(a.recommend).toBe('credits')
    expect(a.creditsEur).toBeLessThan(a.currentEur)
    expect(a.savingsEur).toBeGreaterThan(0)
  })

  it('recommande le forfait quand il est nettement moins cher que les crédits', () => {
    // Usage régulier modéré : crédits markupés > 9,99€, peu de dépassement premium.
    const a = decideBillingAdvice(
      usage(
        [{ model: 'claude-sonnet-4-6', count: 120, providerCostMicro: 14_000_000, creditsMicro: 21_000_000 }],
        'credits',
        18,
      ),
    )
    expect(a.recommend).toBe('subscription')
    expect(a.subscriptionEur).toBeLessThan(a.creditsEur)
  })
})

describe('decideBillingAdvice — silence (anti-harcèlement)', () => {
  it('reste silencieux si l\'utilisateur est déjà sur le mode le moins cher', () => {
    const a = decideBillingAdvice(
      usage(
        [{ model: 'claude-sonnet-4-6', count: 30, providerCostMicro: 1_000_000, creditsMicro: 1_500_000 }],
        'credits',
        8,
      ),
    )
    expect(a.recommend).toBeNull()
    expect(a.reasonCode).toBe('already_optimal')
    // Les 3 chiffres restent calculés (transparence) même en silence.
    expect(a.creditsEur).toBeGreaterThan(0)
  })

  it('reste silencieux faute de données suffisantes', () => {
    const a = decideBillingAdvice(
      usage(
        [{ model: 'claude-sonnet-4-6', count: 5, providerCostMicro: 500_000, creditsMicro: 750_000 }],
        'credits',
        2,
      ),
    )
    expect(a.recommend).toBeNull()
    expect(a.reasonCode).toBe('insufficient_data')
  })

  it('reste silencieux si un seul jour domine (données non représentatives)', () => {
    const a: BillingUsage = {
      byModel: [{ model: 'claude-opus-4-8', count: 200, providerCostMicro: 20_000_000, creditsMicro: 30_000_000 }],
      // 1 jour = 90% du coût → pic non représentatif.
      byDayCostMicro: { '2026-06-01': 18_000_000, '2026-06-02': 500_000, '2026-06-03': 500_000, '2026-06-04': 500_000, '2026-06-05': 500_000 },
      windowDays: 30,
      currentMode: 'credits',
    }
    expect(decideBillingAdvice(a).reasonCode).toBe('not_representative')
  })

  it('ne conseille pas les utilisateurs free / clé perso (hors périmètre v1)', () => {
    const free = decideBillingAdvice(
      usage([{ model: 'claude-haiku-4-5-20251001', count: 100, providerCostMicro: 200_000, creditsMicro: 400_000 }], 'free', 10),
    )
    expect(free.recommend).toBeNull()
    expect(free.reasonCode).toBe('not_applicable')
  })
})
