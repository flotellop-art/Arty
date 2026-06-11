export interface FileAttachment {
  id: string // UUID stable, clé dans IndexedDB
  name: string
  type: string // 'application/pdf', 'image/jpeg', etc.
  data?: string // base64 — présent en RAM avant send, absent après persistance
  size?: number // octets, après compression éventuelle
}

export interface FactCheckClaim {
  claim: string
  verdict: 'verified' | 'uncertain' | 'wrong'
  explanation: string
  // Renseignés uniquement pour verdict='wrong' quand le fact-checker connaît
  // la bonne réponse. Permet d'auto-corriger la réponse affichée via
  // find/replace de originalText par correction.
  originalText?: string
  correction?: string
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

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  files?: FileAttachment[]
  pinned?: boolean
  interrupted?: boolean
  factCheck?: FactCheckResult
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  usedModels?: string[]  // models used in this conversation (e.g. ['mistral', 'claude'])
  euOnly?: boolean       // if true, locked to Mistral EU — no US model allowed
}
