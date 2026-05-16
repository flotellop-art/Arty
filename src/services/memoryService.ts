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
    // Clients
    if (memory.clients && memory.clients.length > 0) {
      const clientSummary = memory.clients
        .slice(0, 20)
        .map((c) => `- ${c.nom || 'Inconnu'}: ${c.resume || JSON.stringify(c)}`)
        .join('\n')
      parts.push(`CLIENTS CONNUS (${memory.clients.length}) :\n${clientSummary}`)
    }

    // Projets
    if (memory.projets && memory.projets.length > 0) {
      const projetSummary = memory.projets
        .slice(0, 20)
        .map((p) => `- ${p.nom || p.titre || 'Inconnu'}: ${p.resume || JSON.stringify(p)}`)
        .join('\n')
      parts.push(`PROJETS (${memory.projets.length}) :\n${projetSummary}`)
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
