import type { Conversation } from '../types'

export type ResidencyConversation = Pick<Conversation, 'euOnly' | 'usedModels'>

export function hasTouchedMistral(conv: ResidencyConversation | null | undefined): boolean {
  return !!conv?.usedModels?.some((model) => model.toLowerCase().includes('mistral'))
}

/**
 * Once a conversation is EU-only or has ever used Mistral, all later LLM
 * post-processing must stay on the EU path. This prevents mixed-model
 * conversations from sending Mistral/EU content to Claude/Gemini/OpenAI later
 * via summaries, fact-checks, or auto-routing.
 */
export function isEuLockedConversation(conv: ResidencyConversation | null | undefined): boolean {
  return !!conv?.euOnly || hasTouchedMistral(conv)
}

export function markMistralUsed(conv: Conversation): void {
  const usedModels = conv.usedModels || []
  if (!usedModels.includes('mistral')) usedModels.push('mistral')
  conv.usedModels = usedModels
  conv.euOnly = true
}
