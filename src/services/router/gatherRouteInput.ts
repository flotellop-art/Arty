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
import { getTrialRemaining } from '../trialClient'
import { creditsCoverPremium } from '../walletClient'
import {
  IMAGE_NORMALIZATION_VERSION,
  MAX_IMAGE_DIMENSION,
  MAX_NORMALIZED_IMAGE_BYTES,
  MAX_NORMALIZED_VISION_BATCH_BYTES,
} from '../imageNormalization'
import {
  isVision4kFoundationEnabled,
  isVisionTerraAutoRoutingEnabled,
} from '../visionFeature'
import { getProviderAvailability } from './availability'
import type { FileAttachment } from '../../types'
import type { RouteInput } from './types'

const MAX_VISION_BATCH_BYTES = MAX_NORMALIZED_VISION_BATCH_BYTES
const MAX_VISION_IMAGES = 4

export interface RouteAttachmentFlags {
  hasFiles: boolean
  hasImages: boolean
  hasPdf: boolean
  hasOtherFiles: boolean
  hasSupportedVisionImages: boolean
}

function isPdf(file: Pick<FileAttachment, 'name' | 'type'>): boolean {
  return file.type.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(file.name)
}

function isImage(file: Pick<FileAttachment, 'name' | 'type'>): boolean {
  return file.type.toLowerCase().startsWith('image/') || /\.(?:jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)
}

function isCanonicalVisionImage(file: FileAttachment): boolean {
  const mime = file.type.toLowerCase()
  return (
    (mime === 'image/jpeg' || mime === 'image/png') &&
    file.normalizationVersion === IMAGE_NORMALIZATION_VERSION &&
    Number.isInteger(file.width) &&
    Number.isInteger(file.height) &&
    (file.width ?? 0) > 0 &&
    (file.height ?? 0) > 0 &&
    (file.width ?? 0) <= MAX_IMAGE_DIMENSION &&
    (file.height ?? 0) <= MAX_IMAGE_DIMENSION &&
    Number.isInteger(file.size) &&
    (file.size ?? 0) > 0 &&
    (file.size ?? 0) <= MAX_NORMALIZED_IMAGE_BYTES
  )
}

/** Classification unique partagée par le routeur live et l'aperçu composer. */
export function classifyRouteAttachments(
  files: readonly FileAttachment[] | null | undefined,
): RouteAttachmentFlags {
  if (!files || files.length === 0) {
    return {
      hasFiles: false,
      hasImages: false,
      hasPdf: false,
      hasOtherFiles: false,
      hasSupportedVisionImages: false,
    }
  }

  const hasImages = files.some(isImage)
  const hasPdf = files.some(isPdf)
  const hasOtherFiles = files.some((file) => !isImage(file) && !isPdf(file))
  const totalBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0)
  const hasSupportedVisionImages =
    hasImages &&
    !hasPdf &&
    !hasOtherFiles &&
    files.length <= MAX_VISION_IMAGES &&
    files.every(isCanonicalVisionImage) &&
    totalBytes <= MAX_VISION_BATCH_BYTES

  return {
    hasFiles: true,
    hasImages,
    hasPdf,
    hasOtherFiles,
    hasSupportedVisionImages,
  }
}

export interface RouteContext {
  originalText: string
  hasFiles: boolean
  hasImages: boolean
  hasPdf: boolean
  hasOtherFiles: boolean
  hasSupportedVisionImages: boolean
  euOnly: boolean
  hasPrivateHistory: boolean
}

export function gatherRouteInput(ctx: RouteContext): RouteInput {
  let plan: string | null = null
  try { plan = localStorage.getItem('arty-plan-cache') } catch { /* contexte sans storage */ }
  const walletCoversPremium = creditsCoverPremium()
  const trialRemaining = getTrialRemaining()
  return {
    ...ctx,
    selectedModel: getSelectedModel(),
    availability: getProviderAvailability({
      plan,
      creditsCoverPremium: walletCoversPremium,
      trialRemaining,
    }),
    plan: { plan, isPro: isProActivated(), creditsCoverPremium: walletCoversPremium },
    reflectionLevel: getReflectionLevel(),
    visionOpenAIEnabled: isVision4kFoundationEnabled(),
    visionAutoRoutingEnabled: isVisionTerraAutoRoutingEnabled(),
  }
}
