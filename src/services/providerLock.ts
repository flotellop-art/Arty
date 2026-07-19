import { getOpenAIKey } from './activeApiKey'
import type { AIModel } from './modelSelector'

const PROVIDER_TO_FAMILY: Record<Exclude<AIModel, 'auto'>, string> = {
  claude: 'claude-haiku',
  mistral: 'mistral-medium',
  gemini: 'gemini-flash',
  openai: 'gpt-mini',
}

/** Règle unique des sélecteurs Home/Chat, incluant l'exception BYOK OpenAI. */
export function isProviderLockedForPlan(
  id: AIModel,
  lockedFamilies: readonly string[],
): boolean {
  if (id === 'auto') return false
  if (id === 'openai' && getOpenAIKey()) return false
  return lockedFamilies.includes(PROVIDER_TO_FAMILY[id])
}
