// Refonte routage (étape 3, F-14) — availability par PLAN, plus par BYOK.
// Verrouille LE cas majoritaire jamais testé avant : un abonné clé-serveur
// (toutes clés BYOK null) doit atteindre Gemini/Mistral en Auto selon son
// plan ; un compte free doit rester sur Claude/Haiku AVANT l'envoi (pas de
// dépendance au 403 model_locked serveur).
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getProviderAvailability } from '../../services/router/availability'
import { resolveRoute } from '../../services/router/resolveRoute'
import type { PlanContext, RouteInput } from '../../services/router/types'

vi.mock('../../services/activeApiKey', () => ({
  getGeminiKey: vi.fn(() => null),
  getMistralKey: vi.fn(() => null),
  getOpenAIKey: vi.fn(() => null),
}))

vi.mock('../../services/modelSelector', () => ({
  getSelectedModel: vi.fn(() => 'auto'),
  detectOpenAIIntent: vi.fn(() => false),
}))

import { getGeminiKey, getMistralKey } from '../../services/activeApiKey'
const mockGemini = vi.mocked(getGeminiKey)
const mockMistral = vi.mocked(getMistralKey)

function setFamilies(families: string[] | null) {
  if (families === null) localStorage.removeItem('arty-allowed-families')
  else localStorage.setItem('arty-allowed-families', JSON.stringify(families))
}

const PAID_FAMILIES = [
  'claude-haiku', 'claude-sonnet', 'claude-opus', 'mistral-medium',
  'gemini-flash', 'gemini-pro', 'gpt-mini', 'gpt-full',
]

beforeEach(() => {
  vi.clearAllMocks()
  mockGemini.mockReturnValue(null)
  mockMistral.mockReturnValue(null)
  setFamilies(null)
})

describe('getProviderAvailability', () => {
  it('sans BYOK ni cache familles → BYOK-only historique (tout fermé sauf Claude)', () => {
    expect(getProviderAvailability()).toEqual({ claude: true, gemini: false, mistral: false, openai: false })
  })

  it('abonné clé-serveur (familles payantes, zéro BYOK) → tout disponible', () => {
    setFamilies(PAID_FAMILIES)
    expect(getProviderAvailability()).toEqual({ claude: true, gemini: true, mistral: true, openai: true })
  })

  it('plan free (claude-haiku seul) → gemini/mistral/openai fermés', () => {
    setFamilies(['claude-haiku'])
    expect(getProviderAvailability()).toEqual({ claude: true, gemini: false, mistral: false, openai: false })
  })

  it('clé BYOK présente → provider ouvert même sans famille serveur', () => {
    setFamilies(['claude-haiku'])
    mockGemini.mockReturnValue('byok-key')
    expect(getProviderAvailability().gemini).toBe(true)
  })

  it('cache corrompu → repli BYOK-only, pas de crash', () => {
    localStorage.setItem('arty-allowed-families', '{pas-un-tableau')
    expect(getProviderAvailability()).toEqual({ claude: true, gemini: false, mistral: false, openai: false })
    localStorage.setItem('arty-allowed-families', '"string"')
    expect(getProviderAvailability().gemini).toBe(false)
  })
})

// ── Le cas réel majoritaire, bout-en-bout via resolveRoute ──────────────────
function route(text: string, plan: PlanContext): ReturnType<typeof resolveRoute> {
  const input: RouteInput = {
    originalText: text,
    hasFiles: false,
    hasPdf: false,
    euOnly: false,
    selectedModel: 'auto',
    availability: getProviderAvailability(),
    plan,
    reflectionLevel: 'auto',
  }
  return resolveRoute(input)
}

describe('abonné clé-serveur en Auto (F-14 — toutes clés BYOK null)', () => {
  const SUB: PlanContext = { plan: 'subscription', isPro: false, creditsCoverPremium: false }
  beforeEach(() => setFamilies(PAID_FAMILIES))

  it('question factuelle → Gemini (plus jamais 100 % Claude)', () => {
    const d = route('Explique-moi la loi de Moore', SUB)
    expect(d.provider).toBe('gemini')
    expect(d.reason.code).toBe('default_capable')
  })

  it('comparatif → hybride (recherche Gemini + rédaction Claude)', () => {
    const d = route('Fais-moi un comparatif des pompes à chaleur', SUB)
    expect(d.provider).toBe('hybrid')
  })

  it('« merci » → Mistral (chemin rapide)', () => {
    const d = route('merci beaucoup', SUB)
    expect(d.provider).toBe('mistral')
    expect(d.reason.code).toBe('trivial_chat')
  })

  it('« mes mails » → Claude (BUG 12, inchangé)', () => {
    const d = route('Montre mes emails non lus', SUB)
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('private_data')
  })

  // BUG 58 — le défaut reste le modèle CAPABLE (Gemini + recherche web),
  // jamais un repli cheap-first.
  it('non-régression BUG 58 : défaut = modèle capable', () => {
    const d = route('Quels sont les patchs Cloudflare Workers de juillet 2026 ?', SUB)
    expect(d.provider).toBe('gemini')
    expect(d.webSearch).toBe(true)
  })
})

describe('compte free en Auto (verrou AVANT envoi, pas de 403)', () => {
  const FREE: PlanContext = { plan: 'free', isPro: false, creditsCoverPremium: false }
  beforeEach(() => setFamilies(['claude-haiku']))

  it.each([
    'Explique-moi la loi de Moore',
    'Fais-moi un comparatif des pompes à chaleur',
    'merci beaucoup',
  ])('« %s » → Claude Haiku (plan_locked_haiku)', (text) => {
    const d = route(text, FREE)
    expect(d.provider).toBe('claude')
    expect(d.subModel).toBe('claude-haiku-4-5-20251001')
    expect(d.subModelReason?.code).toBe('plan_locked_haiku')
  })
})
