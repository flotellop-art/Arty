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
  // BUG 54 — toute écriture dans un store partagé entre plusieurs vues doit
  // notifier via CustomEvent, sinon les vues non remontées affichent une
  // valeur périmée (désynchro TopBar Home ↔ ChatTopBar). try/catch pour
  // tolérer les contextes sans window (tests, SSR).
  try {
    window.dispatchEvent(new CustomEvent<AIModel>('model-changed', { detail: model }))
  } catch {
    // contexte sans window — l'écriture storage reste effective
  }
}
