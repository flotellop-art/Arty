/**
 * F-001 — Local Memory Service
 * Mémoire personnelle 100% locale : liste de faits courts.
 *
 * PRIVACY GUARANTEE :
 * - Aucune requête réseau dans ce fichier.
 * - Stockage via scopedStorage.secureSetJSON -> localStorage chiffré AES-256.
 * - Les faits ne sont jamais envoyés au serveur sous forme de base de données.
 * - Ils sont injectés dans le system prompt CÔTÉ CLIENT par useAppSetup.ts.
 *
 * Distinct de src/services/memoryService.ts qui est la mémoire D1 serveur.
 */

import * as scoped from './scopedStorage'

const STORAGE_KEY = 'local-memory-facts'
// 80 (était 50) depuis la mémoire automatique (P1.1) : l'extraction remplit
// la liste plus vite qu'une saisie manuelle. ⚠️ Chaque fait est injecté au
// system prompt de CHAQUE message (buildLocalMemoryPrompt) — monter plus haut
// exige un tiering d'injection type mémoire D1 (Tier 0/1), pas juste un cap.
export const MAX_FACTS = 80

export interface LocalMemoryFact {
  id: string
  content: string
  createdAt: number // timestamp ms
}

/** Génère un ID simple sans dépendance externe */
function genId(): string {
  return `lm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Lit tous les faits depuis localStorage (sync, lecture JSON plain).
 * Le chiffrement async est géré par secureSetJSON/secureGetJSON.
 */
export function getAll(): LocalMemoryFact[] {
  const stored = scoped.getJSON<LocalMemoryFact[]>(STORAGE_KEY)
  if (!Array.isArray(stored)) return []
  return stored
}

/**
 * Persiste la liste complète (plain JSON sync + chiffrement async).
 */
function persist(facts: LocalMemoryFact[]): void {
  scoped.secureSetJSON(STORAGE_KEY, facts)
  // Notifie les composants React
  try {
    window.dispatchEvent(new CustomEvent('arty-local-memory-updated', { detail: facts }))
  } catch { /* SSR / test env */ }
}

/**
 * Ajoute un fait.
 * @returns Le fait créé, ou null si la limite est atteinte ou le contenu vide.
 */
export function addFact(content: string): LocalMemoryFact | null {
  const trimmed = content.trim()
  if (!trimmed) return null

  const all = getAll()
  if (all.length >= MAX_FACTS) return null

  const fact: LocalMemoryFact = {
    id: genId(),
    content: trimmed,
    createdAt: Date.now(),
  }
  persist([...all, fact])
  return fact
}

/**
 * Met à jour le contenu d'un fait existant.
 * @returns true si trouvé et mis à jour.
 */
export function updateFact(id: string, content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  const all = getAll()
  const idx = all.findIndex((f) => f.id === id)
  if (idx === -1) return false

  const updated = [...all]
  updated[idx] = { ...updated[idx]!, content: trimmed }
  persist(updated)
  return true
}

/**
 * Supprime un fait par id.
 * @returns true si trouvé et supprimé.
 */
export function deleteFact(id: string): boolean {
  const all = getAll()
  const filtered = all.filter((f) => f.id !== id)
  if (filtered.length === all.length) return false
  persist(filtered)
  return true
}

/**
 * Efface toute la mémoire locale.
 */
export function clearLocalMemory(): void {
  persist([])
}

/**
 * Construit le bloc system prompt à injecter avant les autres contextes.
 * Retourne une chaîne vide si aucun fait n'est stocké.
 */
export function buildLocalMemoryPrompt(): string {
  const facts = getAll()
  if (facts.length === 0) return ''

  const lines = facts.map((f) => `- ${f.content}`).join('\n')
  return `Faits mémorisés sur l'utilisateur (retenus localement, à utiliser pour personnaliser les réponses sans les divulguer tels quels) :\n${lines}\n\n`
}
