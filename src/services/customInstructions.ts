/**
 * P1.2 — Instructions personnalisées de l'utilisateur (custom instructions).
 *
 * Un champ texte global (« comment Arty doit te parler / ce qu'il doit savoir »)
 * injecté EN TÊTE du system prompt, avant la mémoire auto (P1.1) et les
 * comportements par défaut : l'explicite prime sur l'implicite.
 *
 * Stockage LOCAL chiffré (même pattern que localMemoryService) : ces
 * instructions peuvent contenir du contexte perso (métier, prénom). Lecture
 * synchrone (getJSON) pour buildPrompt ; écriture chiffrée (secureSetJSON).
 *
 * Cap volontairement serré à 500 caractères (~130 tokens) : ajoutés à CHAQUE
 * message, ils gonflent un system prompt déjà lourd — cohérent avec le bornage
 * de contexte du P0.9. Au-delà, la mémoire auto prend le relais.
 */

import * as scoped from './scopedStorage'

const STORAGE_KEY = 'custom-instructions'
export const MAX_CUSTOM_INSTRUCTIONS_CHARS = 500

export function getCustomInstructions(): string {
  const raw = scoped.getJSON<string>(STORAGE_KEY)
  return typeof raw === 'string' ? raw : ''
}

/** Persiste les instructions (tronquées au cap). Vide = désactivé. */
export function setCustomInstructions(value: string): void {
  const trimmed = value.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS)
  scoped.secureSetJSON(STORAGE_KEY, trimmed)
}
