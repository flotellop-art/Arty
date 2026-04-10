import * as scoped from './scopedStorage'

export type AIModel = 'auto' | 'claude' | 'mistral' | 'gemini'

export const MODEL_OPTIONS: Array<{ id: AIModel; label: string; flag: string }> = [
  { id: 'auto', label: 'Auto', flag: '🔄' },
  { id: 'claude', label: 'Claude', flag: '🇺🇸' },
  { id: 'mistral', label: 'Mistral', flag: '🇪🇺' },
  { id: 'gemini', label: 'Gemini', flag: '🇺🇸' },
]

export function getSelectedModel(): AIModel {
  const saved = scoped.getItem('ai-model')
  if (saved && MODEL_OPTIONS.some(o => o.id === saved)) return saved as AIModel
  return 'auto'
}

export function setSelectedModel(model: AIModel): void {
  scoped.setItem('ai-model', model)
}
