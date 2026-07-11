// ─────────────────────────────────────────────────────────────────────────────
// Types du moteur de routage unifié (refonte routage, étape 2).
//
// Principe : UNE décision structurée, calculée en un seul endroit
// (resolveRoute) sur le texte ORIGINAL de l'utilisateur, consommée partout.
// Chaque décision porte sa RAISON (code machine → i18n) et la liste des
// OVERRIDES (redirections qui contredisent ce que l'utilisateur a demandé) —
// c'est la matière première de la transparence UI (« jamais de bascule
// silencieuse », stratégie produit).
// ─────────────────────────────────────────────────────────────────────────────
import type { AIProvider, ClaudeSubModel, ClaudeThinkingDirective } from '../aiRouter'
import type { AIModel } from '../modelSelector'
import type { ReflectionLevel } from '../reflectionLevel'

// Codes machine des raisons de routage. Chaque code DOIT avoir sa clé i18n
// `chat.routeReason.<code>` en fr ET en — verrouillé par le test de parité
// (routeReason.i18n.test.ts), d'où la liste RUNTIME (pas seulement un type).
export const ALL_REASON_CODES = [
  'manual_selection',       // l'utilisateur a choisi ce modèle
  'eu_only',                // conversation verrouillée Europe → Mistral (RÈGLE 5.3)
  'files_to_claude',        // fichier attaché → Claude (lecture native PDF/image, BUG 12)
  'files_mistral_native',   // image + Mistral choisi → vision native Mistral
  'private_data',           // mails/Drive/agenda → Claude (tools Google, BUG 12)
  'youtube_native',         // vidéo YouTube → Gemini (lecture native)
  'url_web_fetch',          // URL collée → Claude (web_fetch lit vraiment la page)
  'openai_intent',          // mention explicite de ChatGPT/GPT
  'hybrid_research',        // rapport/comparatif → recherche Gemini + rédaction Claude
  'trivial_chat',           // salutation/micro-réponse → chemin rapide
  'default_capable',        // défaut : modèle capable avec recherche web (BUG 58)
  'fallback_no_provider',   // provider préféré indisponible → repli
  // Sous-modèle Claude (subModelReason) :
  'plan_locked_haiku',      // plan free/trial sans crédits → Haiku verrouillé (C-E)
  'submodel_haiku_trivial', // message trivial → Haiku (rapide, économique)
  'submodel_opus_report',   // rapport stratégique Pro → Opus
  'submodel_sonnet_default', // défaut Claude → Sonnet (BUG 58)
] as const

export type ReasonCode = (typeof ALL_REASON_CODES)[number]

export interface RouteReason {
  code: ReasonCode
  params?: Record<string, string | number>
}

// Une redirection appliquée CONTRE ce que l'utilisateur avait demandé
// (choix manuel contredit, ou intention explicite non honorée). Vide la
// plupart du temps. L'UI (étape 5) toaste ces cas au lieu de les taire.
export interface RouteOverride {
  requested: string
  applied: AIProvider
  reason: RouteReason
}

export interface ProviderAvailability {
  claude: boolean
  gemini: boolean
  mistral: boolean
  openai: boolean
}

export interface PlanContext {
  // Contenu du cache 'arty-plan-cache' ('free' | 'trial' | 'subscription' | …)
  // ou null si inconnu (pas encore fetché).
  plan: string | null
  isPro: boolean
  creditsCoverPremium: boolean
}

export interface RouteInput {
  // Texte tapé par l'utilisateur, JAMAIS enrichi (pas de résultats de
  // recherche hybride, pas de PDF inliné) — corrige les bugs « routage sur
  // texte contaminé » et « routage sur le tour précédent ».
  originalText: string
  hasFiles: boolean
  hasPdf: boolean
  euOnly: boolean
  selectedModel: AIModel
  availability: ProviderAvailability
  plan: PlanContext
  reflectionLevel: ReflectionLevel
}

export interface RouteDecision {
  provider: AIProvider
  // Renseigné quand la réponse est rédigée par Claude (provider 'claude' ou
  // 'hybrid' — en hybride c'est Claude qui écrit le texte affiché).
  subModel?: ClaudeSubModel
  thinking: ClaudeThinkingDirective
  webSearch: boolean
  needsHybrid: boolean
  isPrivateData: boolean
  reason: RouteReason
  // Raison du choix de sous-modèle Claude (ex : verrou plan free → Haiku).
  subModelReason?: RouteReason
  overrides: RouteOverride[]
}
