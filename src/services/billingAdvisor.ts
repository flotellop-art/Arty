// Conseiller de facturation — CERVEAU déterministe (zéro appel IA, zéro donnée
// qui sort de l'appareil). Compare les 3 modes de paiement sur l'usage RÉEL de
// l'utilisateur et recommande le moins cher POUR LUI, honnêtement.
//
// Le backend (/api/billing/usage) fournit les chiffres bruts (par modèle :
// nb d'appels, coût fournisseur, coût crédits markupé) — c'est là que vit le
// markup. Ici on ne fait que DÉCIDER, et c'est testé en CI (preuve d'honnêteté :
// un profil gros-premium doit sortir BYOK, même si ça rapporte ~0 au owner).
//
// ⚠️ LEVIERS (à régler) : prix, taux de change, seuils. Un seul objectif :
// minimiser le coût mensuel attendu de l'UTILISATEUR à usage constant. Aucune
// autre fonction (rétention/MRR/marge) n'entre ici.

export interface ModelUsageAgg {
  model: string
  count: number
  /** Coût fournisseur agrégé sur la fenêtre (USD micro). */
  providerCostMicro: number
  /** Coût crédits markupé agrégé (USD micro), calculé côté serveur. */
  creditsMicro: number
}

export interface BillingUsage {
  byModel: ModelUsageAgg[]
  /** Coût fournisseur par jour (USD micro) — pour jours actifs + détection de pic. */
  byDayCostMicro: Record<string, number>
  windowDays: number
  /** Mode de facturation actuel. On ne conseille que 'credits' et 'subscription'. */
  currentMode: 'credits' | 'subscription' | 'free' | 'other'
}

export type AdviceTarget = 'subscription' | 'byok' | 'credits'

export type AdviceReason =
  | 'recommend_subscription'
  | 'recommend_byok'
  | 'recommend_credits'
  | 'already_optimal'
  | 'insufficient_data'
  | 'not_representative'
  | 'not_applicable'

export interface BillingAdvice {
  recommend: AdviceTarget | null
  reasonCode: AdviceReason
  // Les 3 chiffres (EUR/mois) — TOUJOURS exposés pour la transparence (D4).
  creditsEur: number
  subscriptionEur: number
  byokEur: number
  byokPaybackMonths: number | null
  currentEur: number
  savingsEur: number
}

// ───────────── LEVIERS ─────────────
const USD_TO_EUR = 0.92
const SUBSCRIPTION_EUR = 9.99
const PACK_EUR = 1.99
const PACK_SIZE = 100
const BYOK_LICENSE_EUR = 39
const MIN_MESSAGES = 20
const MIN_ACTIVE_DAYS = 5
const MIN_SAVINGS_EUR = 3
const MIN_SAVINGS_RATIO = 0.25
const BYOK_MAX_PAYBACK_MONTHS = 4
const BYOK_MIN_MONTHLY_SAVING_EUR = 3
const SPIKE_DOMINANCE = 0.5
// Plafonds premium RÉELS (cf. checkPremiumCap) — Sonnet ET Opus mutualisés.
const PREMIUM_CAPS = { claude: 150, gpt5: 100, geminiPro: 80 } as const
type Bucket = keyof typeof PREMIUM_CAPS

function premiumBucket(model: string): Bucket | null {
  const m = model.toLowerCase()
  if (m.includes('claude') && (m.includes('sonnet') || m.includes('opus'))) return 'claude'
  if (m.startsWith('gpt-5') && !m.includes('mini') && !m.includes('nano')) return 'gpt5'
  if (m.includes('gemini') && m.includes('pro')) return 'geminiPro'
  return null
}

const usdMicroToEur = (micro: number): number => (micro / 1_000_000) * USD_TO_EUR
const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Décide la meilleure facturation pour l'utilisateur à partir de son usage réel.
 * Pure et déterministe — testée en CI.
 */
export function decideBillingAdvice(usage: BillingUsage): BillingAdvice {
  const messages = usage.byModel.reduce((s, m) => s + m.count, 0)
  const dayCosts = Object.values(usage.byDayCostMicro)
  const activeDays = dayCosts.filter((c) => c > 0).length

  const silent = (reasonCode: AdviceReason, numbers?: Partial<BillingAdvice>): BillingAdvice => ({
    recommend: null,
    reasonCode,
    creditsEur: 0,
    subscriptionEur: 0,
    byokEur: 0,
    byokPaybackMonths: null,
    currentEur: 0,
    savingsEur: 0,
    ...numbers,
  })

  // v1 : on ne conseille que ceux qui PAIENT déjà (crédits ou forfait). Les
  // 'free' relèvent de l'upsell (autre feature) ; les BYOK, on ne voit pas leur
  // usage (non enregistré) ; pro/vip = licence à vie, hors sujet.
  if (usage.currentMode !== 'credits' && usage.currentMode !== 'subscription') {
    return silent('not_applicable')
  }
  // Assez de données ?
  if (messages < MIN_MESSAGES || activeDays < MIN_ACTIVE_DAYS) {
    return silent('insufficient_data')
  }
  // Représentatif ? Un seul gros jour ne doit pas fabriquer une fausse reco.
  const totalDayCost = dayCosts.reduce((s, c) => s + c, 0)
  const maxDay = dayCosts.reduce((mx, c) => Math.max(mx, c), 0)
  if (totalDayCost > 0 && maxDay / totalDayCost > SPIKE_DOMINANCE) {
    return silent('not_representative')
  }

  // Les 3 modes en EUR/mois (la fenêtre 30 j ≈ 1 mois).
  const providerMicro = usage.byModel.reduce((s, m) => s + m.providerCostMicro, 0)
  const creditsMicro = usage.byModel.reduce((s, m) => s + m.creditsMicro, 0)

  const used: Record<Bucket, number> = { claude: 0, gpt5: 0, geminiPro: 0 }
  for (const m of usage.byModel) {
    const b = premiumBucket(m.model)
    if (b) used[b] += m.count
  }
  let overflow = 0
  for (const b of Object.keys(PREMIUM_CAPS) as Bucket[]) {
    overflow += Math.max(0, used[b] - PREMIUM_CAPS[b])
  }
  const packs = Math.ceil(overflow / PACK_SIZE)

  const creditsEur = round2(usdMicroToEur(creditsMicro))
  const subscriptionEur = round2(SUBSCRIPTION_EUR + packs * PACK_EUR)
  const byokEur = round2(usdMicroToEur(providerMicro))
  const currentEur = usage.currentMode === 'credits' ? creditsEur : subscriptionEur

  // Candidats = les modes DIFFÉRENTS de l'actuel.
  const candidates: { target: AdviceTarget; eur: number }[] = []
  if (usage.currentMode !== 'credits') candidates.push({ target: 'credits', eur: creditsEur })
  if (usage.currentMode !== 'subscription')
    candidates.push({ target: 'subscription', eur: subscriptionEur })

  // BYOK = licence 39€ (sunk). On le juge en POINT DE RENTABILITÉ, pas en
  // amortissement : on ne le recommande que s'il est remboursé vite ET fait
  // économiser une somme réelle chaque mois.
  const byokMonthlySaving = currentEur - byokEur
  const byokPaybackMonths =
    byokMonthlySaving > 0 ? round2(BYOK_LICENSE_EUR / byokMonthlySaving) : null
  if (
    byokPaybackMonths !== null &&
    byokPaybackMonths <= BYOK_MAX_PAYBACK_MONTHS &&
    byokMonthlySaving >= BYOK_MIN_MONTHLY_SAVING_EUR
  ) {
    candidates.push({ target: 'byok', eur: byokEur })
  }

  const best = candidates.reduce(
    (b, c) => (c.eur < b.eur ? c : b),
    { target: 'credits' as AdviceTarget, eur: Infinity },
  )
  const savingsEur = round2(currentEur - best.eur)
  const numbers = {
    creditsEur,
    subscriptionEur,
    byokEur,
    byokPaybackMonths,
    currentEur,
    savingsEur,
  }

  // On ne parle QUE si l'écart est significatif (absolu ET relatif) — sinon on
  // harcèlerait pour quelques centimes, ou on chuchoterait un vrai gain.
  const meaningful = savingsEur >= Math.max(MIN_SAVINGS_EUR, currentEur * MIN_SAVINGS_RATIO)
  if (!Number.isFinite(best.eur) || !meaningful) {
    return silent('already_optimal', numbers)
  }

  const reason: Record<AdviceTarget, AdviceReason> = {
    subscription: 'recommend_subscription',
    byok: 'recommend_byok',
    credits: 'recommend_credits',
  }
  return { recommend: best.target, reasonCode: reason[best.target], ...numbers }
}
