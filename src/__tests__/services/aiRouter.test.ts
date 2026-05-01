import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectProvider, needsThinking, selectClaudeSubModel } from '../../services/aiRouter'
import { getGeminiThinkingBudget } from '../../services/geminiClient'

// Mock the two external dependencies
vi.mock('../../services/activeApiKey', () => ({
  getGeminiKey: vi.fn(),
  getMistralKey: vi.fn(),
  getOpenAIKey: vi.fn(),
}))

vi.mock('../../services/modelSelector', () => ({
  getSelectedModel: vi.fn(),
  detectOpenAIIntent: vi.fn(() => false),
}))

import { getGeminiKey, getMistralKey, getOpenAIKey } from '../../services/activeApiKey'
import { getSelectedModel } from '../../services/modelSelector'

const mockGetGeminiKey = vi.mocked(getGeminiKey)
const mockGetMistralKey = vi.mocked(getMistralKey)
const mockGetOpenAIKey = vi.mocked(getOpenAIKey)
const mockGetSelectedModel = vi.mocked(getSelectedModel)

// Helper to configure key availability
function withKeys({ gemini = false, mistral = false, openai = false } = {}) {
  mockGetGeminiKey.mockReturnValue(gemini ? 'gemini-key' : null)
  mockGetMistralKey.mockReturnValue(mistral ? 'mistral-key' : null)
  mockGetOpenAIKey.mockReturnValue(openai ? 'openai-key' : null)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSelectedModel.mockReturnValue('auto')
  withKeys({ gemini: false, mistral: false, openai: false })
})

// ──────────────────────────────────────────────
// AUTO MODE — private data always → Claude
// ──────────────────────────────────────────────
describe('auto mode — private data → claude', () => {
  beforeEach(() => withKeys({ gemini: true, mistral: true }))

  const privateFR = [
    'Montre-moi mes mails non lus',
    'Accède à mes emails reçus',
    'Liste mes fichiers Drive',
    'Quels sont mes documents importants ?',
    'Montre mes clients en cours',
    'Affiche mes factures de mars',
    'Qu\'y a-t-il dans mon agenda demain ?',
    'Ma boîte de réception est pleine',
    'Cherche dans mon drive les contrats',
    'Liste mes devis en attente',
  ]

  const privateEN = [
    'Show my emails',
    'Check my inbox',
    'List my files',
    'Open my documents',
    'Who are my clients this month?',
    'Show my invoices',
    'What is in my calendar today?',
    'Unread emails please',
    'Find in my drive',
    'My schedule for tomorrow',
  ]

  it.each(privateFR)('FR private "%s" → claude', (msg) => {
    expect(detectProvider(msg)).toBe('claude')
  })

  it.each(privateEN)('EN private "%s" → claude', (msg) => {
    expect(detectProvider(msg)).toBe('claude')
  })
})

// ──────────────────────────────────────────────
// AUTO MODE — reports → hybrid (Gemini available)
// ──────────────────────────────────────────────
describe('auto mode — report triggers → hybrid', () => {
  beforeEach(() => withKeys({ gemini: true }))

  const reportsFR = [
    'Fais-moi un rapport sur le marché',
    'Fais moi une analyse du secteur',
    'Fais-moi une étude de la concurrence',
    "Quel est l'état du marché actuel ?",
    'Benchmark des isolants du marché',
    'Tendances du bâtiment en 2024',
    'Norme RE2020 pour la rénovation',
    'Prix au m² pour le crépi',
    'Comparatif PVC contre alu',
    'Comment installer un poêle à bois',
  ]

  const reportsEN = [
    'Write me a report on insulation',
    'Analysis of the construction market',
    'State of the industry 2024',
    'Benchmark the top players',
    'Trend of prices in 2025',
    'Case study on energy renovation',
  ]

  it.each(reportsFR)('FR report "%s" → hybrid', (msg) => {
    expect(detectProvider(msg)).toBe('hybrid')
  })

  it.each(reportsEN)('EN report "%s" → hybrid', (msg) => {
    expect(detectProvider(msg)).toBe('hybrid')
  })

  it('report → claude when no Gemini key', () => {
    withKeys({ gemini: false })
    expect(detectProvider('Fais-moi un rapport sur le marché')).toBe('claude')
  })
})

// ──────────────────────────────────────────────
// AUTO MODE — web/maps/YouTube → gemini
// ──────────────────────────────────────────────
describe('auto mode — web triggers → gemini', () => {
  beforeEach(() => withKeys({ gemini: true }))

  const webFR = [
    'Quelle est la météo demain ?',
    'Cherche sur google maps un restaurant',
    'Dernier résultat du match PSG',
    'Résumé de la page https://example.com',
    'Les vidéos de la chaîne de ce youtubeur',
    'Prix chez point p pour le crépi',
    'Où acheter du sika ?',
    'Quels sont les concurrent dans ma ville ?',
  ]

  const webEN = [
    'What is the weather forecast?',
    'Google maps directions to Paris',
    'Latest match results Premier League',
    'Summary of the blog post https://example.com',
    'YouTube channel latest videos',
    'Where to buy insulation materials?',
    'Competitors near Lyon',
  ]

  it.each(webFR)('FR web "%s" → gemini', (msg) => {
    expect(detectProvider(msg)).toBe('gemini')
  })

  it.each(webEN)('EN web "%s" → gemini', (msg) => {
    expect(detectProvider(msg)).toBe('gemini')
  })

  it('URL trigger → gemini', () => {
    expect(detectProvider('Résume https://example.com/article')).toBe('gemini')
  })

  it('web trigger → claude when no Gemini key', () => {
    withKeys({ gemini: false })
    expect(detectProvider('Météo demain ?')).toBe('claude')
  })
})

// ──────────────────────────────────────────────
// AUTO MODE — default routing (Gemini par défaut + trivial chat fast-path)
// ──────────────────────────────────────────────
describe('auto mode — trivial chat fast-path', () => {
  // Trivial chat (salutations, merci, calculs) bypasse la recherche web
  it('greeting → mistral when Mistral key available', () => {
    withKeys({ mistral: true })
    expect(detectProvider('Bonjour, comment ça va ?')).toBe('mistral')
  })

  it('greeting → mistral even when Gemini available (skip web search)', () => {
    withKeys({ gemini: true, mistral: true })
    expect(detectProvider('Salut !')).toBe('mistral')
  })

  it('greeting → claude when no Mistral key', () => {
    withKeys({ gemini: true })
    expect(detectProvider('Bonjour')).toBe('claude')
  })

  it('thank you → mistral fast-path', () => {
    withKeys({ gemini: true, mistral: true })
    expect(detectProvider('merci beaucoup')).toBe('mistral')
  })

  it('arithmetic → mistral fast-path', () => {
    withKeys({ gemini: true, mistral: true })
    expect(detectProvider('combien font 12 + 7')).toBe('mistral')
  })
})

describe('auto mode — non-trivial defaults to Gemini (web search by default)', () => {
  // Toute question factuelle/générale doit bénéficier de google_search
  // (gratuit côté Gemini) pour des données 2026 à jour, vu que les LLM
  // ont une mémoire limitée à leur date d'entraînement.
  it('factual question → gemini when Gemini key available', () => {
    withKeys({ gemini: true })
    expect(detectProvider('Explique-moi la loi de Moore')).toBe('gemini')
  })

  it('open question → gemini even when Mistral also available', () => {
    withKeys({ gemini: true, mistral: true })
    expect(detectProvider('Quelles sont les nouveautés en IA cette année')).toBe('gemini')
  })

  it('no Gemini key → mistral fallback', () => {
    withKeys({ mistral: true })
    expect(detectProvider('Explique-moi la loi de Moore')).toBe('mistral')
  })

  it('no key at all → claude fallback', () => {
    withKeys({})
    expect(detectProvider('Explique-moi la loi de Moore')).toBe('claude')
  })
})

// ──────────────────────────────────────────────
// FORCED MODEL — user overrides auto
// ──────────────────────────────────────────────
describe('forced model selection', () => {
  it('forced claude → always claude', () => {
    mockGetSelectedModel.mockReturnValue('claude')
    withKeys({ gemini: true, mistral: true })
    expect(detectProvider('Météo demain ?')).toBe('claude')
  })

  it('forced mistral → always mistral', () => {
    mockGetSelectedModel.mockReturnValue('mistral')
    withKeys({ gemini: true, mistral: true })
    expect(detectProvider('Météo demain ?')).toBe('mistral')
  })

  it('forced gemini → gemini for web queries', () => {
    mockGetSelectedModel.mockReturnValue('gemini')
    withKeys({ gemini: true })
    expect(detectProvider('Météo demain ?')).toBe('gemini')
  })

  it('forced gemini + private data → claude (Gemini has no tools)', () => {
    mockGetSelectedModel.mockReturnValue('gemini')
    withKeys({ gemini: true })
    expect(detectProvider('Montre mes emails')).toBe('claude')
  })

  it('forced gemini + non-private → gemini', () => {
    mockGetSelectedModel.mockReturnValue('gemini')
    withKeys({ gemini: true })
    expect(detectProvider('Bonjour !')).toBe('gemini')
  })
})

// ──────────────────────────────────────────────
// needsThinking — 4-tier budget
// ──────────────────────────────────────────────
describe('needsThinking — 4-tier budget', () => {
  it('strategic report → 10000', () => {
    expect(needsThinking('rapport sur le marché').budget).toBe(10000)
  })

  it('debug → 8000', () => {
    expect(needsThinking('debug cette erreur').budget).toBe(8000)
  })

  it('analysis → 3000', () => {
    expect(needsThinking('analyse ce code').budget).toBe(3000)
  })

  it('greeting → disabled', () => {
    expect(needsThinking('bonjour').enabled).toBe(false)
  })
})

// ──────────────────────────────────────────────
// selectClaudeSubModel — sub-model routing
// ──────────────────────────────────────────────
describe('selectClaudeSubModel', () => {
  it('greeting + no thinking + no private data → haiku', () => {
    expect(selectClaudeSubModel('bonjour', { enabled: false, budget: 0 }, false, false))
      .toBe('claude-haiku-4-5-20251001')
  })

  it('debug + thinking → sonnet', () => {
    expect(selectClaudeSubModel('débogue ce code', { enabled: true, budget: 3000 }, false, false))
      .toBe('claude-sonnet-4-6')
  })

  it('strategic report + Pro + max thinking → opus', () => {
    expect(selectClaudeSubModel('rapport stratégique détaillé', { enabled: true, budget: 10000 }, false, true))
      .toBe('claude-opus-4-6')
  })
})

// ──────────────────────────────────────────────
// getGeminiThinkingBudget — request-aware thinking budget
// ──────────────────────────────────────────────
describe('getGeminiThinkingBudget', () => {
  it('weather lookup → 0', () => {
    expect(getGeminiThinkingBudget('météo Paris', false)).toBe(0)
  })

  it('map query (isMapQuery=true) → 0', () => {
    expect(getGeminiThinkingBudget('itinéraire vers Lyon', true)).toBe(0)
  })

  it('analysis → 2048', () => {
    expect(getGeminiThinkingBudget('analyse ce site', false)).toBe(2048)
  })
})

// ──────────────────────────────────────────────
// PRIORITY: private data beats report/web triggers
// ──────────────────────────────────────────────
describe('private data beats other triggers', () => {
  beforeEach(() => withKeys({ gemini: true, mistral: true }))

  it('private + report wording → claude not hybrid', () => {
    // BUG 12: "Rapport sur mes mails" must NOT trigger hybrid
    expect(detectProvider('Rapport sur mes mails non lus')).toBe('claude')
  })

  it('private + URL → claude not gemini', () => {
    expect(detectProvider('Analyse mes fichiers sur https://drive.google.com')).toBe('claude')
  })

  it('private + weather → claude not gemini', () => {
    expect(detectProvider('Quelle météo pour mon agenda demain ?')).toBe('claude')
  })
})
