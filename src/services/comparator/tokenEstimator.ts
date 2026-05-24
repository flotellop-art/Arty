/**
 * Estimation tokens + coût pour le comparateur (affichage indicatif).
 *
 * Heuristique zéro-dépendance (~1 token / 3.8 caractères latins, 1/char CJK).
 * La facturation réelle reste côté serveur (functions/api/_lib/trackUsage.ts) ;
 * ici on ne fait qu'une estimation visuelle. Tarifs depuis le vrai costTracker.
 */

import { MODEL_COSTS, EUR_PER_USD } from '../costTracker'

export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[一-鿿぀-ヿ가-힯]/g) || []).length
  const rest = text.length - cjk
  return Math.ceil(rest / 3.8) + cjk
}

/**
 * Coût estimé en EUR pour (input + output) tokens d'un modèle donné.
 * Renvoie 0 (pas NaN) si le modèle est inconnu du tarifaire.
 */
export function estimateCostEur(costKey: string, inputTokens: number, outputTokens: number): number {
  const cost = MODEL_COSTS[costKey]
  if (!cost) return 0
  const usd = (inputTokens * cost.input + outputTokens * cost.output) / 1_000_000
  return usd * EUR_PER_USD
}
