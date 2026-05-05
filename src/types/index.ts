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
}

export interface FactCheckResult {
  overallConfidence: 'high' | 'medium' | 'low'
  claims: FactCheckClaim[]
  modelLabel: string
  checkedAt: number
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
