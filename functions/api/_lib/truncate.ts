// Troncature « lisible » du texte de documents/emails avant injection dans le
// contexte du modèle. Quand le contenu est coupé, on ajoute une note VISIBLE
// pour que ni Claude ni l'utilisateur ne soient trompés par une coupe
// silencieuse (stratégie produit : « limites lisibles, jamais de bascule
// cachée »). Avant ce helper, drive/gmail/fetch faisaient un `.slice(0, N)`
// muet — un Google Doc de 15 pages perdait ses dernières pages sans aucun
// signal.
//
// Deux pièges évités ici une fois pour toutes :
//  - `truncated` est dérivé de la VRAIE longueur (`> limit`), pas de
//    `sliced.length === limit` : un document de pile `limit` caractères n'est
//    donc PAS faussement marqué comme tronqué.
//  - La note est concaténée APRÈS le slice, jamais avant — sinon la note
//    elle-même serait coupée.

export interface TruncationResult {
  /** Texte prêt à injecter (avec la note finale si tronqué). */
  text: string
  /** Vrai uniquement si le contenu original dépassait `limit`. */
  truncated: boolean
  /** Longueur du contenu AVANT troncature. */
  originalLength: number
}

export function truncateWithNotice(content: string, limit: number): TruncationResult {
  const originalLength = content.length
  if (originalLength <= limit) {
    return { text: content, truncated: false, originalLength }
  }
  const text =
    content.slice(0, limit) +
    `\n\n[Note : contenu tronqué à ${limit} caractères sur ${originalLength}. ` +
    `Demande la suite ou un extrait précis si besoin.]`
  return { text, truncated: true, originalLength }
}
