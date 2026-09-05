import { getAnthropicKey, getGeminiKey, getMistralKey, getOpenAIKey } from './activeApiKey'
import { CHAT_PROVIDERS, type TransportProvider } from './modelCatalog'
import type { AIModel } from './modelSelector'

export function hasPersonalKey(provider: TransportProvider): boolean {
  const key = provider === 'anthropic' ? getAnthropicKey() : provider === 'gemini' ? getGeminiKey()
    : provider === 'mistral' ? getMistralKey() : getOpenAIKey()
  return typeof key === 'string' && !!key.trim() && key.trim() !== 'server-provided'
}

/** Règle unique des sélecteurs Home/Chat, incluant l'exception BYOK OpenAI. */
export function isProviderLockedForPlan(
  id: AIModel,
  lockedFamilies: readonly string[],
): boolean {
  if (id === 'auto') return false
  const provider = CHAT_PROVIDERS.find(p => p.id === id)!
  if (hasPersonalKey(provider.transport)) return false
  return lockedFamilies.includes(provider.family)
}
