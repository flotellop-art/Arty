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

// Hiérarchie titre > tag > corps, mais sans l'absolutisme initial (titre était
// 10× le corps) : un corps dense (cap×poids = 240) reste sous un match titre
// (500) tout en passant devant peu de mentions.
const TITLE_MATCH = 500
const TITLE_PREFIX_BONUS = 300
const TAG_MATCH = 300
const BODY_MSG_WEIGHT = 40
const BODY_MSG_CAP = 6

// Recherche insensible à la casse ET aux accents (NFD + retrait des diacritiques).
// Indispensable en français : « resume » doit trouver « résumé », « tache » →
// « tâche ». Sans ça une grosse part des recherches échoue silencieusement.
export function normalizeForSearch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** `q` supposé non vide. Casse/accents gérés en interne. `tagLabels` libellés résolus. */
export function scoreConversation(
  title: string,
  tagLabels: string[],
  messages: { content: string }[],
  q: string,
): number {
  const nq = normalizeForSearch(q)
  let score = 0

  const t = normalizeForSearch(title)
  if (t.includes(nq)) {
    score += TITLE_MATCH
    if (t.startsWith(nq)) score += TITLE_PREFIX_BONUS
  }
  if (tagLabels.some((l) => normalizeForSearch(l).includes(nq))) score += TAG_MATCH

  let bodyMatches = 0
  for (const m of messages) {
    if (normalizeForSearch(m.content).includes(nq)) {
      bodyMatches++
      if (bodyMatches >= BODY_MSG_CAP) break
    }
  }
  score += bodyMatches * BODY_MSG_WEIGHT
  return score
}

/**
 * Extrait du 1er message qui contient `q` (insensible aux accents), fenêtré
 * autour du match et nettoyé (liens markdown, URLs, markdown, espaces) pour
 * l'aperçu. `null` si aucun message ne matche.
 *
 * Subtilité accents : la DÉCISION de match est normalisée, mais le fenêtrage se
 * fait sur le texte ORIGINAL via l'index brut. Si les accents ne s'alignent pas
 * (l'index brut est introuvable), on montre le début du message — dégradation
 * douce plutôt qu'un index décalé par la normalisation NFD.
 */
export function firstSnippet(
  messages: { content: string }[],
  q: string,
  radius = 30,
): string | null {
  const nq = normalizeForSearch(q)
  for (const m of messages) {
    if (!normalizeForSearch(m.content).includes(nq)) continue
    let idx = m.content.toLowerCase().indexOf(q.toLowerCase())
    if (idx === -1) idx = 0 // accents non alignés → début du message
    const start = Math.max(0, idx - radius)
    const end = Math.min(m.content.length, idx + q.length + radius)
    let s = m.content
      .slice(start, end)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [texte](url) → texte
      .replace(/https?:\/\/\S+/g, '[lien]') // URL nue → [lien]
      .replace(/[#*_`~>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
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
 * @param q          requête (trim). Vide → liste inchangée.
 * @param tagLabelsOf résout les libellés de tags d'une conv — injecté par la
 *                    Sidebar qui seule a accès à `t`.
 */
export function rankConversations(
  conversations: Conversation[],
  q: string,
  tagLabelsOf: (c: Conversation) => string[],
): RankedSearch {
  if (!q) return { conversations, snippets: {} }

  const nq = normalizeForSearch(q)
  const scored: { c: Conversation; score: number }[] = []
  const snippets: Record<string, string> = {}

  for (const c of conversations) {
    const score = scoreConversation(c.title, tagLabelsOf(c), c.messages, q)
    if (score <= 0) continue
    scored.push({ c, score })
    // Extrait seulement si le titre ne matche pas (sinon le titre surligné suffit).
    if (!normalizeForSearch(c.title).includes(nq)) {
      const s = firstSnippet(c.messages, q)
      if (s) snippets[c.id] = s
    }
  }

  // Tri stable (ES2019+) : pertinence d'abord, récence en départage.
  scored.sort((a, b) => b.score - a.score || b.c.updatedAt - a.c.updatedAt)
  return { conversations: scored.map((x) => x.c), snippets }
}
