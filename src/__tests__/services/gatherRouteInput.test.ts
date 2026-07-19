// Refonte routage (étape 6) — gatherRouteInput est la SEULE glue impure entre
// les singletons (sélecteur, plan cache, clés, reflexion, wallet) et le moteur
// pur resolveRoute. L'ex-logique d'orchestration de useConversation
// (euOnly/fichiers/manuel) vit désormais dans resolveRoute (testée dans
// resolveRoute.test.ts + availability.test.ts) ; ici on verrouille que la
// collecte lit les bonnes sources.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { classifyRouteAttachments, gatherRouteInput } from '../../services/router/gatherRouteInput'
import { resolveRoute } from '../../services/router/resolveRoute'
import type { FileAttachment } from '../../types'

vi.mock('../../services/activeApiKey', () => ({
  getGeminiKey: vi.fn(() => null),
  getMistralKey: vi.fn(() => null),
  getOpenAIKey: vi.fn(() => null),
}))
vi.mock('../../services/modelSelector', () => ({
  getSelectedModel: vi.fn(() => 'auto'),
  detectOpenAIIntent: vi.fn(() => false),
}))
vi.mock('../../services/reflectionLevel', () => ({
  getReflectionLevel: vi.fn(() => 'auto'),
}))
vi.mock('../../services/proLicense', () => ({
  isProActivated: vi.fn(() => false),
}))
vi.mock('../../services/walletClient', () => ({
  creditsCoverPremium: vi.fn(() => false),
}))
vi.mock('../../services/trialClient', () => ({
  getTrialRemaining: vi.fn(() => null),
}))

import { getSelectedModel } from '../../services/modelSelector'
import { getReflectionLevel } from '../../services/reflectionLevel'
import { isProActivated } from '../../services/proLicense'
import { creditsCoverPremium } from '../../services/walletClient'

const CTX = {
  originalText: 'Explique-moi la loi de Moore',
  hasFiles: false,
  hasImages: false,
  hasPdf: false,
  hasOtherFiles: false,
  hasSupportedVisionImages: false,
  euOnly: false,
  hasPrivateHistory: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSelectedModel).mockReturnValue('auto')
  vi.mocked(getReflectionLevel).mockReturnValue('auto')
  vi.mocked(isProActivated).mockReturnValue(false)
  vi.mocked(creditsCoverPremium).mockReturnValue(false)
  localStorage.removeItem('arty-plan-cache')
  localStorage.removeItem('arty-allowed-families')
  localStorage.removeItem('arty-vision-terra-4k-foundation')
  localStorage.removeItem('arty-vision-terra-auto-routing')
})

describe('gatherRouteInput', () => {
  it('recopie le contexte et lit les singletons', () => {
    vi.mocked(getSelectedModel).mockReturnValue('mistral')
    vi.mocked(getReflectionLevel).mockReturnValue('approfondi')
    vi.mocked(isProActivated).mockReturnValue(true)
    localStorage.setItem('arty-plan-cache', 'subscription')

    const input = gatherRouteInput({ ...CTX, hasFiles: true, hasPdf: true, euOnly: true })
    expect(input.originalText).toBe(CTX.originalText)
    expect(input.hasFiles).toBe(true)
    expect(input.hasPdf).toBe(true)
    expect(input.euOnly).toBe(true)
    expect(input.hasPrivateHistory).toBe(false)
    expect(input.selectedModel).toBe('mistral')
    expect(input.reflectionLevel).toBe('approfondi')
    expect(input.plan).toEqual({ plan: 'subscription', isPro: true, creditsCoverPremium: false })
  })

  it('availability branchée sur le cache familles (F-14)', () => {
    localStorage.setItem('arty-plan-cache', 'subscription')
    localStorage.setItem('arty-allowed-families', JSON.stringify(['claude-haiku', 'gemini-flash', 'mistral-medium']))
    const input = gatherRouteInput(CTX)
    expect(input.availability).toEqual({ claude: true, gemini: true, mistral: true, openai: false, openaiVision: false })
  })

  it('Pro One-Time ne transforme jamais le cache familles en accès clé-serveur', () => {
    localStorage.setItem('arty-plan-cache', 'pro')
    localStorage.setItem('arty-allowed-families', JSON.stringify(['gemini-flash', 'mistral-medium', 'gpt-full']))
    const input = gatherRouteInput(CTX)
    expect(input.availability).toEqual({ claude: true, gemini: false, mistral: false, openai: false, openaiVision: false })
  })

  it('essai avec crédits utilise les familles effectives débloquées par le wallet', () => {
    vi.mocked(creditsCoverPremium).mockReturnValue(true)
    localStorage.setItem('arty-plan-cache', 'trial')
    localStorage.setItem('arty-allowed-families', JSON.stringify(['gemini-flash', 'mistral-medium']))
    const input = gatherRouteInput(CTX)
    expect(input.availability).toMatchObject({ gemini: true, mistral: true })
  })

  it('plan cache absent → plan null (resolveRoute ne verrouille pas Haiku)', () => {
    const input = gatherRouteInput(CTX)
    expect(input.plan.plan).toBeNull()
  })

  it('collecte séparément les flags vision manuel et Auto', () => {
    localStorage.setItem('arty-vision-terra-4k-foundation', '1')
    expect(gatherRouteInput(CTX)).toMatchObject({
      visionOpenAIEnabled: true,
      visionAutoRoutingEnabled: false,
    })
    localStorage.setItem('arty-vision-terra-auto-routing', '1')
    expect(gatherRouteInput(CTX)).toMatchObject({
      visionOpenAIEnabled: true,
      visionAutoRoutingEnabled: true,
    })
  })

  // Bout-en-bout de la glue : le chemin complet gatherRouteInput → resolveRoute
  // reproduit le scénario abonné clé-serveur (F-14).
  it('bout-en-bout : abonné clé-serveur → question factuelle routée Gemini', () => {
    localStorage.setItem('arty-plan-cache', 'subscription')
    localStorage.setItem('arty-allowed-families', JSON.stringify(['claude-sonnet', 'gemini-flash', 'mistral-medium']))
    const d = resolveRoute(gatherRouteInput(CTX))
    expect(d.provider).toBe('gemini')
    expect(d.reason.code).toBe('default_capable')
  })

  // Non-régression BUG 12 via le chemin complet : données privées → Claude,
  // jamais hybrid/gemini, même avec toutes les familles ouvertes.
  it('bout-en-bout : « rapport sur mes mails » → Claude (BUG 12)', () => {
    localStorage.setItem('arty-plan-cache', 'subscription')
    localStorage.setItem(
      'arty-allowed-families',
      JSON.stringify(['claude-sonnet', 'gemini-flash', 'gemini-pro', 'mistral-medium', 'gpt-full'])
    )
    const d = resolveRoute(gatherRouteInput({ ...CTX, originalText: 'Fais un rapport sur mes mails' }))
    expect(d.provider).toBe('claude')
    expect(d.needsHybrid).toBe(false)
    expect(d.webSearch).toBe(false)
  })
})

describe('classifyRouteAttachments — contrat vision canonique', () => {
  const image = (id: number, size = 1024): FileAttachment => ({
    id: `img-${id}`,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    size,
    width: 4096,
    height: 3072,
    normalizationVersion: 2,
  })

  it('accepte quatre images canoniques dans 16 Mio', () => {
    expect(classifyRouteAttachments([1, 2, 3, 4].map((id) => image(id, 4 * 1024 * 1024))))
      .toMatchObject({
        hasFiles: true,
        hasImages: true,
        hasPdf: false,
        hasOtherFiles: false,
        hasSupportedVisionImages: true,
      })
  })

  it('refuse cinq images avant le routeur, même si chacune est petite', () => {
    expect(classifyRouteAttachments([1, 2, 3, 4, 5].map((id) => image(id))))
      .toMatchObject({ hasImages: true, hasSupportedVisionImages: false })
  })

  it('refuse un lot mixte image + PDF', () => {
    expect(classifyRouteAttachments([
      image(1),
      { id: 'pdf', name: 'devis.pdf', type: 'application/pdf', size: 1000 },
    ])).toMatchObject({
      hasImages: true,
      hasPdf: true,
      hasSupportedVisionImages: false,
    })
  })

  it('refuse un JPEG ancien sans métadonnées de normalisation', () => {
    expect(classifyRouteAttachments([{
      id: 'legacy', name: 'legacy.jpg', type: 'image/jpeg', size: 1000,
    }])).toMatchObject({ hasImages: true, hasSupportedVisionImages: false })
  })

  it('refuse une image ou un lot hors borne octets', () => {
    expect(classifyRouteAttachments([image(1, 4 * 1024 * 1024 + 1)]).hasSupportedVisionImages)
      .toBe(false)
    expect(classifyRouteAttachments([1, 2, 3, 4, 5].map((id) => image(id, 5 * 1024 * 1024)))
      .hasSupportedVisionImages).toBe(false)
  })

  it('refuse une dimension 4097 px ou une version de normalisation inconnue', () => {
    expect(classifyRouteAttachments([{ ...image(1), width: 4097 }]).hasSupportedVisionImages)
      .toBe(false)
    expect(classifyRouteAttachments([{ ...image(1), normalizationVersion: 3 }]).hasSupportedVisionImages)
      .toBe(false)
    expect(classifyRouteAttachments([{ ...image(1), normalizationVersion: 1 }]).hasSupportedVisionImages)
      .toBe(false)
  })
})
