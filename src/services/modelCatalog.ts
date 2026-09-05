/** Configured text models, not an availability or pricing guarantee.
 * Transport IDs, persisted preferences and billing families remain distinct.
 * Historical IDs belong to modelLabels/costTracker; never migrate messages.
 */
export type TransportProvider = 'anthropic' | 'gemini' | 'mistral' | 'openai'
export type ChatProvider = 'claude' | 'gemini' | 'mistral' | 'openai'
export const CHAT_PROVIDERS: Array<{ id: ChatProvider; transport: TransportProvider; label: string; flag: string; family: string }> = [
  { id: 'claude', transport: 'anthropic', label: 'Claude', flag: '🇺🇸', family: 'claude-haiku' },
  { id: 'mistral', transport: 'mistral', label: 'Mistral', flag: '🇪🇺', family: 'mistral-medium' },
  { id: 'gemini', transport: 'gemini', label: 'Gemini', flag: '🇺🇸', family: 'gemini-flash' },
  { id: 'openai', transport: 'openai', label: 'ChatGPT', flag: '🇺🇸', family: 'gpt-mini' },
]
export const TEXT_DEFAULTS = {
  haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-5', opus: 'claude-opus-4-8',
  geminiChat: 'gemini-3.5-flash', geminiResearch: 'gemini-3.6-flash',
  mistralSmall: 'mistral-small-2603', mistralChat: 'mistral-medium-latest',
  openaiChat: 'gpt-5.6-terra', openaiFallback: 'gpt-5',
} as const
export interface TextModel {
  provider: TransportProvider
  modelId: string
  costKey: string
  label: string
  family: string
  trial: boolean
  /** Exact known response IDs only; never infer a price from a new version. */
  responseIds?: readonly string[]
}
export const TEXT_MODELS: readonly TextModel[] = [
  { provider: 'anthropic', modelId: TEXT_DEFAULTS.sonnet, costKey: 'claude-sonnet-5', label: 'Claude Sonnet 5', family: 'claude-sonnet', trial: false },
  { provider: 'anthropic', modelId: 'claude-haiku-4-5', responseIds: [TEXT_DEFAULTS.haiku], costKey: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', family: 'claude-haiku', trial: true },
  { provider: 'anthropic', modelId: TEXT_DEFAULTS.opus, costKey: 'claude-opus-4-8', label: 'Claude Opus 4.8', family: 'claude-opus', trial: false },
  { provider: 'gemini', modelId: TEXT_DEFAULTS.geminiResearch, costKey: 'gemini-flash-3.6', label: 'Gemini 3.6 Flash', family: 'gemini-flash', trial: true },
  { provider: 'gemini', modelId: TEXT_DEFAULTS.geminiChat, costKey: 'gemini-flash-pro', label: 'Gemini 3.5 Flash', family: 'gemini-flash', trial: true },
  { provider: 'gemini', modelId: 'gemini-3.5-flash-lite', costKey: 'gemini-flash-lite-3.5', label: 'Gemini 3.5 Flash Lite', family: 'gemini-flash', trial: true },
  { provider: 'gemini', modelId: 'gemini-3.1-flash-lite', costKey: 'gemini-flash-lite-3.1', label: 'Gemini 3.1 Flash Lite', family: 'gemini-flash', trial: true },
  { provider: 'mistral', modelId: 'mistral-large-latest', costKey: 'mistral-large', label: 'Mistral Large', family: 'mistral-medium', trial: false },
  { provider: 'mistral', modelId: TEXT_DEFAULTS.mistralChat, costKey: 'mistral-medium', label: 'Mistral Medium', family: 'mistral-medium', trial: true },
  { provider: 'mistral', modelId: TEXT_DEFAULTS.mistralSmall, costKey: 'mistral-small', label: 'Mistral Small', family: 'mistral-medium', trial: false },
  { provider: 'openai', modelId: TEXT_DEFAULTS.openaiChat, costKey: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', family: 'gpt-full', trial: false },
  { provider: 'openai', modelId: 'gpt-5-mini', costKey: 'gpt-5-mini', label: 'GPT-5 Mini', family: 'gpt-mini', trial: true },
  { provider: 'openai', modelId: TEXT_DEFAULTS.openaiFallback, costKey: 'gpt-5', label: 'GPT-5', family: 'gpt-full', trial: false },
]
export function findTextModel(provider: TransportProvider, model: string): TextModel | undefined {
  return TEXT_MODELS.find(m => m.provider === provider && (m.modelId === model || m.responseIds?.includes(model)))
}
