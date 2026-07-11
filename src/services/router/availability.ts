// ─────────────────────────────────────────────────────────────────────────────
// Disponibilité des providers pour le routage AUTO (refonte routage, étape 2).
//
// Étape 2 (iso-comportement) : dérivée des clés BYOK client, comme le faisait
// detectProvider historiquement. Claude est toujours disponible (clé serveur
// via le proxy, sentinelle 'server-provided').
//
// Étape 3 (F-14) basculera ce fichier : disponible = clé BYOK OU plan dont
// les familles serveur autorisent le provider — c'est ce qui rendra le
// routage intelligent effectif pour les abonnés clé-serveur. Rollback = ce
// fichier seul.
// ─────────────────────────────────────────────────────────────────────────────
import { getGeminiKey, getMistralKey, getOpenAIKey } from '../activeApiKey'
import type { ProviderAvailability } from './types'

export function getProviderAvailability(): ProviderAvailability {
  return {
    claude: true,
    gemini: !!getGeminiKey(),
    mistral: !!getMistralKey(),
    openai: !!getOpenAIKey(),
  }
}
