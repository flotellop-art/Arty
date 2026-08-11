/**
 * Extraction des littéraux de chaîne d'un fichier source, pour le scanner
 * `check-public-google-access.mjs` (garde-fou de la stratégie « sans CASA »,
 * RÈGLE 8 de CLAUDE.md).
 *
 * Extrait dans son propre module le 9 août 2026 pour être testable : une
 * régression sur ce seul régex avait rendu le scanner aveugle au scope
 * `calendar.events.owned` du bundle Android, et seule la CI l'avait vue.
 */

/**
 * Renvoie le contenu de tous les littéraux de chaîne trouvés dans `source`,
 * quel que soit le délimiteur (apostrophe, guillemet, accent grave).
 *
 * Les accents graves sont scannés dans une passe SÉPARÉE, jamais ajoutés à
 * l'alternation des guillemets. Un régex consomme de gauche à droite : sur un
 * bundle minifié, un accent grave rencontré tôt ouvre une correspondance qui
 * avale toute la suite et masque les littéraux situés après. Deux passes
 * indépendantes ne peuvent pas s'entre-masquer.
 *
 * Chaque motif est borné à la ligne, pour qu'un délimiteur non refermé ne
 * puisse pas faire courir une correspondance sur tout un fichier.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function quotedStrings(source) {
  const out = []
  const quoted = /'([^'\n]*)'|"([^"\n]*)"/g
  let m
  while ((m = quoted.exec(source)) !== null) out.push(m[1] ?? m[2])
  const template = /`([^`\n]*)`/g
  while ((m = template.exec(source)) !== null) out.push(m[1])
  return out
}
