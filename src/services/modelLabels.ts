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
  /** Réflexion étendue active sur cet appel (effort Claude / gros budget
      Gemini). Permet à l'UI (StreamingIndicator) de signaler que le modèle
      réfléchit — sans ça, le niveau de réflexion est 100 % imperceptible
      à l'écran (audit fonctionnel 12 juin, reco #2). */
  reflecting?: boolean
  /** Appel d'arrière-plan (brief proactif, résumé de conversation,
      comparateur) : les surfaces de conversation (ChatTopBar,
      StreamingIndicator) DOIVENT l'ignorer — sans ce flag, un brief Haiku 🇺🇸
      déclenché au retour foreground écrasait le badge d'une conversation
      Mistral 🇪🇺 (audit visibilité modèle, F-4). */
  background?: boolean
  /** Conversation d'origine de l'appel (targetId). Permet à ChatTopBar de
      rejeter les events d'un stream concurrent d'une AUTRE conversation
      (MAX_CONCURRENT_STREAMS = 3). Absent = appel legacy → accepté. */
  conversationId?: string
  /** true = le model id vient de la RÉPONSE du provider (message_start.model
      Anthropic, `model` des chunks Mistral/OpenAI), pas de la sélection
      client pré-envoi. Un event confirmed corrige un éventuel dispatch
      optimiste antérieur (ex: substitution serveur trial, fallback 5.5→5). */
  confirmed?: boolean
}

/**
 * Filtre commun des surfaces de conversation (ChatTopBar, StreamingIndicator).
 * Rejette les appels d'arrière-plan, et les events d'une autre conversation
 * quand l'event ET la surface connaissent leur conversation. Les events sans
 * conversationId (appelants legacy) restent acceptés — rétro-compat.
 */
export function shouldAcceptModelEvent(
  event: ModelUsedEvent | undefined | null,
  activeConversationId?: string
): boolean {
  if (!event?.model) return false
  if (event.background) return false
  if (event.conversationId && activeConversationId && event.conversationId !== activeConversationId) {
    return false
  }
  return true
}

// Cache module du dernier appel : l'indicateur de streaming peut se monter
// juste APRÈS le dispatch (course au premier render) — il s'initialise sur
// ce cache puis suit les events.
let lastModelUsed: ModelUsedEvent | null = null

export function getLastModelUsed(): ModelUsedEvent | null {
  return lastModelUsed
}

export function dispatchModelUsed(event: ModelUsedEvent): void {
  // Les appels d'arrière-plan n'écrasent pas le cache : il sert à initialiser
  // les surfaces de CONVERSATION au mount (course au premier render).
  if (!event.background) lastModelUsed = event
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
    // Étape 12 audit + migration Sonnet 5 — extraire la version Anthropic
    // après le nom de famille. Gère les versions à UN chiffre (`claude-sonnet-5`
    // → "5") comme à deux (`claude-sonnet-4-6` → "4.6"). Le lookahead `(?!\d)`
    // empêche un run de 8 chiffres (date YYYYMMDD, ex. `claude-haiku-4-5-20251001`)
    // d'être capté comme version mineure — sans lui, un futur `claude-sonnet-5-20260815`
    // afficherait "5.20260815".
    const verMatch = m.match(/-(haiku|sonnet|opus)-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?/)
    const ver = verMatch ? (verMatch[3] ? `${verMatch[2]}.${verMatch[3]}` : verMatch[2]) : null
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

// Libellé « capacité » d'un modèle — niveau par DÉFAUT du footer par message
// (CDC C-C : capacité en clair pour le grand public, nom technique précis au
// tap). Formulation capacité/rôle, JAMAIS un jugement de coût (« réponse
// rapide », pas « version économique » — anti-objectif cadrage anxiogène).
export function getModelCapacityKey(model: string): string {
  const m = model.toLowerCase()
  if (m.startsWith('mistral') || m.startsWith('ministral') || m.startsWith('voxtral')) {
    return 'chat.modelFooter.capacity.mistral'
  }
  if (m.startsWith('gemini')) return 'chat.modelFooter.capacity.gemini'
  if (m.includes('haiku')) return 'chat.modelFooter.capacity.haiku'
  if (m.startsWith('claude')) return 'chat.modelFooter.capacity.claude'
  if (m.startsWith('gpt') || m.includes('openai')) return 'chat.modelFooter.capacity.openai'
  return 'chat.modelFooter.capacity.fallback'
}

// Région d'hébergement du modèle qui traite la requête, affichée à
// l'utilisateur (« où part ma donnée ? »). Mapping STATIQUE de présentation —
// JAMAIS dérivé d'une variable d'env, d'une URL de proxy ou d'un endpoint
// serveur (RÈGLE 6 : aucune fuite d'infra). Mistral (chat + Voxtral) =
// France/UE ; tout le reste (Claude, Gemini, GPT) = serveurs US. Défaut = US :
// on ne revendique JAMAIS « UE » par erreur, ce qui casserait la promesse.
export function getModelRegion(model: string): { flag: string; key: string } {
  return model.toLowerCase().startsWith('mistral')
    ? { flag: '🇪🇺', key: 'chat.region.eu' }
    : { flag: '🇺🇸', key: 'chat.region.us' }
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
