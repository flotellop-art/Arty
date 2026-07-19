const VISION_4K_FOUNDATION_FLAG = 'arty-vision-terra-4k-foundation'
const VISION_TERRA_AUTO_ROUTING_FLAG = 'arty-vision-terra-auto-routing'

/**
 * Fondation PR-A/PR-B : OFF par défaut, y compris après la fusion de PR-C.
 * Les images live gardent donc leurs routes historiques tant qu'un essai
 * owner n'active pas explicitement le flag à `1`.
 */
export function isVision4kFoundationEnabled(): boolean {
  try {
    return localStorage.getItem(VISION_4K_FOUNDATION_FLAG) === '1'
  } catch {
    return false
  }
}

/**
 * Flag distinct pour le routage Auto. La fondation peut ainsi être ouverte
 * en manuel aux essais owner sans envoyer automatiquement les photos à
 * OpenAI avant le benchmark qualité et le test mémoire concurrent Workerd.
 */
export function isVisionTerraAutoRoutingEnabled(): boolean {
  if (!isVision4kFoundationEnabled()) return false
  try {
    return localStorage.getItem(VISION_TERRA_AUTO_ROUTING_FLAG) === '1'
  } catch {
    return false
  }
}
