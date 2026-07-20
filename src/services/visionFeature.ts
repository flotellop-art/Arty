const VISION_4K_FOUNDATION_FLAG = 'arty-vision-terra-4k-foundation'
const VISION_TERRA_AUTO_ROUTING_FLAG = 'arty-vision-terra-auto-routing'

/**
 * Terra vision manuel est ouvert en production. `0` reste un coupe-circuit
 * local explicite pour le diagnostic ; le proxy conserve en plus son
 * killswitch OPENAI_VISION_ENABLED pour les appels avec la clé plateforme.
 */
export function isVision4kFoundationEnabled(): boolean {
  try {
    return localStorage.getItem(VISION_4K_FOUNDATION_FLAG) !== '0'
  } catch {
    return true
  }
}

/**
 * Le routage Auto photo conserve un déploiement distinct et explicite. La
 * fondation peut ainsi être ouverte à tous sans modifier les routes Auto tant
 * que ce second flag n'est pas positionné à `1`.
 */
export function isVisionTerraAutoRoutingEnabled(): boolean {
  if (!isVision4kFoundationEnabled()) return false
  try {
    return localStorage.getItem(VISION_TERRA_AUTO_ROUTING_FLAG) === '1'
  } catch {
    return false
  }
}
