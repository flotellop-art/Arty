import * as scoped from './scopedStorage'

const ENABLED_KEY = 'prompt-enhancement-enabled'
const MODEL_KEY = 'prompt-enhancement-model'

export type EnhancerModel = 'haiku' | 'mistral'

export function isPromptEnhancementEnabled(): boolean {
  return scoped.getItem(ENABLED_KEY) === 'true'
}

export function setPromptEnhancementEnabled(enabled: boolean): void {
  scoped.setItem(ENABLED_KEY, enabled ? 'true' : 'false')
}

export function getEnhancerModel(): EnhancerModel {
  const stored = scoped.getItem(MODEL_KEY)
  return stored === 'mistral' ? 'mistral' : 'haiku'
}

export function setEnhancerModel(model: EnhancerModel): void {
  scoped.setItem(MODEL_KEY, model)
}
