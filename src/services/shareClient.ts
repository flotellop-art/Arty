/**
 * P1.5 — Client de partage public de conversation.
 *
 * Sérialise un instantané TEXTE (titre + messages role/content/timestamp) et
 * le POST à /api/share. EXCLUT tout ce qui n'a pas sa place dans une page
 * publique : fichiers/base64, factCheck, pinned, interrupted, et le modèle
 * par message (`Message.model` — décision D3 du CDC visibilité modèle : le
 * reçu d'attribution s'adresse à l'utilisateur, pas aux tiers) — et NEUTRALISE
 * les références d'images générées (`arty-img://fileId`, locales à l'IndexedDB
 * de l'auteur → images mortes pour un visiteur). Le mapping explicite
 * role/content/timestamp ci-dessous est LA garantie : ne pas le remplacer par
 * un spread `...m`.
 */

import type { Conversation } from '../types'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import { getActiveUserId, getActiveSessionEpoch } from './userSession'
import { hasProjectHistory, isProjectEU } from './projects/chatPolicy'
import { messageImageText } from './messageImageText'

export interface ShareResult {
  ok: boolean
  id?: string
  url?: string
  code?: 'eu_blocked' | 'too_large' | 'rate_limit' | 'auth' | 'unavailable' | 'failed'
}

const SHARE_ORIGIN = 'https://tryarty.com'

/** Remplace les images générées (réf. locale) par une note — invisibles et
 *  cassées pour un visiteur sinon. Conserve les autres images markdown (URLs). */
function stripLocalImages(content: string): string {
  return content.replace(/!\[[^\]]*\]\(arty-img:\/\/[^)]*\)/g, '_[image générée — non incluse dans le partage]_')
}

/** Construit le payload public à partir d'une conversation. */
export function buildSharePayload(conv: Conversation): {
  title: string
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>
  usedModels: string[]
  euOnly: boolean
  hasGoogleData: boolean
} {
  return {
    title: conv.title,
    messages: conv.messages
      // `id: 'streaming'` = placeholder de stream en cours, jamais partagé.
      .filter((m) => m.id !== 'streaming' && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({
        role: m.role,
        content: stripLocalImages(messageImageText(m)),
        timestamp: m.timestamp,
      })),
    usedModels: [...(conv.usedModels ?? [])],
    euOnly: isProjectEU(conv),
    hasGoogleData: !!conv.hasGoogleData,
  }
}

export function shareConsentKey(conv: Conversation): string {
  return JSON.stringify([getActiveUserId(), getActiveSessionEpoch(), conv.id, conv.projectId, hasProjectHistory(conv), buildSharePayload(conv)])
}

export async function createShare(conv: Conversation, options?: { isCurrent?: () => boolean; onEngaged?: () => void }): Promise<ShareResult> {
  // euOnly : barrière client (le serveur refuse aussi — défense en profondeur).
  if (isProjectEU(conv)) return { ok: false, code: 'eu_blocked' }

  const owner = getActiveUserId(), epoch = getActiveSessionEpoch(), consentKey = shareConsentKey(conv)
  const body = JSON.stringify(buildSharePayload(conv))
  const current = () => owner === getActiveUserId() && epoch === getActiveSessionEpoch() && (options?.isCurrent?.() ?? true)
  if (!current()) return { ok: false, code: 'failed' }

  let token: string | null
  try { token = await getValidAccessToken() } catch { return { ok: false, code: 'auth' } }
  if (!current()) return { ok: false, code: 'auth' }
  if (shareConsentKey(conv) !== consentKey) return { ok: false, code: 'failed' }
  if (!token) return { ok: false, code: 'auth' }

  let res: Response
  try {
    if (!current()) return { ok: false, code: 'failed' }
    options?.onEngaged?.()
    res = await fetch(apiUrl('/api/share'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-google-token': token },
      body,
    })
  } catch {
    return { ok: false, code: 'failed' }
  }

  if (!current()) return { ok: false, code: 'auth' }

  if (!res.ok) {
    if (res.status === 400) return { ok: false, code: 'eu_blocked' }
    if (res.status === 413) return { ok: false, code: 'too_large' }
    if (res.status === 429) return { ok: false, code: 'rate_limit' }
    if (res.status === 401) return { ok: false, code: 'auth' }
    if (res.status === 503) return { ok: false, code: 'unavailable' }
    return { ok: false, code: 'failed' }
  }

  try {
    const data = (await res.json()) as { id?: string }
    if (!current()) return { ok: false, code: 'auth' }
    if (!data.id) return { ok: false, code: 'failed' }
    return { ok: true, id: data.id, url: `${SHARE_ORIGIN}/share/${data.id}` }
  } catch {
    return { ok: false, code: 'failed' }
  }
}

export async function deleteShare(id: string): Promise<boolean> {
  const token = await getValidAccessToken()
  if (!token) return false
  try {
    const res = await fetch(apiUrl(`/api/share/${id}`), {
      method: 'DELETE',
      headers: { 'x-google-token': token },
    })
    return res.ok
  } catch {
    return false
  }
}
