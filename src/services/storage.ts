import type { Conversation } from '../types'
import { secureGet, secureSet, isCryptoReady } from './crypto'

const STORAGE_KEY = 'arty-conversations'

export function getConversations(): Conversation[] {
  // Synchronous read for initial render — use plain localStorage
  // Encrypted reads happen async via getConversationsSecure()
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return []
    try {
      return JSON.parse(data)
    } catch {
      return [] // Encrypted data — can't read synchronously
    }
  } catch {
    return []
  }
}

export async function getConversationsSecure(): Promise<Conversation[]> {
  if (!isCryptoReady()) return getConversations()
  const data = await secureGet<Conversation[]>(STORAGE_KEY)
  return data || []
}

export function getConversation(id: string): Conversation | null {
  const conversations = getConversations()
  return conversations.find((c) => c.id === id) ?? null
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  const conversations = await getConversationsSecure()
  const index = conversations.findIndex((c) => c.id === conversation.id)
  if (index >= 0) {
    conversations[index] = conversation
  } else {
    conversations.unshift(conversation)
  }

  if (isCryptoReady()) {
    await secureSet(STORAGE_KEY, conversations)
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
  }
}

export async function deleteConversation(id: string): Promise<void> {
  const conversations = (await getConversationsSecure()).filter((c) => c.id !== id)
  if (isCryptoReady()) {
    await secureSet(STORAGE_KEY, conversations)
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
  }
}
