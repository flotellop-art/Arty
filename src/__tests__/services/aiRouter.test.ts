import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectProvider } from '../../services/aiRouter'

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
    'Norme RE2020 pour la rénovation',
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
// AUTO MODE — simple chat fallback
// ──────────────────────────────────────────────
describe('auto mode — simple chat fallback', () => {
  it('→ mistral when Mistral key available', () => {
    withKeys({ mistral: true })
    expect(detectProvider('Bonjour, comment ça va ?')).toBe('mistral')
  })

  it('→ claude when neither Gemini nor Mistral key', () => {
    withKeys({})
    expect(detectProvider('Bonjour, comment ça va ?')).toBe('claude')
  })

  it('→ claude when only Gemini key and no web trigger', () => {
    withKeys({ gemini: true })
    expect(detectProvider('Explique-moi la loi de Moore')).toBe('claude')
  })

  it('→ mistral when Gemini + Mistral, no triggers', () => {
    withKeys({ gemini: true, mistral: true })
    expect(detectProvider('Raconte-moi une blague')).toBe('mistral')
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
