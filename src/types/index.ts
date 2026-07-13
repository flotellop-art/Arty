export interface FileAttachment {
  id: string // UUID stable, clé dans IndexedDB
  name: string
  type: string // 'application/pdf', 'image/jpeg', etc.
  data?: string // base64 — présent en RAM avant send, absent après persistance
  size?: number // octets, après compression éventuelle
}

/** Actions rapides proposées au-dessus du composer. L'identifiant est
 * volontairement allowlisté : une conversation importée ne peut pas glisser
 * une instruction arbitraire dans un champ invisible. */
export type QuickActionId =
  | 'brief'
  | 'writeEmail'
  | 'summarizeText'
  | 'translateToEn'
  | 'summarize'
  | 'write'
  | 'translate'
  | 'explain'

export type QuickActionLocale = 'fr' | 'en'

export interface QuickActionSelection {
  id: QuickActionId
  /** Locale figée au clic : une relance garde exactement la même intention,
   * même si l'utilisateur change ensuite la langue de l'interface. */
  locale: QuickActionLocale
}

export interface ChatSendOptions {
  quickAction?: QuickActionSelection
}

export type ChatSendHandler = (
  text: string,
  files?: FileAttachment[],
  options?: ChatSendOptions,
) => void

export interface FactCheckClaim {
  claim: string
  verdict: 'verified' | 'uncertain' | 'wrong'
  explanation: string
  // Renseignés uniquement pour verdict='wrong' quand le fact-checker connaît
  // la bonne réponse. Permet d'auto-corriger la réponse affichée via
  // find/replace de originalText par correction.
  originalText?: string
  correction?: string
  // true si la substitution a RÉELLEMENT eu lieu dans le contenu du message.
  // Sans ce flag, le badge affichait « barré → corrigé » pour toute
  // correction proposée, même quand le find/replace avait raté (passage cité
  // ≠ texte réel : markdown, apostrophes…) — bug live du 11 juin 2026.
  // Optionnel : résultats persistés avant l'ajout → undefined = rétro-compat.
  applied?: boolean
}

export interface FactCheckResult {
  overallConfidence: 'high' | 'medium' | 'low'
  claims: FactCheckClaim[]
  modelLabel: string
  checkedAt: number
  // Statut structuré du cycle de vie (BUG 59 — 4 états distincts visibles).
  // Optionnel : les résultats persistés avant l'ajout de ce champ n'en ont
  // pas — l'UI dérive alors l'état des magic strings du modelLabel
  // (rétro-compat, voir deriveStatus dans FactCheckBadge).
  status?: 'pending' | 'success-empty' | 'success-with-claims' | 'failed'
  // Si au moins 1 claim a été corrigé, on stocke le texte original
  // ici pour permettre à l'UI d'afficher le diff dans le dropdown.
  // La réponse affichée (Message.content) est déjà le texte corrigé.
  originalContent?: string
  appliedCorrections?: number // count des corrections appliquées
}

export interface GmailSearchAssumption {
  kind: 'date'
  label: string
}

/**
 * Ephemeral, local-only handoff. It never contains a Gmail URL, token,
 * message id, search result or email content.
 */
export interface GmailSearchPayload {
  type: 'gmail_search'
  version: 1
  query: string
  assumptions: GmailSearchAssumption[]
  createdAt: number
  expiresAt: number
  afterOpen?: 'summarize' | 'reply'
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  files?: FileAttachment[]
  pinned?: boolean
  interrupted?: boolean
  factCheck?: FactCheckResult
  // Action rapide appliquée côté modèle, jamais rendue dans la bulle user.
  // L'ID et la locale (plutôt qu'un prompt libre) permettent de reconstruire
  // une instruction stable lors d'un retry sans canal caché arbitraire.
  quickAction?: QuickActionSelection
  // CDC visibilité modèle (C-B) — model id exact qui a produit cette réponse
  // (ex: 'claude-sonnet-5-20250929', 'mistral-medium-latest'). Posé à
  // finalize() depuis le StreamState (capturé via l'event 'arty-model-used'
  // scopé conversationId — JAMAIS via le cache global getLastModelUsed, qui
  // peut refléter un stream concurrent). Champ optionnel, pattern additif de
  // `tags` : transparent au déchiffrement, aucune migration, les messages
  // antérieurs n'en ont pas (l'UI n'affiche alors rien). ATTRIBUTION
  // uniquement — ne JAMAIS s'en servir pour router un prochain appel.
  // Exclu du partage public (décision D3), inclus dans les exports privés.
  model?: string
  // Refonte routage (étape 4) — POURQUOI ce modèle a été choisi : code machine
  // de resolveRoute (ReasonCode, ex: 'private_data', 'default_capable'),
  // traduit par l'UI via i18n `chat.routeReason.<code>`. Même pattern additif
  // que `model` : optionnel, aucune migration, messages antérieurs sans.
  reasonCode?: string
  // Sous-décision Claude (Haiku/Sonnet/Opus), conservée séparément afin de ne
  // pas perdre la raison principale du provider (privé, fichier, hybride…).
  subModelReasonCode?: string
  gmailSearch?: GmailSearchPayload
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  usedModels?: string[]  // models used in this conversation (e.g. ['mistral', 'claude'])
  euOnly?: boolean       // if true, locked to Mistral EU — no US model allowed
  // P1.5 — vrai dès qu'un outil Gmail/Drive/Calendar/Contacts a été appelé :
  // le texte des réponses peut alors contenir des données Google (résumé de
  // mail, contenu de fichier). Sert à l'avertissement renforcé avant un
  // partage public. Détecté à l'appel (les tool_use ne sont pas persistés
  // dans `content`, donc indétectable a posteriori).
  hasGoogleData?: boolean
  // P1.8 — étiquettes (tags) libres/prédéfinies pour ranger les conversations,
  // filtrables depuis la Sidebar. Champ optionnel → transparent au
  // déchiffrement (cast nu), aucune migration. Privé : exclu du partage public.
  tags?: string[]
}
