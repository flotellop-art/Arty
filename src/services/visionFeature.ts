const VISION_4K_FOUNDATION_FLAG = 'arty-vision-terra-4k-foundation'

/**
 * Fondation PR-A : OFF par défaut. Tant que PR-B (bornes proxy + builder) n'est
 * pas fusionnée, les images live gardent le pipeline historique à 2048 px.
 * Les tests et essais owner peuvent activer explicitement le flag à `1`.
 */
export function isVision4kFoundationEnabled(): boolean {
  try {
    return localStorage.getItem(VISION_4K_FOUNDATION_FLAG) === '1'
  } catch {
    return false
  }
}
