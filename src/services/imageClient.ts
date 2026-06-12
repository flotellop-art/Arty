/**
 * P1.3 — Client de génération d'images (gpt-image-1 via proxy serveur).
 *
 * Appelle `/api/ai/image-gen` avec le token Google (gate anti-relais) et,
 * si présente, la clé OpenAI BYOK (`x-openai-key` — pas de cap). Retourne le
 * base64 brut ; le STOCKAGE en IndexedDB chiffré (anti-BUG 11) est fait par
 * l'appelant (tool handler), jamais en base64 dans la conversation.
 */

import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import { getOpenAIKey } from './activeApiKey'

export type ImageGenResult =
  | { ok: true; base64: string; mimeType: string }
  | { ok: false; code: 'plan_locked' | 'cap_reached' | 'auth' | 'failed' }

export async function generateImage(prompt: string): Promise<ImageGenResult> {
  const token = await getValidAccessToken()
  if (!token) return { ok: false, code: 'auth' }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-google-token': token,
  }
  const byok = getOpenAIKey()
  if (byok && byok !== 'server-provided') headers['x-openai-key'] = byok

  let res: Response
  try {
    res = await fetch(apiUrl('/api/ai/image-gen'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt }),
    })
  } catch {
    return { ok: false, code: 'failed' }
  }

  if (!res.ok) {
    if (res.status === 403) return { ok: false, code: 'plan_locked' }
    if (res.status === 429) return { ok: false, code: 'cap_reached' }
    if (res.status === 401) return { ok: false, code: 'auth' }
    return { ok: false, code: 'failed' }
  }

  try {
    const data = (await res.json()) as { b64?: string; mimeType?: string }
    if (!data.b64) return { ok: false, code: 'failed' }
    return { ok: true, base64: data.b64, mimeType: data.mimeType || 'image/png' }
  } catch {
    return { ok: false, code: 'failed' }
  }
}
