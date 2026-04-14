import type { Conversation } from '../types'
import { generateId } from '../utils/generateId'
import * as storage from './storage'

/**
 * Download a conversation as a JSON file (Feature 7).
 */
export function exportConversation(conv: Conversation): void {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    conversation: conv,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `arty-${(conv.title || 'conversation').slice(0, 40).replace(/[^a-z0-9]+/gi, '-')}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Build a data: URL embedding the conversation as base64-encoded JSON.
 */
export function buildShareUrl(conv: Conversation): string {
  const payload = { version: 1, conversation: conv }
  const json = JSON.stringify(payload)
  // Handle UTF-8 safely in base64
  const b64 = btoa(unescape(encodeURIComponent(json)))
  return `data:application/json;base64,${b64}`
}

/**
 * Import a conversation from a JSON file.
 * Returns the new conversation ID (generated to avoid collisions).
 */
export async function importConversationFromFile(file: File): Promise<string> {
  const text = await file.text()
  const data = JSON.parse(text) as { conversation?: Conversation; version?: number }
  if (!data.conversation || !Array.isArray(data.conversation.messages)) {
    throw new Error('Fichier invalide: pas une conversation Arty')
  }
  const original = data.conversation
  const newConv: Conversation = {
    ...original,
    id: generateId(),
    title: original.title ? `${original.title} (importée)` : 'Conversation importée',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: original.messages.map((m) => ({
      ...m,
      id: generateId(),
    })),
  }
  storage.saveConversation(newConv)
  return newConv.id
}
