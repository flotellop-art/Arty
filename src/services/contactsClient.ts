import type { Contact, ContactDraft } from '../types/google'
import { getValidAccessToken } from './googleAuth'
import { safeJson } from '../utils/safeJson'
import { apiUrl } from './apiBase'

async function contactsFetch(body: Record<string, unknown>): Promise<Response> {
  const token = await getValidAccessToken()
  if (!token) throw new Error('Non connecté à Google')

  return fetch(apiUrl('/api/contacts/action'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

export async function searchContacts(query: string): Promise<Contact[]> {
  const res = await contactsFetch({ type: 'search', query })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur contacts')
  return (data.contacts || []) as Contact[]
}

export async function createContact(
  draft: ContactDraft
): Promise<{ success: boolean; resourceName?: string }> {
  const res = await contactsFetch({ type: 'create', ...draft })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur création contact')
  return data
}

export async function updateContact(
  resourceName: string,
  updates: { email?: string; phone?: string }
): Promise<{ success: boolean }> {
  const res = await contactsFetch({ type: 'update', resourceName, ...updates })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur modification contact')
  return data
}
