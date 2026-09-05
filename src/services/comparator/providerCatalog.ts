import { TEXT_MODELS, findTextModel, type TransportProvider, type TextModel } from '../modelCatalog'
export type ProviderId = TransportProvider
export type ModelDescriptor = TextModel
export interface ProviderDescriptor { id: ProviderId; label: string; models: TextModel[] }
export const PROVIDER_CATALOG: ProviderDescriptor[] = [
  { id: 'anthropic', label: 'Anthropic Claude', models: [] },
  { id: 'gemini', label: 'Google Gemini', models: [] },
  { id: 'mistral', label: 'Mistral', models: [] },
  { id: 'openai', label: 'OpenAI', models: [] },
].map(p => ({ ...p, id: p.id as ProviderId, models: TEXT_MODELS.filter(m => m.provider === p.id) }))
export interface PanelConfig { id: string; provider: ProviderId; modelId: string }
export const DEFAULT_PANELS: PanelConfig[] = [
  { id: 'panel-1', provider: 'anthropic', modelId: 'claude-haiku-4-5' },
  { id: 'panel-2', provider: 'gemini', modelId: 'gemini-3.5-flash' },
]
export const findModel = findTextModel
