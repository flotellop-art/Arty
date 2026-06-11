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
    if (m.includes('large')) return 'Mistral Large'
    return 'Mistral Medium 3.5'
  }

  if (m.startsWith('claude')) {
    // Étape 12 audit — extraire la version Anthropic format `-X-Y-` entre
    // tirets. Avant : regex `(\d+(?:[-.]\d+)?)` matchait juste le premier
    // groupe de chiffres et pouvait s'arrêter à `4` sur `claude-haiku-4-5-20251001`
    // selon la position. Maintenant : pattern explicite `(\d+)-(\d+)` après
    // le nom de famille, plus robuste.
    const verMatch = m.match(/-(haiku|sonnet|opus)-(\d+)-(\d+)/)
    const ver = verMatch ? `${verMatch[2]}.${verMatch[3]}` : null
    if (m.includes('haiku')) return ver ? `Claude Haiku ${ver}` : 'Claude Haiku'
    if (m.includes('sonnet')) return ver ? `Claude Sonnet ${ver}` : 'Claude Sonnet'
    if (m.includes('opus')) return ver ? `Claude Opus ${ver}` : 'Claude Opus'
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

// Clé i18n de l'explication « pourquoi ce modèle ? » pour un modelId réel.
// Extraite de ChatTopBar (PR B) où elle vivait en chaînes FR en dur :
// désormais partagée entre l'ancien header et ChatOptionsSheet, et bilingue.
// Volontairement générique — ne reflète pas les triggers exacts du routeur,
// juste le rôle global du modèle (transparence sans dupliquer aiRouter).
export function getModelExplanationKey(modelId: string): string {
  const m = modelId.toLowerCase()
  if (m.includes('mistral')) return 'chat.modelExplain.mistral'
  if (m.includes('gemini')) return 'chat.modelExplain.gemini'
  if (m.includes('haiku')) return 'chat.modelExplain.haiku'
  if (m.includes('opus')) return 'chat.modelExplain.opus'
  if (m.includes('claude')) return 'chat.modelExplain.claude'
  if (m.includes('gpt') || m.includes('openai')) return 'chat.modelExplain.openai'
  return 'chat.modelExplain.fallback'
}
