import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'

// Fetcher pour GET /api/ai/quota/status. Affiché dans Paramètres Arty pour
// donner une vue live du quota journalier + estimation de coût par modèle.

export interface ModelUsage {
  model: string
  count: number
  estimatedCostUsd: number
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
