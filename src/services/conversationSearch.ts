import type { Conversation } from '../types'

// Recherche + classement des conversations de la Sidebar (P4).
//
// Avant : `conversations.filter(includes)` rendait les résultats dans l'ordre
// chronologique brut — la conversation la plus pertinente pouvait être enterrée,
// et un match trouvé DANS un message (pas le titre) s'affichait sans aucun
// indice visible du pourquoi. Ici : un score simple (pas de vecteurs —
// surdimensionné pour ≤ quelques centaines de convs) + un extrait du 1er message
// qui matche.
//
// Le score privilégie le titre, puis les tags, puis le corps (nombre de messages
// qui matchent, cappé — pas le total d'occurrences : moins cher et non
// manipulable par un message répétitif). La récence (`updatedAt`) ne sert que de
// départage, jamais à écraser la pertinence textuelle.

const TITLE_MATCH = 1000
const TITLE_PREFIX_BONUS = 500
const TAG_MATCH = 400
const BODY_MSG_WEIGHT = 20
const BODY_MSG_CAP = 5

/** `q` est supposé déjà en minuscules et non vide. `tagLabels` déjà en minuscules. */
export function scoreConversation(
  title: string,
  tagLabels: string[],
  messages: { content: string }[],
  q: string,
): number {
  let score = 0
  const t = title.toLowerCase()
  if (t.includes(q)) {
    score += TITLE_MATCH
    if (t.startsWith(q)) score += TITLE_PREFIX_BONUS
  }
  if (tagLabels.some((l) => l.includes(q))) score += TAG_MATCH

  let bodyMatches = 0
  for (const m of messages) {
    if (m.content.toLowerCase().includes(q)) {
      bodyMatches++
      if (bodyMatches >= BODY_MSG_CAP) break
    }
  }
  score += bodyMatches * BODY_MSG_WEIGHT
  return score
}

/**
 * Extrait du 1er message qui contient `q`, fenêtré autour du match et nettoyé
 * (markdown + espaces) pour l'aperçu. `null` si aucun message ne matche.
 */
export function firstSnippet(
  messages: { content: string }[],
  q: string,
  radius = 40,
): string | null {
  for (const m of messages) {
    const idx = m.content.toLowerCase().indexOf(q)
    if (idx === -1) continue
    const start = Math.max(0, idx - radius)
    const end = Math.min(m.content.length, idx + q.length + radius)
    let s = m.content.slice(start, end).replace(/[#*_`~]/g, '').replace(/\s+/g, ' ').trim()
    if (start > 0) s = '… ' + s
    if (end < m.content.length) s = s + ' …'
    return s
  }
  return null
}

export interface RankedSearch {
  /** Conversations matchées, triées par pertinence (puis récence en départage). */
  conversations: Conversation[]
  /** Extrait du message qui matche, par id de conv (uniquement si match body, pas titre). */
  snippets: Record<string, string>
}

/**
 * @param q          requête déjà en minuscules (et trim). Vide → liste inchangée.
 * @param tagLabelsOf résout les libellés de tags (en minuscules) d'une conv —
 *                    injecté par la Sidebar qui seule a accès à `t`.
 */
export function rankConversations(
  conversations: Conversation[],
  q: string,
  tagLabelsOf: (c: Conversation) => string[],
): RankedSearch {
  if (!q) return { conversations, snippets: {} }

  const scored: { c: Conversation; score: number }[] = []
  const snippets: Record<string, string> = {}

  for (const c of conversations) {
    const score = scoreConversation(c.title, tagLabelsOf(c), c.messages, q)
    if (score <= 0) continue
    scored.push({ c, score })
    // Extrait seulement si le titre ne matche pas (sinon le titre surligné suffit).
    if (!c.title.toLowerCase().includes(q)) {
      const s = firstSnippet(c.messages, q)
      if (s) snippets[c.id] = s
    }
  }

  // Tri stable (ES2019+) : pertinence d'abord, récence en départage.
  scored.sort((a, b) => b.score - a.score || b.c.updatedAt - a.c.updatedAt)
  return { conversations: scored.map((x) => x.c), snippets }
}
