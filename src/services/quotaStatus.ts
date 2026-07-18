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
  /** Prompts groundés Gemini (Google Search) — volume, C11. Optionnel :
   * absent des réponses antérieures au déploiement C11. Le coût associé
   * n'est PAS dans costUsd (borne haute théorique $14/1000, souvent non
   * facturée par Google — palier gratuit) : ce champ sert à l'expliquer. */
  groundedPrompts?: number
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

// Snapshot mensuel (somme des jours du mois courant) — alimente le badge $$
// dans la TopBar. Même source de vérité que `fetchQuotaStatus` (table
// `quota_model`), juste agrégé par modèle sur tout le mois UTC.

export interface MonthlyModelUsage {
  model: string
  count: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  audioSeconds: number
  /** Prompts groundés Gemini sur le mois (volume, C11 — coût non inclus
   * dans costUsd). Optionnel. */
  groundedPrompts?: number
  costUsd: number
}

export interface MonthlyQuotaStatus {
  /** YYYY-MM en UTC. */
  month: string
  byModel: MonthlyModelUsage[]
  /** Map jour (YYYY-MM-DD UTC) → coût USD agrégé tous modèles ce jour-là.
   * Vide si le serveur n'a pas pu agréger (le client tombe alors sur l'historique local). */
  byDay: Record<string, number>
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCalls: number
}

export async function fetchMonthlyQuotaStatus(): Promise<MonthlyQuotaStatus | null> {
  const token = await getValidAccessToken()
  if (!token) return null

  try {
    const resp = await fetch(apiUrl('/api/ai/quota/month'), {
      method: 'GET',
      headers: { 'x-google-token': token },
    })
    if (!resp.ok) return null
    return (await resp.json()) as MonthlyQuotaStatus
  } catch {
    return null
  }
}
