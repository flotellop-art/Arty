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

export type ImageProvider = 'openai' | 'flux'

export interface ImageRequestContext {
  readonly signal: AbortSignal
  assertCurrent(): void
  beforeRequest(): Promise<void>
}

// Bound data before normalisation/storage. SVG and arbitrary MIME are never images here.
export function validGeneratedImage(base64: unknown, mime: unknown): base64 is string {
  if (typeof base64 !== 'string' || base64.length < 16 || base64.length > 13_981_016 || base64.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(base64)) return false
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  if (base64.slice(0, base64.length - padding).includes('=') || base64.length / 4 * 3 - padding > 10 * 1024 * 1024) return false
  const prefix = atob(base64.slice(0, 16))
  if (mime === 'image/png') return prefix.startsWith('\x89PNG\r\n\x1a\n')
  if (mime === 'image/jpeg') return prefix.startsWith('\xff\xd8\xff')
  if (mime === 'image/webp') return prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP'
  return false
}

export type ImageGenResult =
  | { ok: true; base64: string; mimeType: string }
  | { ok: false; code: 'plan_locked' | 'cap_reached' | 'auth' | 'unavailable' | 'failed' }

export async function generateImage(prompt: string, provider: ImageProvider, context: ImageRequestContext): Promise<ImageGenResult> {
  const assertCurrent = () => {
    if (context.signal.aborted) throw new DOMException('Image request cancelled', 'AbortError')
    context.assertCurrent()
  }
  assertCurrent()
  const byok = getOpenAIKey()
  const token = await getValidAccessToken()
  assertCurrent()
  if (!token) return { ok: false, code: 'auth' }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-google-token': token,
  }
  if (byok && byok !== 'server-provided') headers['x-openai-key'] = byok

  await context.beforeRequest()
  assertCurrent()

  let res: Response
  try {
    res = await fetch(apiUrl('/api/ai/image-gen'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt, provider }),
      signal: context.signal,
    })
  } catch {
    assertCurrent()
    return { ok: false, code: 'failed' }
  }
  assertCurrent()

  if (!res.ok) {
    if (res.status === 403) return { ok: false, code: 'plan_locked' }
    if (res.status === 429) return { ok: false, code: 'cap_reached' }
    if (res.status === 401) return { ok: false, code: 'auth' }
    // 503 = provider non configuré côté serveur (ex : BFL_API_KEY absente).
    if (res.status === 503) return { ok: false, code: 'unavailable' }
    return { ok: false, code: 'failed' }
  }

  try {
    const data = (await res.json()) as { b64?: string; mimeType?: string }
    assertCurrent()
    const mimeType = data.mimeType ?? 'image/png'
    if (!validGeneratedImage(data.b64, mimeType)) return { ok: false, code: 'failed' }
    return { ok: true, base64: data.b64, mimeType }
  } catch {
    assertCurrent()
    return { ok: false, code: 'failed' }
  }
}
