import type { Env } from '../../../env'
import { checkAllowedUser } from '../../_lib/checkAllowedUser'
import { getDailyQuotaStatus } from '../../_lib/quota'

// GET /api/ai/quota/status
//
// Retourne le snapshot du quota journalier pour l'utilisateur authentifié :
// total d'appels du jour, limite globale, et décomposition par modèle avec
// tokens réels et coût précis (calculé serveur-side depuis les usages
// capturés dans les streams — marge ~3% vs facturation officielle).
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

  const byModel = status.byModel.map((m) => ({
    model: m.model,
    count: m.count,
    limit: m.limit,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheReadTokens: m.cacheReadTokens,
    cacheCreationTokens: m.cacheCreationTokens,
    audioSeconds: m.audioSeconds,
    costUsd: Number(m.costUsd.toFixed(4)),
  }))

  const totalCostUsd = Number(
    byModel.reduce((sum, m) => sum + m.costUsd, 0).toFixed(4)
  )

  return Response.json({
    day: status.day,
    limit: status.limit,
    total: status.total,
    byModel,
    totalCostUsd,
  })
}
