import type { Conversation } from '../types'
import { secureSet, isCryptoReady } from './crypto'

const STORAGE_KEY = 'arty-conversations'

export function getConversations(): Conversation[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return []
    return JSON.parse(data)
  } catch {
    return []
  }
}

export function getConversation(id: string): Conversation | null {
  const conversations = getConversations()
  return conversations.find((c) => c.id === id) ?? null
}

export function saveConversation(conversation: Conversation): void {
  const conversations = getConversations()
  const index = conversations.findIndex((c) => c.id === conversation.id)
  if (index >= 0) {
    conversations[index] = conversation
  } else {
    conversations.unshift(conversation)
  }

  // Always save synchronously to localStorage for immediate UI updates
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))

  // Also encrypt in background if crypto is ready
  if (isCryptoReady()) {
    secureSet(STORAGE_KEY, conversations).catch(() => {})
  }
}

export function deleteConversation(id: string): void {
  const conversations = getConversations().filter((c) => c.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))

  if (isCryptoReady()) {
    secureSet(STORAGE_KEY, conversations).catch(() => {})
  }
}
