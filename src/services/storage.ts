import type { Conversation } from '../types'
import * as scoped from './scopedStorage'

export function getConversations(): Conversation[] {
  return scoped.getJSON<Conversation[]>('conversations') || []
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
  scoped.setJSON('conversations', conversations)
}

export function deleteConversation(id: string): void {
  const conversations = getConversations().filter((c) => c.id !== id)
  scoped.setJSON('conversations', conversations)
}
