import { describe, it, expect } from 'vitest'
import { COMPARABLE_TEXT_MODELS, decideBillingAdvice, type BillingUsage, type ModelUsageAgg } from '../../services/billingAdvisor'
import { getPricing, hasKnownPricing } from '../../../functions/api/_lib/pricing'

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
    // clé perso = coût fournisseur brut → la clé perso gagne sans licence.
    const a = decideBillingAdvice(
      usage(
        [{ model: 'claude-opus-4-8', count: 1000, providerCostMicro: 21_700_000, creditsMicro: 32_600_000 }],
        'credits',
        20,
      ),
    )
    expect(a.recommend).toBe('byok')
    expect(a.reasonCode).toBe('recommend_byok')
    expect(a.byokEur).toBe(19.96)
    // La clé perso est bien le moins cher des trois.
    expect(a.byokEur).toBeLessThan(a.creditsEur)
    expect(a.byokEur).toBeLessThan(a.subscriptionEur)
  })

  it('recommande le BYOK gratuit même au petit abonné, sans licence fictive à amortir', () => {
    const a = decideBillingAdvice(
      usage(
        [{ model: 'claude-sonnet-4-6', count: 40, providerCostMicro: 1_000_000, creditsMicro: 1_500_000 }],
        'subscription',
        10,
      ),
    )
    expect(a.recommend).toBe('byok')
    expect(a.byokEur).toBe(0.92)
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
  it('chaque modèle comparable dispose de tarifs texte explicites côté serveur', () => {
    for (const model of COMPARABLE_TEXT_MODELS) {
      expect(hasKnownPricing(model), model).toBe(true)
      const pricing = getPricing(model)
      expect(pricing.input, model).toBeGreaterThan(0)
      expect(pricing.audioPerSec, model).toBeUndefined()
      expect(pricing.imagePerUnit, model).toBeUndefined()
      expect(pricing.charPerUnit, model).toBeUndefined()
    }
  })

  it('conserve la comparaison après un échange trivial Mistral réellement routé', () => {
    const a = decideBillingAdvice(usage([
      { model: 'claude-sonnet-5', count: 40, providerCostMicro: 1_000_000, creditsMicro: 1_500_000 },
      { model: 'mistral-small-2603', count: 1, providerCostMicro: 100, creditsMicro: 1000 },
    ], 'subscription'))
    expect(a.recommend).toBe('byok')
  })
  it('valorise 1000 crédits au prix du pack de 10 EUR, pas au change fournisseur', () => {
    const a = decideBillingAdvice(usage([
      { model: 'gpt-5.6-terra', count: 40, providerCostMicro: 5_000_000, creditsMicro: 10_000_000 },
    ], 'credits'))
    expect(a.creditsEur).toBe(10)
    expect(a.byokEur).toBe(4.6)
  })

  it.each(['flux-2-klein-9b', 'gpt-image-1', 'whisper-1', 'voxtral-mini-latest', 'gpt-5-new', 'unknown',
    'gemini-3.6-flash-lite', 'gemini-3.1-flash', 'mistral-large-4', 'mistral-small-3.5', 'claude-sonnet-4-5'])(
    'ne compare pas une modalité non couverte (%s)', (model) => {
      const a = decideBillingAdvice(usage([
        { model, count: 100, providerCostMicro: 10_000_000, creditsMicro: 20_000_000 },
      ], 'subscription'))
      expect(a.recommend).toBeNull()
      expect(a.reasonCode).toBe('not_comparable')
    },
  )

  it('reste silencieux si une seule modalité du profil est non comparable', () => {
    const a = decideBillingAdvice(usage([
      { model: 'claude-sonnet-5', count: 100, providerCostMicro: 10_000_000, creditsMicro: 20_000_000 },
      { model: 'flux-2-klein-9b', count: 1, providerCostMicro: 15_000, creditsMicro: 30_000 },
    ], 'subscription'))
    expect(a.reasonCode).toBe('not_comparable')
  })

  it.each([NaN, Infinity, -1, 1.5])('rejette un montant fournisseur invalide (%s)', (providerCostMicro) => {
    const a = decideBillingAdvice(usage([
      { model: 'claude-sonnet-5', count: 100, providerCostMicro, creditsMicro: 20_000_000 },
    ], 'subscription'))
    expect(a.reasonCode).toBe('not_comparable')
  })

  it('ne présente pas une fenêtre de sept jours comme un mois', () => {
    const u = usage([{ model: 'claude-sonnet-5', count: 100, providerCostMicro: 10_000_000, creditsMicro: 20_000_000 }], 'credits')
    expect(decideBillingAdvice({ ...u, windowDays: 7 }).reasonCode).toBe('not_comparable')
  })

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
