import type { Conversation } from '../types'

const STORAGE_KEY = 'fp-conversations'

export function getConversations(): Conversation[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
}

export function deleteConversation(id: string): void {
  const conversations = getConversations().filter((c) => c.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
}
