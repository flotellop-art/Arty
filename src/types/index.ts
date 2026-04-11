export interface FileAttachment {
  name: string
  type: string // 'application/pdf', 'image/jpeg', etc.
  data: string // base64
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  files?: FileAttachment[]
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  usedModels?: string[]  // models used in this conversation (e.g. ['mistral', 'claude'])
}
