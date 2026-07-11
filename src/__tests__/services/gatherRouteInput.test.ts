// Refonte routage (étape 6) — gatherRouteInput est la SEULE glue impure entre
// les singletons (sélecteur, plan cache, clés, reflexion, wallet) et le moteur
// pur resolveRoute. L'ex-logique d'orchestration de useConversation
// (euOnly/fichiers/manuel) vit désormais dans resolveRoute (testée dans
// resolveRoute.test.ts + availability.test.ts) ; ici on verrouille que la
// collecte lit les bonnes sources.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { gatherRouteInput } from '../../services/router/gatherRouteInput'
import { resolveRoute } from '../../services/router/resolveRoute'

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

import { getSelectedModel } from '../../services/modelSelector'
import { getReflectionLevel } from '../../services/reflectionLevel'
import { isProActivated } from '../../services/proLicense'

const CTX = { originalText: 'Explique-moi la loi de Moore', hasFiles: false, hasPdf: false, euOnly: false }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSelectedModel).mockReturnValue('auto')
  vi.mocked(getReflectionLevel).mockReturnValue('auto')
  vi.mocked(isProActivated).mockReturnValue(false)
  localStorage.removeItem('arty-plan-cache')
  localStorage.removeItem('arty-allowed-families')
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
    expect(input.selectedModel).toBe('mistral')
    expect(input.reflectionLevel).toBe('approfondi')
    expect(input.plan).toEqual({ plan: 'subscription', isPro: true, creditsCoverPremium: false })
  })

  it('availability branchée sur le cache familles (F-14)', () => {
    localStorage.setItem('arty-allowed-families', JSON.stringify(['claude-haiku', 'gemini-flash', 'mistral-medium']))
    const input = gatherRouteInput(CTX)
    expect(input.availability).toEqual({ claude: true, gemini: true, mistral: true, openai: false })
  })

  it('plan cache absent → plan null (resolveRoute ne verrouille pas Haiku)', () => {
    const input = gatherRouteInput(CTX)
    expect(input.plan.plan).toBeNull()
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
