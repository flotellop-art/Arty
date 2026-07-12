// ─────────────────────────────────────────────────────────────────────────────
// Collecte IMPURE des entrées du routage (refonte routage, étape 2).
//
// Toutes les lectures de singletons (sélecteur de modèle, plan en cache,
// clés/disponibilité, niveau de réflexion, licence Pro, wallet) sont isolées
// ici — resolveRoute reste une fonction pure testable sans aucun mock de
// module. Un seul appelant en prod : useConversation.sendMessage.
// ─────────────────────────────────────────────────────────────────────────────
import { getSelectedModel } from '../modelSelector'
import { getReflectionLevel } from '../reflectionLevel'
import { isProActivated } from '../proLicense'
import { creditsCoverPremium } from '../walletClient'
import { getProviderAvailability } from './availability'
import type { RouteInput } from './types'

export interface RouteContext {
  originalText: string
  hasFiles: boolean
  hasPdf: boolean
  euOnly: boolean
  hasPrivateHistory: boolean
}

export function gatherRouteInput(ctx: RouteContext): RouteInput {
  let plan: string | null = null
  try { plan = localStorage.getItem('arty-plan-cache') } catch { /* contexte sans storage */ }
  const walletCoversPremium = creditsCoverPremium()
  return {
    ...ctx,
    selectedModel: getSelectedModel(),
    availability: getProviderAvailability({ plan, creditsCoverPremium: walletCoversPremium }),
    plan: { plan, isPro: isProActivated(), creditsCoverPremium: walletCoversPremium },
    reflectionLevel: getReflectionLevel(),
  }
}
