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
    // C1 (18/07/2026, décision D-B) : les TROIS modèles 2.5 (Pro, Flash,
    // Flash-Lite) sont retirés — Google les arrête le 16 octobre 2026
    // (ai.google.dev/gemini-api/docs/deprecations) ; les laisser aurait produit
    // des 404 en prod après cette date. Gemini Pro n'a AUCUN remplaçant GA
    // (3.5 Pro bloqué en preview entreprise, 3.1 Pro = preview — exclus par
    // principe « jamais de preview au comparateur ») → réintroduire une entrée
    // Pro à la GA de gemini-3.5-pro. ⚠️ Suivi copy : le bucket « 80 Gemini
    // Pro » du pricing (P0.10) devient orphelin — à reformuler.
    models: [
      { modelId: 'gemini-3.5-flash', costKey: 'gemini-flash-pro', label: 'Gemini 3.5 Flash' },
      { modelId: 'gemini-3.1-flash-lite', costKey: 'gemini-flash-lite-3.1', label: 'Gemini 3.1 Flash Lite' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    // Les aliases "-latest" pointent vers Large 3, Medium 3.5 et Small 4.
    models: [
      { modelId: 'mistral-large-latest', costKey: 'mistral-large', label: 'Mistral Large' },
      { modelId: 'mistral-medium-latest', costKey: 'mistral-medium', label: 'Mistral Medium' },
      { modelId: 'mistral-small-latest', costKey: 'mistral-small', label: 'Mistral Small' },
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
