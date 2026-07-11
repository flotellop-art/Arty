// ─────────────────────────────────────────────────────────────────────────────
// Disponibilité des providers pour le routage AUTO (refonte routage, étape 3).
//
// F-14 — le trou produit : historiquement, le routage auto testait la présence
// de clés BYOK client. Un abonné clé-serveur (la majorité) n'en a aucune →
// Auto = 100 % Claude, jamais Gemini/Mistral. Le « routage intelligent »
// n'existait que pour les BYOK.
//
// Désormais : disponible = clé BYOK **OU** plan dont les familles serveur
// autorisent le provider ('arty-allowed-families', rempli par usePlanStatus
// depuis /api/subscription/status — même cycle de vie que 'arty-plan-cache',
// purgé au logout/switch). La plomberie serveur existe déjà : sans clé BYOK,
// buildAiHeaders omet le header et le proxy utilise la clé serveur.
//
// Garde-fous :
//  - plan free → allowed_families = ['claude-haiku'] → gemini/mistral/openai
//    indisponibles AVANT l'envoi (aucune dépendance au 403 model_locked) ;
//  - cache absent (pas encore fetché, déconnecté, tests) → familles vides →
//    comportement BYOK-only historique ;
//  - claude toujours disponible (clé serveur via proxy, verrou Haiku côté
//    sous-modèle pour les plans free/trial).
//
// ROLLBACK (si les coûts dérapent) : retourner `false` dans serverAllows —
// une ligne, ce fichier seul.
// ─────────────────────────────────────────────────────────────────────────────
import { getGeminiKey, getMistralKey, getOpenAIKey } from '../activeApiKey'
import type { ProviderAvailability } from './types'

function readAllowedFamilies(): string[] {
  try {
    const raw = localStorage.getItem('arty-allowed-families')
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((f): f is string => typeof f === 'string')
  } catch {
    return []
  }
}

export function getProviderAvailability(): ProviderAvailability {
  const families = readAllowedFamilies()
  const serverAllows = (...fams: string[]) => fams.some((f) => families.includes(f))
  return {
    claude: true,
    gemini: !!getGeminiKey() || serverAllows('gemini-flash', 'gemini-pro'),
    mistral: !!getMistralKey() || serverAllows('mistral-medium'),
    openai: !!getOpenAIKey() || serverAllows('gpt-mini', 'gpt-full'),
  }
}
