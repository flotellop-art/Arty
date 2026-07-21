// C1 (CDC veille 2026-07) : PREMIER test du client Gemini — la cartographie
// avait relevé qu'aucun test ne gardait ni le modèle par défaut ni le
// killswitch. Pattern « garde par source » (comme factCheckEndpoint.test.ts) :
// geminiChatModel() n'est pas exporté, et c'est la présence des bons littéraux
// qui protège contre les régressions silencieuses.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildGeminiGenerationConfig,
  resolveGeminiResearchThinkingLevel,
} from '../../services/geminiClient'

const client = readFileSync(resolve(process.cwd(), 'src/services/geminiClient.ts'), 'utf8')
const catalog = readFileSync(
  resolve(process.cwd(), 'src/services/comparator/providerCatalog.ts'),
  'utf8'
)
const proxy = readFileSync(resolve(process.cwd(), 'functions/api/ai/gemini-proxy.ts'), 'utf8')
const middleware = readFileSync(resolve(process.cwd(), 'functions/api/_middleware.ts'), 'utf8')
const comparator = readFileSync(resolve(process.cwd(), 'src/screens/compare.tsx'), 'utf8')

describe('geminiClient — modèles et killswitch (C1)', () => {
  it('garde le chat en 3.5 et réserve 3.6 à la recherche one-shot', () => {
    expect(client).toMatch(/const GEMINI_CHAT_MODEL = 'gemini-3\.5-flash'/)
    expect(client).toMatch(/const GEMINI_RESEARCH_MODEL = 'gemini-3\.6-flash'/)
    expect(client).toMatch(/const GEMINI_RESEARCH_FALLBACK_MODEL = 'gemini-3\.5-flash'/)
  })

  it("aucun modèle de la famille 2.5 n'est routable par le client", () => {
    // Les entrées 2.5 survivent dans pricing/costTracker (coûts historiques)
    // mais le CLIENT ne doit plus jamais en demander un.
    expect(client).not.toMatch(/'gemini-2\.5[^']*'/)
  })

  it('le killswitch arty-gemini-cheap-disabled reste câblé (rollback du futur downgrade éco)', () => {
    // Inerte aujourd'hui (chat == recherche) mais le câblage doit survivre :
    // c'est le mécanisme de rollback sans redéploiement du prochain downgrade
    // (pattern P1.4). Sa suppression exige une décision écrite.
    expect(client).toMatch(/arty-gemini-cheap-disabled/)
    expect(client).toMatch(/function geminiChatModel\(\)/)
  })

  it('possède un killswitch 3.6 global côté proxy, en plus du secours local', () => {
    expect(client).toMatch(/arty-gemini-36-disabled/)
    expect(proxy).toMatch(/env\.GEMINI_36_DISABLED === 'true'/)
    expect(proxy).toMatch(/x-arty-model-used/)
    expect(middleware).toMatch(/Access-Control-Expose-Headers[^\n]*x-arty-model-used/)
  })

  it('le comparateur ne propose plus aucun modèle 2.5 (404 garantis après le 16/10/2026)', () => {
    expect(catalog).not.toMatch(/modelId: 'gemini-2\.5[^']*'/)
    // Les quatre survivants GA restent proposés.
    expect(catalog).toMatch(/modelId: 'gemini-3\.6-flash'/)
    expect(catalog).toMatch(/modelId: 'gemini-3\.5-flash'/)
    expect(catalog).toMatch(/modelId: 'gemini-3\.5-flash-lite'/)
    expect(catalog).toMatch(/modelId: 'gemini-3\.1-flash-lite'/)
    expect(catalog).toMatch(/provider: 'gemini', modelId: 'gemini-3\.6-flash'/)
  })

  it("aucun ID preview Gemini n'est exposé au comparateur (anti-objectif)", () => {
    expect(catalog).not.toMatch(/modelId: 'gemini[^']*preview[^']*'/)
  })

  it('désactive explicitement les tools dans le comparateur one-shot', () => {
    expect(comparator).toMatch(/systemPrompt: COMPARATOR_SYSTEM_PROMPT,[\s\S]*tools: \[\]/)
  })
})

describe('Gemini 3 — configuration GenerateContent native', () => {
  it('retire temperature et envoie thinkingLevel pour 3.x', () => {
    expect(buildGeminiGenerationConfig('gemini-3.6-flash', {
      temperature: 0.7,
      maxOutputTokens: 8192,
      thinkingBudget: 1024,
    })).toEqual({
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: 'medium' },
    })
  })

  it('conserve le format legacy pour un modèle 2.5 forcé en BYOK', () => {
    expect(buildGeminiGenerationConfig('gemini-2.5-flash', {
      temperature: 0.3,
      maxOutputTokens: 4096,
      thinkingBudget: 512,
    })).toEqual({
      temperature: 0.3,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 512 },
    })
  })

  it('mappe recherche auto→medium, rapide→low et profond→high', () => {
    expect(resolveGeminiResearchThinkingLevel('auto')).toBe('medium')
    expect(resolveGeminiResearchThinkingLevel('rapide')).toBe('low')
    expect(resolveGeminiResearchThinkingLevel('approfondi')).toBe('high')
    expect(resolveGeminiResearchThinkingLevel('max')).toBe('high')
  })
})
