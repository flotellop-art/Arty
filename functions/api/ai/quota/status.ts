import type { Env } from '../../../env'
import { checkAllowedUser } from '../../_lib/checkAllowedUser'
import { getDailyQuotaStatus } from '../../_lib/quota'

// GET /api/ai/quota/status
//
// Retourne le snapshot du quota journalier pour l'utilisateur authentifié :
// total d'appels du jour, limite, et décomposition par modèle. Utilisé par
// le modal "Mon quota" dans Paramètres Arty.
//
// Auth : réservé aux emails whitelistés (seuls eux ont un quota serveur).
// Les utilisateurs BYOK n'ont pas de quota côté serveur — ils paient leurs
// propres appels et ne touchent pas la table `quota`.

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const email = await checkAllowedUser(request, env)
  if (!email) {
    // Pas de leak d'info : 404 uniforme (RÈGLE 6)
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const status = await getDailyQuotaStatus(env, email)

  // Estimation de coût approximative par modèle. Chiffres en USD, moyenne
  // par appel basée sur un usage typique (prompt caching actif côté Arty).
  // Marge d'erreur ~20-30% — pour une estimation live dans l'UI, pas pour
  // de la facturation. Mettre à jour quand Anthropic/OpenAI changent leurs
  // tarifs.
  const COST_PER_CALL_USD: Record<string, number> = {
    'claude-sonnet-4-6': 0.03,
    'claude-opus-4-6': 0.15,
    'claude-opus-4-7': 0.20,
    'claude-haiku-4-5-20251001': 0.005,
    'whisper-1': 0.005,
    // Fallback générique si le nom ne matche pas exactement (nouveaux models, etc.)
    claude: 0.03,
    whisper: 0.005,
  }

  const byModelWithCost = status.byModel.map((m) => {
    const rate =
      COST_PER_CALL_USD[m.model] ??
      COST_PER_CALL_USD[m.model.split('-')[0] ?? ''] ??
      0.03
    return {
      model: m.model,
      count: m.count,
      estimatedCostUsd: Number((m.count * rate).toFixed(3)),
    }
  })

  const totalCostUsd = Number(
    byModelWithCost.reduce((sum, m) => sum + m.estimatedCostUsd, 0).toFixed(3)
  )

  return Response.json({
    day: status.day,
    limit: status.limit,
    total: status.total,
    byModel: byModelWithCost,
    totalCostUsd,
  })
}
