/**
 * Signalement de contenu généré par l'IA (policy Play Store « AI-Generated
 * Content » : l'utilisateur doit pouvoir signaler un contenu offensant au
 * développeur SANS quitter l'app).
 *
 * Sérialise un extrait TRONQUÉ du message signalé (+ la question user qui le
 * précède, pour le triage) et le POST à /api/report. Privé : le rapport part
 * vers la base D1 d'Arty (juridiction EU), jamais vers un LLM — c'est pourquoi
 * les conversations euOnly peuvent AUSSI être signalées (contrairement au
 * partage public, bloqué). Auth : token Google OU jeton d'essai email — tout
 * utilisateur qui peut générer du contenu doit pouvoir le signaler.
 */

import type { Conversation, Message } from '../types'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import { getTrialToken } from './emailTrialClient'

export type ReportCategory = 'offensive' | 'dangerous' | 'misinformation' | 'other'
export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  'offensive',
  'dangerous',
  'misinformation',
  'other',
]

// Même convention de troncature que ConversationSummaryModal (2000 chars) :
// un extrait suffit à la modération, le message complet n'a rien à faire côté
// serveur. Le champ libre reste court (contexte, pas une conversation).
const MAX_EXCERPT_CHARS = 2000
const MAX_FREE_TEXT_CHARS = 500

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

export interface ReportPayload {
  category: ReportCategory
  freeText: string
  messageExcerpt: string
  precedingExcerpt: string
  /** Modèles utilisés dans la CONVERSATION — pas de traçabilité par message
   *  (Message n'a pas de champ modèle), donc on ne prétend pas mieux. */
  usedModelsInConversation: string[]
  euOnly: boolean
}

/** Construit le payload de signalement pour un message assistant donné. */
export function buildReportPayload(
  conv: Conversation,
  message: Message,
  category: ReportCategory,
  freeText: string
): ReportPayload {
  // Dernier message USER avant le message signalé — aide le triage
  // (« pourquoi cette réponse ? »). Le placeholder de stream est ignoré.
  let preceding = ''
  const idx = conv.messages.findIndex((m) => m.id === message.id)
  for (let i = (idx === -1 ? conv.messages.length : idx) - 1; i >= 0; i--) {
    const m = conv.messages[i]
    if (m && m.role === 'user' && m.id !== 'streaming') {
      preceding = m.content
      break
    }
  }

  return {
    category,
    freeText: truncate(freeText.trim(), MAX_FREE_TEXT_CHARS),
    messageExcerpt: truncate(message.content, MAX_EXCERPT_CHARS),
    precedingExcerpt: truncate(preceding, MAX_EXCERPT_CHARS),
    usedModelsInConversation: conv.usedModels ?? [],
    euOnly: !!conv.euOnly,
  }
}

export interface ReportResult {
  ok: boolean
  code?: 'auth' | 'rate_limit' | 'invalid' | 'failed'
}

export async function submitReport(payload: ReportPayload): Promise<ReportResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const googleToken = await getValidAccessToken()
  if (googleToken) {
    headers['x-google-token'] = googleToken
  } else {
    // Essai par email (pas de compte Google) : même identité que les proxys IA.
    const trialToken = getTrialToken()
    if (trialToken) headers['x-arty-trial-token'] = trialToken
    else return { ok: false, code: 'auth' }
  }

  let res: Response
  try {
    res = await fetch(apiUrl('/api/report'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, code: 'failed' }
  }

  if (!res.ok) {
    if (res.status === 401) return { ok: false, code: 'auth' }
    if (res.status === 429) return { ok: false, code: 'rate_limit' }
    if (res.status === 400) return { ok: false, code: 'invalid' }
    return { ok: false, code: 'failed' }
  }
  return { ok: true }
}
