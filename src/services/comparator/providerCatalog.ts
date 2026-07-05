/**
 * Catalogue des providers + modèles du comparateur.
 *
 * IMPORTANT — réalité des clients Arty (vérifié, après la PR multi-modèles
 * Gemini/Mistral) :
 *  - anthropic + openai RESPECTENT `options.model` -> on peut comparer
 *    leurs sous-modèles.
 *  - gemini + mistral RESPECTENT aussi `options.model` (le fallback est
 *    la constante hardcodée du client si aucun model n'est passé).
 *
 * `costKey` = clé dans costTracker.MODEL_COSTS (peut différer du modelId client).
 */

export type ProviderId = 'anthropic' | 'gemini' | 'mistral' | 'openai'

export interface ModelDescriptor {
  /** ID passé au client via `options.model`. */
  modelId: string
  /** Clé dans costTracker.MODEL_COSTS pour le coût estimé. */
  costKey: string
  /** Label affiché dans le sélecteur. */
  label: string
}

export interface ProviderDescriptor {
  id: ProviderId
  label: string
  models: ModelDescriptor[]
}

export const PROVIDER_CATALOG: ProviderDescriptor[] = [
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    models: [
      { modelId: 'claude-sonnet-5', costKey: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { modelId: 'claude-haiku-4-5', costKey: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    // Modèles GA en mai 2026 (vérifiés sur ai.google.dev/gemini-api/docs/models).
    // Note : gemini-3.5-pro est ANNONCÉ pour juin 2026 mais pas encore dispo,
    // donc absent de la liste. Le reasoning-first récent est en preview only
    // (gemini-3.1-pro-preview) — exclu pour la stabilité du comparateur.
    models: [
      { modelId: 'gemini-3.5-flash', costKey: 'gemini-flash-pro', label: 'Gemini 3.5 Flash' },
      { modelId: 'gemini-3.1-flash-lite', costKey: 'gemini-flash-lite', label: 'Gemini 3.1 Flash Lite' },
      { modelId: 'gemini-2.5-pro', costKey: 'gemini-pro', label: 'Gemini 2.5 Pro' },
      { modelId: 'gemini-2.5-flash', costKey: 'gemini-flash', label: 'Gemini 2.5 Flash' },
      { modelId: 'gemini-2.5-flash-lite', costKey: 'gemini-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    // Mistral expose des aliases "-latest" stables. Small 4 (mars 2026)
    // a fusionné Magistral+Pixtral+Devstral et propose un reasoning_effort
    // configurable, multimodal natif, à $0.15/M input — bon rapport
    // qualité/prix pour le comparateur.
    models: [
      { modelId: 'mistral-large-latest', costKey: 'mistral-large', label: 'Mistral Large 3' },
      { modelId: 'mistral-medium-latest', costKey: 'mistral-medium', label: 'Mistral Medium 3.5' },
      { modelId: 'mistral-small-latest', costKey: 'mistral-small', label: 'Mistral Small 4' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [
      { modelId: 'gpt-5-mini', costKey: 'gpt-5-mini', label: 'GPT-5 mini' },
      { modelId: 'gpt-5', costKey: 'gpt-5', label: 'GPT-5' },
    ],
  },
]

export interface PanelConfig {
  /** Identifiant unique du panneau (key React + cancel ciblé). */
  id: string
  provider: ProviderId
  modelId: string
}

/** Configs par défaut à l'ouverture : Claude Sonnet + Gemini Flash. */
export const DEFAULT_PANELS: PanelConfig[] = [
  { id: 'panel-1', provider: 'anthropic', modelId: 'claude-sonnet-5' },
  { id: 'panel-2', provider: 'gemini', modelId: 'gemini-3.5-flash' },
]

/** Résout (provider, modelId) -> ModelDescriptor. */
export function findModel(provider: ProviderId, modelId: string): ModelDescriptor | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === provider)?.models.find((m) => m.modelId === modelId)
}
