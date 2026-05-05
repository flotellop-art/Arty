// Helper pour transformer un model ID brut (mistral-medium-latest,
// claude-sonnet-4-6, etc.) en label lisible affiché dans l'UI ChatTopBar
// après chaque message. Évite que l'utilisateur ait à aller dans D1 ou
// DevTools pour savoir quel modèle a vraiment répondu.
//
// Les clients AI (anthropic/mistral/gemini/openai) dispatchent un
// CustomEvent 'arty-model-used' avec le model exact dès qu'ils choisissent
// quoi appeler — ChatTopBar écoute et affiche.

export interface ModelUsedEvent {
  model: string
  provider: 'claude' | 'mistral' | 'gemini' | 'openai'
}

export function dispatchModelUsed(event: ModelUsedEvent): void {
  try {
    window.dispatchEvent(new CustomEvent<ModelUsedEvent>('arty-model-used', { detail: event }))
  } catch {
    // SSR / no window — ignore
  }
}

// Transforme un ID modèle technique en label produit affichable.
// Exemples :
//  mistral-medium-latest → "Mistral Medium 3.5"
//  claude-sonnet-4-6 → "Claude Sonnet 4.6"
//  gemini-2.5-pro → "Gemini Pro"
export function formatModelName(model: string): string {
  const m = model.toLowerCase()

  if (m.startsWith('mistral')) {
    if (m.includes('medium')) return 'Mistral Medium 3.5'
    if (m.includes('small')) return 'Mistral Small'
    if (m.includes('large')) return 'Mistral Large'
    return 'Mistral'
  }

  if (m.startsWith('claude')) {
    if (m.includes('haiku')) {
      const ver = m.match(/(\d+(?:[-.]\d+)?)/)?.[1]?.replace('-', '.')
      return ver ? `Claude Haiku ${ver}` : 'Claude Haiku'
    }
    if (m.includes('sonnet')) {
      const ver = m.match(/(\d+(?:[-.]\d+)?)/)?.[1]?.replace('-', '.')
      return ver ? `Claude Sonnet ${ver}` : 'Claude Sonnet'
    }
    if (m.includes('opus')) {
      const ver = m.match(/(\d+(?:[-.]\d+)?)/)?.[1]?.replace('-', '.')
      return ver ? `Claude Opus ${ver}` : 'Claude Opus'
    }
    return 'Claude'
  }

  if (m.startsWith('gemini')) {
    if (m.includes('flash')) return 'Gemini Flash'
    if (m.includes('pro')) return 'Gemini Pro'
    return 'Gemini'
  }

  if (m.startsWith('gpt')) {
    if (m.includes('mini')) return 'GPT-5 Mini'
    if (m.includes('5.5')) return 'GPT-5.5'
    return 'GPT-5'
  }

  return model
}
