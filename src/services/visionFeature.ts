const VISION_4K_FOUNDATION_FLAG = 'arty-vision-terra-4k-foundation'

/**
 * Fondation PR-A/PR-B : OFF par défaut. Tant que PR-C (routage + UI) n'est pas
 * fusionnée, les images live gardent leurs routes historiques. Les tests et
 * essais owner peuvent activer explicitement le flag à `1`.
 */
export function isVision4kFoundationEnabled(): boolean {
  try {
    return localStorage.getItem(VISION_4K_FOUNDATION_FLAG) === '1'
  } catch {
    return false
  }
}
