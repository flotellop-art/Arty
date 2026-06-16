import { getActiveUserId } from './userSession'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'

const MEMORY_CATEGORIES = ['profil', 'clients', 'projets', 'notes'] as const
type MemoryCategory = typeof MEMORY_CATEGORIES[number]

export interface MemoryData {
  profil: Record<string, unknown>
  clients: Record<string, unknown>[]
  projets: Record<string, unknown>[]
  notes: string[]
}

function getDefaultData(category: MemoryCategory): unknown {
  switch (category) {
    case 'profil':
      return {
        preferences: {},
        habitudes: {},
        derniereMAJ: new Date().toISOString(),
      }
    case 'clients':
      return []
    case 'projets':
      return []
    case 'notes':
      return []
  }
}

// ─── D1 memory storage ───

async function readMemoryD1(category: MemoryCategory): Promise<unknown> {
  const userId = getActiveUserId()
  if (!userId) return getDefaultData(category)

  try {
    // BUG critical (mai 2026) — l'endpoint /api/memory/action exige
    // x-google-token depuis l'audit étape 2 (PR #165 verifyGoogleUser).
    // Sans ce header → 401 → toutes les lectures retournaient null → Arty
    // pensait que la mémoire était vide à chaque conversation.
    // getValidAccessToken() rafraîchit auto si expiré (cf. BUG 23).
    const googleToken = await getValidAccessToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (googleToken) headers['x-google-token'] = googleToken
    const res = await fetch(apiUrl('/api/memory/action'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'read', userId, category }),
    })
    const result = await res.json() as { data: unknown }
    return result.data ?? getDefaultData(category)
  } catch {
    return getDefaultData(category)
  }
}

async function updateMemoryD1(category: MemoryCategory, data: unknown): Promise<{ success: boolean; message: string }> {
  const userId = getActiveUserId()
  if (!userId) return { success: false, message: 'Non connecté' }

  // Snapshot previous value for undo (Feature 11)
  let previousValue: unknown
  try {
    previousValue = await readMemoryD1(category)
  } catch {
    previousValue = undefined
  }

  try {
    // BUG critical — header x-google-token obligatoire depuis PR #165.
    // Sans ça toutes les écritures retournaient 401 silencieusement → Arty
    // ne mémorisait JAMAIS rien. getValidAccessToken() rafraîchit auto.
    const googleToken = await getValidAccessToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (googleToken) headers['x-google-token'] = googleToken
    const res = await fetch(apiUrl('/api/memory/action'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'write', userId, category, data }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { success: false, message: `Erreur D1 (${res.status}) ${errText}`.trim() }
    }
    // Log the change to the history
    try {
      const { logChange } = await import('./memoryHistory')
      const summary = typeof data === 'string'
        ? data.slice(0, 120)
        : Array.isArray(data)
          ? `${data.length} entrée(s)`
          : JSON.stringify(data).slice(0, 120)
      logChange(category, 'Mise à jour', summary, previousValue)
    } catch {
      // ignore logging failures
    }
    return { success: true, message: `Mémoire "${category}" mise à jour.` }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Erreur' }
  }
}

// ─── Public API (auto-selects Drive or D1) ───

export async function readMemory(category: MemoryCategory): Promise<unknown> {
  // Always use D1 for all users
  return readMemoryD1(category)
}

export async function readAllMemory(): Promise<MemoryData> {
  const [profil, clients, projets, notes] = await Promise.all([
    readMemory('profil'),
    readMemory('clients'),
    readMemory('projets'),
    readMemory('notes'),
  ])

  return {
    profil: profil as Record<string, unknown>,
    clients: clients as Record<string, unknown>[],
    projets: projets as Record<string, unknown>[],
    notes: notes as string[],
  }
}

export async function updateMemory(
  category: MemoryCategory,
  data: unknown
): Promise<{ success: boolean; message: string }> {
  return updateMemoryD1(category, data)
}

/**
 * Patterns qui déclenchent l'injection des entités (clients/projets/notes).
 * Si le message user contient un de ces mots/phrases, on injecte la mémoire
 * complète. Sinon, on n'injecte QUE le profil minimal.
 *
 * Volontairement conservatif : en cas de doute, on injecte tout (fallback
 * safe = comportement actuel). Mieux vaut consommer 5k tokens parasites
 * une fois que de rater une référence à "ma cliente Marie".
 *
 * Roadmap PR 12.1 — injection conditionnelle.
 */
const MEMORY_INJECTION_TRIGGERS = /\b(mon|ma|mes|notre|nos|client|clients|projet|projets|contact|contacts|adresse|adresses|note|notes|rappelle|souvient|souviens|mémoire|enregistre|sais|connais|appelle|nommé|nommée|nommés|nommées|qui\s+est|qu['']est-ce\s+que|où\s+est|où\s+habite)\b/i

/**
 * Extrait un mini-profil pour le Tier 0 (toujours injecté). Hard-capé à
 * ~150 tokens : prénom, métier, style de communication. Le reste du profil
 * (préférences détaillées, habitudes) attend le Tier 1.
 */
function extractMinimalProfil(profil: Record<string, unknown>): Record<string, unknown> | null {
  if (!profil || typeof profil !== 'object') return null
  const minimal: Record<string, unknown> = {}
  // Whitelist des clés essentielles. Évite d'injecter tous les attributs
  // potentiellement gros (historique, préférences détaillées, etc.).
  const ESSENTIAL_KEYS = ['prenom', 'nom', 'metier', 'style_communication', 'tutoiement']
  for (const key of ESSENTIAL_KEYS) {
    if (key in profil) minimal[key] = profil[key]
  }
  // Préférences résumées seulement
  const prefs = profil.preferences as Record<string, unknown> | undefined
  if (prefs && typeof prefs === 'object') {
    const prefKeys = Object.keys(prefs).slice(0, 3)
    if (prefKeys.length > 0) {
      minimal.preferences = Object.fromEntries(prefKeys.map((k) => [k, prefs[k]]))
    }
  }
  return Object.keys(minimal).length > 0 ? minimal : null
}

// ─── Sélection par pertinence du Tier 1 (PR P2) ───
//
// Avant : quand le trigger matchait, on injectait TOUS les clients/projets (cap
// 20 chacun). "rappelle-moi l'adresse de Dupont" avec 20 clients injectait
// 19 fiches inutiles. Ici : scoring lexical simple (PAS de vecteurs) pour ne
// garder que les entrées pertinentes, avec deux garde-fous anti-régression :
//  - listes courtes (≤ RELEVANCE_PASSTHROUGH) : on injecte tout (coût faible,
//    zéro risque de rater une entrée) ;
//  - requête générique (0 token utile) ou agrégative (beaucoup d'entrées
//    matchent, ex "quels clients ont un projet en cours ?") : on retombe sur le
//    cap complet — JAMAIS de drop silencieux du contexte dont la requête a besoin.
const RELEVANCE_PASSTHROUGH = 8 // ≤ 8 entrées → tout injecter
const MAX_RELEVANT = 10 // au-delà → au plus 10 entrées pertinentes
const MAX_MEMORY_ENTRIES = 20 // cap legacy / requête générique / agrégative

/** Minuscule + retrait des accents (NFD) — appliqué des DEUX côtés de la compa. */
function normalizeForSearch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Mots à ignorer dans le scoring. Inclut les déclencheurs de MEMORY_INJECTION_
// TRIGGERS (ce sont des SIGNAUX d'injection, pas des discriminants de contenu —
// sans ça "rappelle"/"adresse" sur-matcheraient des fiches au hasard) + les mots
// vides FR/EN ≥ 3 lettres (les < 3 sont déjà retirés par le filtre de longueur).
const SCORING_STOPWORDS = new Set([
  'mon', 'mes', 'notre', 'nos', 'client', 'clients', 'projet', 'projets', 'contact', 'contacts',
  'adresse', 'adresses', 'note', 'notes', 'rappelle', 'souvient', 'souviens', 'memoire', 'enregistre',
  'sais', 'connais', 'appelle', 'nomme', 'nommee', 'nommes', 'nommees', 'habite',
  'les', 'des', 'une', 'ces', 'son', 'ses', 'par', 'sur', 'pas', 'vous', 'nous', 'pour', 'dans', 'avec',
  'leur', 'leurs', 'vos', 'votre', 'qui', 'que', 'quoi', 'dont', 'cette', 'cet', 'ont', 'sont', 'suis',
  'etre', 'est', 'fait', 'faire', 'tout', 'tous', 'toute', 'toutes', 'plus', 'moins', 'tres', 'bien',
  'aussi', 'donc', 'mais', 'car', 'ainsi', 'alors', 'moi', 'toi', 'lui', 'eux', 'elle', 'ils', 'elles',
  'comme', 'sans', 'sous', 'entre', 'vers', 'chez', 'cela', 'ceci', 'quel', 'quelle', 'quels', 'quelles',
  'the', 'and', 'for', 'you', 'your', 'our', 'are', 'what', 'who', 'where', 'with', 'this', 'that',
  'have', 'has', 'from', 'about', 'can', 'will',
])

/** Tokens discriminants (dédupliqués) d'un message utilisateur. */
function tokenizeQuery(userMessage: string): string[] {
  const seen = new Set<string>()
  for (const raw of normalizeForSearch(userMessage).split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || SCORING_STOPWORDS.has(raw)) continue
    seen.add(raw)
  }
  return [...seen]
}

/**
 * Score lexical d'une entrée mémoire. Le nom/titre pèse double ; tous les autres
 * champs string (resume, adresse, historique, budget…) comptent simple. Schéma-
 * libre : on itère sur toutes les valeurs string plutôt qu'une whitelist de clés.
 */
function scoreEntry(entry: Record<string, unknown>, tokens: string[]): number {
  const name = normalizeForSearch(String(entry.nom ?? entry.titre ?? ''))
  const restParts: string[] = []
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'nom' || k === 'titre') continue
    if (typeof v === 'string') restParts.push(v)
  }
  const rest = normalizeForSearch(restParts.join(' '))
  let score = 0
  for (const t of tokens) {
    if (name.includes(t)) score += 2
    else if (rest.includes(t)) score += 1
  }
  return score
}

function selectRelevantEntries(
  entries: Record<string, unknown>[],
  userMessage: string
): Record<string, unknown>[] {
  if (entries.length <= RELEVANCE_PASSTHROUGH) return entries
  const tokens = tokenizeQuery(userMessage)
  if (tokens.length === 0) return entries.slice(0, MAX_MEMORY_ENTRIES) // requête générique
  const scored = entries
    .map((e) => ({ e, score: scoreEntry(e, tokens) }))
    .filter((s) => s.score > 0)
  if (scored.length === 0) return entries.slice(0, MAX_MEMORY_ENTRIES) // aucun match → cap
  // Requête agrégative (beaucoup d'entrées matchent) → la liste entière est
  // probablement attendue → cap complet plutôt qu'un sous-ensemble tronqué.
  if (scored.length * 2 > entries.length) return entries.slice(0, MAX_MEMORY_ENTRIES)
  scored.sort((a, b) => b.score - a.score) // tri stable (ES2019+) : égalités = ordre d'origine
  return scored.slice(0, MAX_RELEVANT).map((s) => s.e)
}

/**
 * Formate la mémoire pour injection dans le system prompt.
 *
 * @param memory   Toute la mémoire chargée depuis D1
 * @param userMessage   Optionnel — message utilisateur courant. Si fourni,
 *                      active l'injection conditionnelle (Tier 0 vs Tier 1).
 *                      Si omis, fallback comportement legacy (tout injecter).
 *
 * Sans userMessage : compatible avec les appelants existants, aucune
 * régression.
 * Avec userMessage : si pas de pattern mémoire dans le message → injection
 * minimale (profil essentiel seulement). Économie typique ~95% des tokens
 * sur les requêtes type "salut", "merci", "comment ça va".
 */
export function formatMemoryForPrompt(memory: MemoryData, userMessage?: string): string {
  const parts: string[] = []

  // Décide si on est en mode conditionnel ou en mode complet.
  // Mode complet (legacy fallback) si pas de userMessage OU si le message
  // matche un trigger mémoire.
  const conditionalMode = !!userMessage
  const shouldInjectFullMemory =
    !conditionalMode || MEMORY_INJECTION_TRIGGERS.test(userMessage)

  // Profil — toujours injecté (Tier 0), mais minimal en mode conditionnel
  // sans trigger, complet sinon.
  if (memory.profil && Object.keys(memory.profil).length > 0) {
    if (shouldInjectFullMemory) {
      parts.push(`PROFIL UTILISATEUR :\n${JSON.stringify(memory.profil, null, 2)}`)
    } else {
      const minimal = extractMinimalProfil(memory.profil)
      if (minimal) {
        parts.push(`PROFIL UTILISATEUR (résumé) :\n${JSON.stringify(minimal, null, 2)}`)
      }
    }
  }

  // Tier 1 — clients/projets/notes : injectés uniquement si trigger
  // matche, ou si mode legacy (pas de userMessage fourni).
  if (shouldInjectFullMemory) {
    // Clients — en mode conditionnel (userMessage présent + trigger), on ne
    // garde que les fiches pertinentes ; sinon (legacy sans userMessage) cap 20.
    if (memory.clients && memory.clients.length > 0) {
      const total = memory.clients.length
      const selected = conditionalMode
        ? selectRelevantEntries(memory.clients, userMessage as string)
        : memory.clients.slice(0, MAX_MEMORY_ENTRIES)
      const clientSummary = selected
        .map((c) => `- ${c.nom || 'Inconnu'}: ${c.resume || JSON.stringify(c)}`)
        .join('\n')
      const header = selected.length < total
        ? `CLIENTS CONNUS (${selected.length} sur ${total} — sélection pertinente)`
        : `CLIENTS CONNUS (${total})`
      parts.push(`${header} :\n${clientSummary}`)
    }

    // Projets — même logique de sélection que les clients.
    if (memory.projets && memory.projets.length > 0) {
      const total = memory.projets.length
      const selected = conditionalMode
        ? selectRelevantEntries(memory.projets, userMessage as string)
        : memory.projets.slice(0, MAX_MEMORY_ENTRIES)
      const projetSummary = selected
        .map((p) => `- ${p.nom || p.titre || 'Inconnu'}: ${p.resume || JSON.stringify(p)}`)
        .join('\n')
      const header = selected.length < total
        ? `PROJETS (${selected.length} sur ${total} — sélection pertinente)`
        : `PROJETS (${total})`
      parts.push(`${header} :\n${projetSummary}`)
    }

    // Notes
    if (memory.notes && memory.notes.length > 0) {
      parts.push(`NOTES :\n${memory.notes.slice(-10).map((n) => `- ${n}`).join('\n')}`)
    }
  }

  if (parts.length === 0) return ''
  return `\n\nMÉMOIRE PERSISTANTE :\n${parts.join('\n\n')}`
}

/** Reset (call on logout) */
export function resetMemoryCache(): void {
  // No local cache to clear — D1 handles everything server-side
}
