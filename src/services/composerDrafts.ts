// Brouillons du composeur (InputBar) — TEXTE uniquement, jamais les fichiers
// attachés (pas de base64 en localStorage, BUG 11). Deux niveaux :
//   - cache mémoire synchrone (survit aux changements d'écran) ;
//   - copie chiffrée AES en localStorage `arty-composer-draft:<userId>:<clé>`
//     (survit au reload ; restaurée par InputBar quand la crypto est prête).
// Les clés sont scopées par utilisateur : jamais de restauration croisée
// entre comptes sur un même appareil.
import { getActiveUserId } from './userSession'
import { parseComposerDraftOwnership } from './workspaceWriter/localOwnership'

const STORAGE_PREFIX = 'arty-composer-draft:'

const memory = new Map<string, { text: string }>()

/** `<userId|anonymous>:<draftKey>` — identifiant mémoire d'un brouillon. */
export function scopeComposerDraftKey(draftKey: string): string {
  return `${getActiveUserId() ?? 'anonymous'}:${draftKey}`
}

/** Clé localStorage (le contenu stocké sous cette clé est du chiffré). */
export function composerDraftStorageKey(scopedKey: string): string {
  return `${STORAGE_PREFIX}${scopedKey}`
}

export function getComposerDraft(scopedKey: string): string | undefined {
  return memory.get(scopedKey)?.text
}

export function hasComposerDraft(scopedKey: string): boolean {
  return memory.has(scopedKey)
}

/** Met à jour le cache mémoire seul — l'écriture chiffrée reste dans InputBar
    (elle dépend de l'état crypto et d'un versionnement anti-course). */
export function setComposerDraftMemory(scopedKey: string, text: string): void {
  if (text) memory.set(scopedKey, { text })
  else memory.delete(scopedKey)
}

/** Identity, not string equality: typing A -> B -> A is a new draft too.
 * No tombstones accumulate after deletion; pending tickets retain their entry. */
export function captureComposerDraftRevision(scopedKey: string): () => boolean {
  const entry = memory.get(scopedKey)
  return () => memory.get(scopedKey) === entry
}

/** Efface un brouillon des deux niveaux (mémoire + localStorage). */
export function clearComposerDraft(scopedKey: string): void {
  memory.delete(scopedKey)
  try {
    localStorage.removeItem(composerDraftStorageKey(scopedKey))
  } catch {
    /* contexte sans localStorage (tests) */
  }
}

/** GC à la suppression d'une conversation : son brouillon n'a plus de cible. */
export function clearConversationComposerDraft(conversationId: string): void {
  clearComposerDraft(scopeComposerDraftKey(`conversation:${conversationId}`))
}

/** Purge au logout des formes exactement attribuables. Les anciennes formes
    ambiguës restent conservées : jamais de fallback par préfixe.
    À appeler AVANT clearActiveSession() — le scope userId doit encore
    pointer sur le compte qui se déconnecte. */
export function purgeComposerDraftsForActiveUser(): void {
  const owner = getActiveUserId()
  if (owner === null) return // historical anonymous also encoded a literal owner
  const belongs = (key: string) => parseComposerDraftOwnership(key, 'logout')?.owner === owner
  for (const key of Array.from(memory.keys())) {
    if (belongs(key)) memory.delete(key)
  }
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX) && belongs(key.slice(STORAGE_PREFIX.length))) doomed.push(key)
    }
    doomed.forEach((key) => localStorage.removeItem(key))
  } catch {
    /* contexte sans localStorage (tests) */
  }
}
