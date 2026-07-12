// ─────────────────────────────────────────────────────────────────────────────
// Disponibilité des providers pour le routage AUTO (refonte routage, étape 3).
//
// F-14 — le trou produit : historiquement, le routage auto testait la présence
// de clés BYOK client. Un abonné clé-serveur (la majorité) n'en a aucune →
// Auto = 100 % Claude, jamais Gemini/Mistral. Le « routage intelligent »
// n'existait que pour les BYOK.
//
// Désormais : disponible = clé BYOK **OU** formule éligible à la clé serveur
// ET famille autorisée ('arty-allowed-families', rempli par usePlanStatus).
// Les deux conditions sont indispensables : le plan Pro One-Time affiche les
// familles dans l'UI mais reste BYOK-only (P2.5 / planUsesServerKey côté
// serveur). La plomberie serveur existe déjà : sans clé BYOK, buildAiHeaders
// omet le header et le proxy utilise la clé serveur.
//
// Garde-fous :
//  - plan free → allowed_families = ['claude-haiku'] → gemini/mistral/openai
//    indisponibles AVANT l'envoi (aucune dépendance au 403 model_locked) ;
//  - cache absent (pas encore fetché, déconnecté, tests) → familles vides →
//    comportement BYOK-only historique ;
//  - free/trial sans crédits : familles non-Claude fermées ;
//  - Pro : familles serveur fermées, seules les clés BYOK ouvrent un provider ;
//  - claude reste le fallback historique (le proxy applique ses propres gates).
//
// ROLLBACK (si les coûts dérapent) : retourner `false` dans serverAllows —
// une ligne, ce fichier seul.
// ─────────────────────────────────────────────────────────────────────────────
import { getGeminiKey, getMistralKey, getOpenAIKey } from '../activeApiKey'
import type { ProviderAvailability } from './types'

export interface ProviderAccessContext {
  plan: string | null
  creditsCoverPremium: boolean
}

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

export function getProviderAvailability(context: ProviderAccessContext): ProviderAvailability {
  const families = readAllowedFamilies()
  // Miroir CLIENT du contrat serveur planUsesServerKey, volontairement plus
  // conservateur quand le plan est inconnu. Un free n'ouvre les familles
  // serveur que lorsque le wallet a effectivement débloqué le premium.
  const canUseServerKey =
    context.plan === 'subscription' ||
    context.plan === 'vip' ||
    ((context.plan === 'free' || context.plan === 'trial') && context.creditsCoverPremium)
  const serverAllows = (...fams: string[]) =>
    canUseServerKey && fams.some((f) => families.includes(f))
  return {
    claude: true,
    gemini: !!getGeminiKey() || serverAllows('gemini-flash', 'gemini-pro'),
    mistral: !!getMistralKey() || serverAllows('mistral-medium'),
    openai: !!getOpenAIKey() || serverAllows('gpt-mini', 'gpt-full'),
  }
}
