// Helper pour transformer un model ID brut (mistral-medium-latest,
// claude-sonnet-4-6, etc.) en label lisible affiché dans l'UI ChatTopBar
// après chaque message. Évite que l'utilisateur ait à aller dans D1 ou
// DevTools pour savoir quel modèle a vraiment répondu.
//
// Les clients AI (anthropic/mistral/gemini/openai) dispatchent un
// CustomEvent 'arty-model-used' avec le model exact dès qu'ils choisissent
// quoi appeler — ChatTopBar écoute et affiche.

import { ALL_REASON_CODES, type RouteReason } from './router/types'

export interface ModelUsedEvent {
  model: string
  provider: 'claude' | 'mistral' | 'gemini' | 'openai'
  /** Raison du routage (refonte routage, étape 4) — code machine résolu par
      resolveRoute (router/types.ts), traduit par l'UI via i18n
      `chat.routeReason.<code>`. Absent sur les appels sans décision
      (comparateur, brief, compresseur, appelants legacy) → l'UI retombe sur
      l'explication générique (getModelExplanationKey). */
  reason?: RouteReason
  /** Raison du sous-modèle Claude effectivement choisi (Haiku/Sonnet/Opus).
      Distincte de `reason`, qui explique le choix du provider. */
  subModelReason?: RouteReason
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

export interface ModelAttributionMessage {
  role: 'user' | 'assistant'
  model?: string
  reasonCode?: string
  subModelReasonCode?: string
}

/**
 * Attribution persistée de la dernière réponse d'une conversation.
 * On regarde la dernière réponse assistant (pas une réponse plus ancienne) :
 * si elle précède la collecte d'attribution, le header doit rester neutre au
 * lieu d'afficher un modèle obsolète.
 */
export function getLastModelAttribution(
  messages: readonly ModelAttributionMessage[]
): { model: string; reasonCode?: string; subModelReasonCode?: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== 'assistant') continue
    if (!message.model) return null
    return {
      model: message.model,
      ...(message.reasonCode ? { reasonCode: message.reasonCode } : {}),
      ...(message.subModelReasonCode ? { subModelReasonCode: message.subModelReasonCode } : {}),
    }
  }
  return null
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
  // ⚠️ INVARIANT (revue C-B) : tout dispatch NON-background doit porter un
  // `conversationId`. Aujourd'hui vrai partout (chat réel = targetId ; brief/
  // résumé/comparateur = background:true). Un futur appelant non-background
  // SANS conversationId réactiverait le chemin legacy : accepté par toutes
  // les surfaces (badge/indicateur d'une autre conversation pollués) et
  // invisible pour la capture Message.model de useStreaming.
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
//  mistral-medium-latest → "Mistral Medium"
//  claude-sonnet-4-6 → "Claude Sonnet 4.6"
//  gemini-2.5-pro → "Gemini 2.5 Pro"
//
// ANTI-DRIFT (C-D, audit F-12) : un label qui affirme une version que l'id ne
// porte pas MENT dès que le modèle sous-jacent bouge (« Mistral Medium 3.5 »
// figé sur l'alias mouvant -latest ; « Gemini Flash » qui fondait 2.5 et 3.5
// alors que la bascule éco P1.4 les distingue). Règle : la version vient de
// l'ID ou n'est pas affichée. Le test de parité (modelLabels.test.ts) verrouille
// chaque ID routable.
export function formatModelName(model: string): string {
  const m = model.toLowerCase()

  if (m.startsWith('mistral') || m.startsWith('ministral')) {
    // PAS de numéro de version : les ids Mistral sont des alias mouvants
    // (-latest) ou des dates (-2505) — impossible d'en dériver une version
    // marketing fiable. Famille seule.
    if (m.includes('medium')) return 'Mistral Medium'
    if (m.includes('large')) return 'Mistral Large'
    if (m.includes('small') || m.startsWith('ministral')) return 'Mistral Small'
    return 'Mistral'
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
    // Version extraite de l'ID (gemini-2.5-flash → « Gemini 2.5 Flash ») :
    // 2.5 et 3.5 ne sont PAS le même modèle — les fondre cachait la bascule
    // éco P1.4 à l'utilisateur.
    const ver = m.match(/gemini-(\d+(?:\.\d+)?)/)?.[1]
    const family = m.includes('flash-lite')
      ? 'Flash Lite'
      : m.includes('flash')
        ? 'Flash'
        : m.includes('pro')
          ? 'Pro'
          : ''
    return ['Gemini', ver, family].filter(Boolean).join(' ')
  }

  if (m.startsWith('gpt')) {
    // Version dérivée de l'ID (gpt-5.5 → « GPT-5.5 », gpt-5-mini →
    // « GPT-5 Mini », gpt-4o-mini → « GPT-4o Mini ») — plus de mapping figé.
    const ver = m.match(/^gpt-?(\d+(?:\.\d+)?o?)/)?.[1]
    const mini = m.includes('mini') ? ' Mini' : ''
    return ver ? `GPT-${ver}${mini}` : `GPT${mini}`
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
  // ministral/voxtral = Mistral SAS (France) aussi — aligné sur
  // getModelCapacityKey pour éviter un drapeau 🇺🇸 sous un libellé « Europe »
  // si un modèle Mistral léger devient un jour un modèle de chat (revue C-B).
  const m = model.toLowerCase()
  return m.startsWith('mistral') || m.startsWith('ministral') || m.startsWith('voxtral')
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

// Refonte routage (étape 5) — clé i18n de l'explication « pourquoi ce
// modèle ? » : la raison EXACTE du routage (chat.routeReason.<code>) quand un
// ReasonCode valide est disponible, sinon le fallback générique par modèle
// ci-dessus (messages de l'historique, appels sans décision, code inconnu
// d'une vieille version). La validation contre ALL_REASON_CODES garantit de
// ne jamais afficher une clé i18n brute — chaque code de la liste a ses
// traductions fr/en (test de parité routeReason.i18n.test.ts).
export function getRouteExplanationKey(modelId: string, reasonCode?: string | null): string {
  if (reasonCode && (ALL_REASON_CODES as readonly string[]).includes(reasonCode)) {
    return `chat.routeReason.${reasonCode}`
  }
  return getModelExplanationKey(modelId)
}
