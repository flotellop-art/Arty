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
  'image_vision_openai',    // lot photo canonique → GPT-5.6 Terra vision
  'private_data',           // mails/Drive/agenda → Claude (tools Google, BUG 12)
  'youtube_native',         // vidéo YouTube → Gemini (lecture native)
  'url_web_fetch',          // URL collée → Claude (web_fetch lit vraiment la page)
  'trail_tools',            // sentiers/GPX → Claude (outils OSM + export GPX)
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
  'server_model_substitution', // serveur a servi une autre famille Claude
] as const

export type ReasonCode = (typeof ALL_REASON_CODES)[number]

export interface RouteReason {
  code: ReasonCode
  params?: Record<string, string | number>
}

// Une redirection appliquée CONTRE un choix MANUEL du sélecteur. Une simple
// intention détectée dans le texte (ex. mention ChatGPT) n'est pas un choix
// manuel et ne doit jamais produire de toast. Vide la plupart du temps.
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
  /** Terra vision réellement accessible : BYOK OpenAI, ou clé serveur hors
      trial et famille gpt-full autorisée. Plus stricte que le chat OpenAI. */
  openaiVision: boolean
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
  hasImages: boolean
  hasPdf: boolean
  hasOtherFiles: boolean
  /** Toutes les pièces jointes sont des JPEG/PNG canoniques PR-A, dans les
      bornes 4096 px / 4 Mio / 16 Mio attendues par le builder Terra. */
  hasSupportedVisionImages: boolean
  euOnly: boolean
  // Une réponse précédente contient des données Google privées (mail, Drive,
  // agenda…). L'historique complet ne doit alors jamais partir vers
  // Gemini/OpenAI, même si le nouveau texte est aussi vague que « résume ça ».
  hasPrivateHistory: boolean
  // La conversation a un contexte sentiers (routage trail_tools ou outil
  // find_trails déjà appelé) : les suivis qui ne matchent aucun trigger texte
  // (« Viriville » seul, cas terrain 19 juil.) restent chez Claude, qui a les
  // outils. Optionnel : absent = false (n'affecte que la cascade auto).
  hasTrailHistory?: boolean
  selectedModel: AIModel
  availability: ProviderAvailability
  plan: PlanContext
  reflectionLevel: ReflectionLevel
  /** Construction OpenAI multimodale autorisée (flag client PR-A/B). */
  visionOpenAIEnabled: boolean
  /** Routage Auto vers Terra autorisé séparément, après les gates PR-C. */
  visionAutoRoutingEnabled: boolean
}

export interface RouteDecision {
  provider: AIProvider
  /** Contrat d'exécution explicite : le hook ne doit jamais reconstruire le
      choix multimodal depuis les flags après la décision pure. */
  usesOpenAIVision: boolean
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
