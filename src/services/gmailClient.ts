import type { GmailMessage, GmailFullMessage, EmailDraft } from '../types/google'
import { getValidAccessToken } from './googleAuth'
import { safeJson } from '../utils/safeJson'
import { apiUrl } from './apiBase'

async function gmailFetch(body: Record<string, unknown>): Promise<Response> {
  const token = await getValidAccessToken()
  if (!token) throw new Error('Non connecté à Google')

  return fetch(apiUrl('/api/gmail/action'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

export async function listUnreadEmails(): Promise<GmailMessage[]> {
  const res = await gmailFetch({ type: 'list' })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur Gmail')
  return data.messages
}

export async function readEmail(messageId: string): Promise<GmailFullMessage> {
  const res = await gmailFetch({ type: 'read', id: messageId })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur lecture email')
  return data
}

export async function sendEmail(draft: EmailDraft): Promise<{ id: string; threadId: string }> {
  const res = await gmailFetch({ type: 'send', ...draft })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur envoi email')
  return data
}
