import type { Env } from '../../../env'
import { checkAllowedUserPeek } from '../../_lib/checkAllowedUser'
import { getMonthlyQuotaStatus } from '../../_lib/quota'

// GET /api/ai/quota/month
//
// Snapshot du mois courant pour l'utilisateur authentifié — somme tokens et
// coût réel à travers les jours, groupé par modèle. Alimente le badge $$
// dans la TopBar ("Coût API estimé (ce mois)").
//
// Auth : réservé aux emails whitelistés (seuls eux ont du tracking serveur).
// Les utilisateurs purement BYOK ne touchent pas la table `quota_model`.

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // Peek = pas de décrément du compteur trial. Cet endpoint est read-only,
  // afficher ses stats ne doit pas coûter un message d'essai gratuit.
  const allowed = await checkAllowedUserPeek(request, env)
  if (!allowed) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const status = await getMonthlyQuotaStatus(env, allowed.email)

  const byModel = status.byModel.map((m) => ({
    model: m.model,
    count: m.count,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheReadTokens: m.cacheReadTokens,
    cacheCreationTokens: m.cacheCreationTokens,
    audioSeconds: m.audioSeconds,
    // C11 : volume groundé forwardé (coût borne haute PAS dans costUsd).
    groundedPrompts: m.groundedPrompts,
    searchGroundedPrompts: m.searchGroundedPrompts,
    mapsGroundedPrompts: m.mapsGroundedPrompts,
    searchQueries: m.searchQueries,
    mapsQueries: m.mapsQueries,
    costUsd: Number(m.costUsd.toFixed(4)),
  }))

  const totalCostUsd = Number(
    byModel.reduce((sum, m) => sum + m.costUsd, 0).toFixed(4)
  )
  const totalInputTokens = byModel.reduce((sum, m) => sum + m.inputTokens, 0)
  const totalOutputTokens = byModel.reduce((sum, m) => sum + m.outputTokens, 0)
  const totalCalls = byModel.reduce((sum, m) => sum + m.count, 0)

  // byDay: round each day's cost to 4 decimals to keep payloads small and
  // stable. Le client ne montre que des centimes EUR de toute façon.
  const byDay: Record<string, number> = {}
  for (const [day, cost] of Object.entries(status.byDay)) {
    byDay[day] = Number(cost.toFixed(4))
  }

  return Response.json({
    month: status.month,
    byModel,
    byDay,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    totalCalls,
  })
}
