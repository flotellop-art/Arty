import type { Env } from '../../../env'
import { checkAllowedUser } from '../../_lib/checkAllowedUser'
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
  const email = await checkAllowedUser(request, env)
  if (!email) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const status = await getMonthlyQuotaStatus(env, email)

  const byModel = status.byModel.map((m) => ({
    model: m.model,
    count: m.count,
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
  const totalInputTokens = byModel.reduce((sum, m) => sum + m.inputTokens, 0)
  const totalOutputTokens = byModel.reduce((sum, m) => sum + m.outputTokens, 0)
  const totalCalls = byModel.reduce((sum, m) => sum + m.count, 0)

  return Response.json({
    month: status.month,
    byModel,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    totalCalls,
  })
}
