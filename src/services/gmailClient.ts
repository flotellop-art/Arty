import type { GmailMessage, GmailFullMessage, EmailDraft } from '../types/google'
import { getValidAccessToken } from './googleAuth'

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken()
  if (!token) throw new Error('Non connecté à Google')

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function listUnreadEmails(): Promise<GmailMessage[]> {
  const res = await authFetch('/api/gmail/messages')
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Erreur Gmail')
  return data.messages
}

export async function readEmail(messageId: string): Promise<GmailFullMessage> {
  const res = await authFetch(`/api/gmail/read?id=${messageId}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Erreur lecture email')
  return data
}

export async function sendEmail(draft: EmailDraft): Promise<{ id: string; threadId: string }> {
  const res = await authFetch('/api/gmail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Erreur envoi email')
  return data
}
