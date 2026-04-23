import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'

// Fetcher pour GET /api/ai/quota/status. Affiché dans Paramètres Arty pour
// donner une vue live du quota journalier + coût précis par modèle
// (tokens réels capturés dans le stream côté serveur, précision ~3%).

export interface ModelUsage {
  model: string
  count: number
  /** Per-model limit (from DAILY_QUOTA_PER_MODEL env, or the global default). */
  limit: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  audioSeconds: number
  /** Coût réel calculé serveur-side depuis les tokens et les tarifs officiels. */
  costUsd: number
}

export interface QuotaStatus {
  day: string
  limit: number
  total: number
  byModel: ModelUsage[]
  totalCostUsd: number
}

export async function fetchQuotaStatus(): Promise<QuotaStatus | null> {
  const token = await getValidAccessToken()
  if (!token) return null

  try {
    const resp = await fetch(apiUrl('/api/ai/quota/status'), {
      method: 'GET',
      headers: { 'x-google-token': token },
    })
    if (!resp.ok) return null
    return (await resp.json()) as QuotaStatus
  } catch {
    return null
  }
}
