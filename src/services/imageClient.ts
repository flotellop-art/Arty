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
import { validGeneratedImage } from './generatedImages'
export { validGeneratedImage } from './generatedImages'

export type ImageProvider = 'openai' | 'flux'

export interface ImageRequestContext {
  readonly signal: AbortSignal
  assertCurrent(): void
  beforeRequest(): Promise<void>
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
