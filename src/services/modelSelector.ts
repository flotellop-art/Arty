import * as scoped from './scopedStorage'

export type AIModel = 'auto' | 'claude' | 'mistral' | 'gemini' | 'openai'

export const MODEL_OPTIONS: Array<{ id: AIModel; label: string; flag: string }> = [
  { id: 'auto', label: 'Auto', flag: '🔄' },
  { id: 'claude', label: 'Claude', flag: '🇺🇸' },
  { id: 'mistral', label: 'Mistral', flag: '🇪🇺' },
  { id: 'gemini', label: 'Gemini', flag: '🇺🇸' },
  { id: 'openai', label: 'ChatGPT', flag: '🇺🇸' },
]

// Regex to detect explicit mentions of ChatGPT / GPT / OpenAI in a user message.
const OPENAI_INTENT = /\b(chat\s*gpt|chatgpt|utilise\s+gpt|avec\s+gpt|via\s+openai|openai|gpt-?4|gpt-?4o|gpt-?3\.5)\b/i

/**
 * Detect if the user explicitly asked for OpenAI/ChatGPT in their message.
 */
export function detectOpenAIIntent(message: string): boolean {
  return OPENAI_INTENT.test(message)
}

export function getSelectedModel(): AIModel {
  const saved = scoped.getItem('ai-model')
  if (saved && MODEL_OPTIONS.some(o => o.id === saved)) return saved as AIModel
  return 'auto'
}

export function setSelectedModel(model: AIModel): void {
  scoped.setItem('ai-model', model)
}

// Niveau d'effort (curseur Rapide/Équilibré/Puissant). N'a un effet RÉEL que sur
// Claude (seul provider multi-tiers : Haiku/Sonnet/Opus) — Gemini/Mistral/GPT
// n'ont qu'un modèle. 'auto' = le routeur choisit (défaut, comportement actuel).
// 'balanced'/'powerful' sont des modèles premium → gating crédits côté UI.
export type ModelLevel = 'auto' | 'fast' | 'balanced' | 'powerful'

export function getSelectedLevel(): ModelLevel {
  const saved = scoped.getItem('ai-level')
  if (saved === 'fast' || saved === 'balanced' || saved === 'powerful') return saved
  return 'auto'
}

export function setSelectedLevel(level: ModelLevel): void {
  scoped.setItem('ai-level', level)
}
