// P1.8 — tags de conversation, version SÛRE (audit 14 juin 2026).
//
// Choix de design (suite au challenge RÈGLE 7) :
//  - Jeu PRÉDÉFINI fermé (id stable + label i18n + couleur fixe) → pas de
//    doublons « Travail »/« travail », pas de souci FR/EN, couleur déterministe.
//  - UN tag PERSO libre toléré, NORMALISÉ (trim, longueur bornée, dédup
//    insensible à la casse) avec une couleur neutre.
//  - La couleur est portée par une PASTILLE (●) hex inline, pas par des classes
//    Tailwind (évite le purge) ni un fond coloré (illisible en thème sombre).
//
// Stockage : `Conversation.tags?: string[]` — chaque entrée est soit un id
// prédéfini (ex. 'work'), soit le texte d'un tag perso. Aucune migration
// (champ optionnel, cast nu au déchiffrement — cf. euOnly/hasGoogleData).

export interface PredefinedTag {
  id: string
  labelKey: string
  /** Couleur de la pastille (hex). Lisible sur fond clair ET sombre. */
  color: string
}

// Jeu volontairement court et générique. Couleurs distinctes et accessibles.
export const PREDEFINED_TAGS: readonly PredefinedTag[] = [
  { id: 'work', labelKey: 'tags.predefined.work', color: '#3b82f6' }, // bleu
  { id: 'personal', labelKey: 'tags.predefined.personal', color: '#10b981' }, // vert
  { id: 'clients', labelKey: 'tags.predefined.clients', color: '#f59e0b' }, // ambre
  { id: 'finance', labelKey: 'tags.predefined.finance', color: '#8b5cf6' }, // violet
  { id: 'admin', labelKey: 'tags.predefined.admin', color: '#ef4444' }, // rouge
  { id: 'ideas', labelKey: 'tags.predefined.ideas', color: '#ec4899' }, // rose
] as const

const PREDEFINED_BY_ID = new Map(PREDEFINED_TAGS.map((t) => [t.id, t]))

/** Couleur neutre (accent) pour un tag perso. */
const CUSTOM_TAG_COLOR = '#6b7280' // gris

/** Limites anti-abus / lisibilité. */
export const MAX_TAGS_PER_CONVERSATION = 4
export const MAX_CUSTOM_TAG_LENGTH = 24

export interface ResolvedTag {
  /** Valeur stockée (id prédéfini ou texte perso). */
  value: string
  /** Libellé affiché (traduit pour les prédéfinis, brut pour le perso). */
  label: string
  color: string
  predefined: boolean
}

/**
 * Résout un tag stocké en {label, color} pour l'affichage.
 * `t` = fonction de traduction i18next (passée par le composant).
 */
export function resolveTag(value: string, t: (key: string) => string): ResolvedTag {
  const def = PREDEFINED_BY_ID.get(value)
  if (def) {
    return { value, label: t(def.labelKey), color: def.color, predefined: true }
  }
  return { value, label: value, color: CUSTOM_TAG_COLOR, predefined: false }
}

/**
 * Normalise un tag perso saisi : trim, borne la longueur. Renvoie null si vide.
 * On NE met PAS en minuscule (on respecte la casse de l'utilisateur pour
 * l'affichage), mais la dédup côté `addTag` est insensible à la casse.
 */
export function normalizeCustomTag(raw: string): string | null {
  const trimmed = raw.trim().slice(0, MAX_CUSTOM_TAG_LENGTH).trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Ajoute un tag à une liste existante de façon sûre :
 *  - dédup insensible à la casse (« Travail » == « travail ») ;
 *  - respecte le plafond MAX_TAGS_PER_CONVERSATION.
 * Renvoie la nouvelle liste (ou l'ancienne si rien n'a changé).
 */
export function addTag(tags: string[], value: string): string[] {
  const exists = tags.some((t) => t.toLowerCase() === value.toLowerCase())
  if (exists || tags.length >= MAX_TAGS_PER_CONVERSATION) return tags
  return [...tags, value]
}

/** Retire un tag (comparaison insensible à la casse). */
export function removeTag(tags: string[], value: string): string[] {
  return tags.filter((t) => t.toLowerCase() !== value.toLowerCase())
}
