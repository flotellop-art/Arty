import * as scoped from './scopedStorage'
import type { AIModel } from './modelSelector'
import type { RouteDecision, RouteInput } from './router/types'

// These variants retain their provider's existing family/access checks.
// This preference never changes the provider selected by the routing guards.
export const CHAT_MODEL_VARIANTS = {
  gemini: [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  ],
  openai: [
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  ],
} as const
export type VariantProvider = keyof typeof CHAT_MODEL_VARIANTS
export const CHAT_MODEL_PREFERENCE_EVENT = 'arty-chat-model-preference-changed'

export function hasChatModelVariants(provider: AIModel): provider is VariantProvider {
  return provider === 'gemini' || provider === 'openai'
}

export function getChatModelPreference(provider: VariantProvider): string | undefined {
  const saved = scoped.getItem(`chat-model-variant-${provider}`)
  return CHAT_MODEL_VARIANTS[provider].some(model => model.id === saved) ? saved! : undefined
}

export function setChatModelPreference(provider: VariantProvider, model: string): void {
  if (model && !CHAT_MODEL_VARIANTS[provider].some(candidate => candidate.id === model)) return
  if (model) scoped.setItem(`chat-model-variant-${provider}`, model)
  else scoped.removeItem(`chat-model-variant-${provider}`)
  window.dispatchEvent(new Event(CHAT_MODEL_PREFERENCE_EVENT))
}

/** Snapshot after resolveRoute, before asynchronous preparation. Never applies
 * to Auto/hybrid, EU, attachments or the Terra vision contract. */
export function resolveChatModelPreference(input: RouteInput, route: RouteDecision): string | undefined {
  if (!hasChatModelVariants(input.selectedModel) || route.provider !== input.selectedModel
    || route.reason.code !== 'manual_selection' || !input.availability[input.selectedModel]
    || input.euOnly
    || input.hasFiles || input.hasImages || input.hasPdf || input.hasOtherFiles
    || input.hasOfficeHistory || input.hasProjectContext
    || route.usesOpenAIVision || route.needsHybrid) return undefined
  return getChatModelPreference(input.selectedModel)
}
