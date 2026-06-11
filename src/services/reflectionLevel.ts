import * as scoped from './scopedStorage'
import type { AIModel } from './modelSelector'

// Niveau de « réflexion » (thinking étendu) choisi par l'utilisateur dans le
// chat. Réglage GLOBAL (comme le style de réponse), pas par conversation :
// l'utilisateur règle une fois la profondeur de raisonnement qu'il veut.
//
// Mappé en aval :
//  - Claude  → thinking adaptatif + output_config.effort (aiRouter.resolveClaudeThinking)
//  - Gemini  → thinkingConfig.thinkingBudget          (aiRouter.resolveGeminiThinkingBudget)
//  - Mistral / ChatGPT → PAS de réflexion exposée → le contrôle est masqué.
//
// Ordre du sélecteur (choix produit, validé avec l'utilisateur) :
//  Auto → Rapide → Approfondi → Max.
//   - auto       : Arty décide par message (heuristique needsThinking). Défaut.
//   - rapide     : réflexion coupée — réponse la plus rapide / la moins chère.
//   - approfondi : réflexion forcée élevée (effort high).
//   - max        : réflexion maximale (effort max). Réservé aux comptes Pro.
export type ReflectionLevel = 'auto' | 'rapide' | 'approfondi' | 'max'

export const REFLECTION_OPTIONS: Array<{ id: ReflectionLevel; emoji: string; proOnly?: boolean }> = [
  { id: 'auto', emoji: '✨' },
  { id: 'rapide', emoji: '⚡' },
  { id: 'approfondi', emoji: '🧠' },
  { id: 'max', emoji: '🚀', proOnly: true },
]

const VALID = REFLECTION_OPTIONS.map((o) => o.id)

export function getReflectionLevel(): ReflectionLevel {
  const saved = scoped.getItem('reflection-level')
  if (saved && (VALID as string[]).includes(saved)) return saved as ReflectionLevel
  return 'auto'
}

export function setReflectionLevel(level: ReflectionLevel): void {
  scoped.setItem('reflection-level', level)
  // BUG 54 — toute écriture d'un store partagé entre vues DOIT dispatcher un
  // event pour que les consommateurs (ChatTopBar, sheet) se resynchronisent.
  try {
    window.dispatchEvent(new CustomEvent('reflection-level-changed', { detail: level }))
  } catch {
    /* pas de window (tests/SSR) — ignore */
  }
}

/** « Max » n'est disponible que pour les comptes payants. Hors Pro, le tap
 *  doit déclencher la modale d'upgrade au lieu d'appliquer le niveau. */
export function isReflectionLevelLocked(level: ReflectionLevel, isPro: boolean): boolean {
  const opt = REFLECTION_OPTIONS.find((o) => o.id === level)
  return !!opt?.proOnly && !isPro
}

/**
 * La réflexion n'existe que chez les fournisseurs qui exposent un budget de
 * pensée : Claude et Gemini. Mistral et ChatGPT n'en ont pas ; une
 * conversation `euOnly` est verrouillée sur Mistral. Dans ces cas le contrôle
 * est MASQUÉ (choix produit validé avec l'utilisateur), pas désactivé : un
 * curseur grisé pour des modèles qui ne le supportent pas est trompeur.
 *
 * `auto` est inclus : en mode auto le routeur peut choisir Claude ou Gemini,
 * tous deux compatibles. Si l'auto route vers un modèle sans réflexion
 * (improbable hors données privées → Claude), le niveau est simplement ignoré
 * en aval — aucun effet de bord.
 */
export function reflectionSupported(model: AIModel, euOnly?: boolean): boolean {
  if (euOnly) return false
  return model === 'auto' || model === 'claude' || model === 'gemini'
}
