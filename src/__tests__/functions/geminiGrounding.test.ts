// Gemini 3 : l'allocation gratuite se suit par prompt groundé, puis le tarif
// publié s'applique aux requêtes de recherche uniques non vides. Le coût reste
// une borne haute analytique et n'entre jamais dans le wallet.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGeminiParser } from '../../../functions/api/_lib/trackUsage'
import {
  computeCostMicroUsd,
  groundingUpperBoundMicroUsd,
} from '../../../functions/api/_lib/pricing'
import { chargeForUsageMicro } from '../../../functions/api/_lib/creditPricing'

const ZERO = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  audioSeconds: 0,
}

describe('createGeminiParser — grounding Gemini 3', () => {
  it('dédoublonne les requêtes Search SSE et ignore les valeurs vides', () => {
    const parser = createGeminiParser('sse', 'search')
    parser.feed('data: {"candidates":[{"groundingMetadata":{"webSearchQueries":[" météo paris ","", "trafic paris"]}}]}\n\n')
    parser.feed('data: {"candidates":[{"groundingMetadata":{"webSearchQueries":["météo paris","trafic paris"]}}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":50}}\n\n')
    expect(parser.finalize()).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      groundedPrompts: 1,
      searchGroundedPrompts: 1,
      mapsGroundedPrompts: 0,
      searchQueries: 2,
      mapsQueries: 0,
      measured: true,
    })
  })

  it('ventile Maps selon le tool demandé sans inventer de requête absente', () => {
    const parser = createGeminiParser('json', 'maps')
    parser.feed(JSON.stringify({
      candidates: [{ groundingMetadata: { groundingChunks: [{ maps: { uri: 'https://maps.google.com/x' } }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 },
    }))
    expect(parser.finalize()).toMatchObject({
      groundedPrompts: 1,
      searchGroundedPrompts: 0,
      mapsGroundedPrompts: 1,
      searchQueries: 0,
      mapsQueries: 0,
      measured: true,
    })
  })

  it('classe un chunk Maps même sans contexte explicite', () => {
    const parser = createGeminiParser('json')
    parser.feed(JSON.stringify({
      candidates: [{ groundingMetadata: {
        webSearchQueries: ['restaurant lille'],
        groundingChunks: [{ maps: {} }],
      } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }))
    expect(parser.finalize()).toMatchObject({ mapsGroundedPrompts: 1, mapsQueries: 1 })
  })

  it('searchEntryPoint seul reste une preuve de grounding, avec zéro requête observable', () => {
    const parser = createGeminiParser('json', 'search')
    parser.feed(JSON.stringify({
      candidates: [{ groundingMetadata: { searchEntryPoint: { renderedContent: '<div/>' } } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 },
    }))
    expect(parser.finalize()).toMatchObject({
      groundedPrompts: 1,
      searchGroundedPrompts: 1,
      searchQueries: 0,
      measured: true,
    })
  })

  it('ne compte pas un groundingMetadata vide', () => {
    const parser = createGeminiParser('sse', 'search')
    parser.feed('data: {"candidates":[{"groundingMetadata":{"webSearchQueries":[],"groundingChunks":[]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}\n\n')
    expect(parser.finalize()).toMatchObject({
      groundedPrompts: 0,
      searchQueries: 0,
      mapsQueries: 0,
      measured: true,
    })
  })

  it('soustrait le cache du prompt et ajoute les thought tokens à la sortie', () => {
    const parser = createGeminiParser('json')
    parser.feed(JSON.stringify({
      usageMetadata: {
        promptTokenCount: 11_500,
        cachedContentTokenCount: 10_000,
        candidatesTokenCount: 500,
        thoughtsTokenCount: 250,
      },
    }))
    expect(parser.finalize()).toMatchObject({
      inputTokens: 1_500,
      cacheReadTokens: 10_000,
      outputTokens: 750,
      measured: true,
    })
  })

  it('tolère une réponse sans candidates et un chunk malformé', () => {
    const parser = createGeminiParser('sse')
    parser.feed('data: {"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":3}}\n\n')
    parser.feed('data: {"candidates":"oops"}\n\n')
    expect(parser.finalize()).toMatchObject({ groundedPrompts: 0, measured: true })
  })
})

describe('pricing grounding — borne haute seulement', () => {
  it('computeCostMicroUsd ignore prompts et requêtes grounding', () => {
    expect(computeCostMicroUsd('gemini-3.6-flash', {
      ...ZERO,
      groundedPrompts: 1,
      searchQueries: 4,
      mapsQueries: 2,
    })).toBe(0)
    expect(computeCostMicroUsd('gemini-3.6-flash', {
      ...ZERO,
      inputTokens: 1_000_000,
      searchQueries: 10,
    })).toBe(1_500_000)
  })

  it('dérive $0.014 par requête pour les modèles Gemini 3 exposés', () => {
    expect(groundingUpperBoundMicroUsd('gemini-3.6-flash', 1)).toBe(14_000)
    expect(groundingUpperBoundMicroUsd('gemini-3.5-flash-lite', 3)).toBe(42_000)
    expect(groundingUpperBoundMicroUsd('gemini-3.5-flash', 250)).toBe(3_500_000)
    expect(groundingUpperBoundMicroUsd('claude-sonnet-5', 1)).toBe(0)
    expect(groundingUpperBoundMicroUsd('gemini-2.5-flash', 1)).toBe(0)
    expect(groundingUpperBoundMicroUsd('gemini-3.6-flash', -3)).toBe(0)
    expect(groundingUpperBoundMicroUsd('gemini-3.6-flash', Number.NaN)).toBe(0)
  })
})

describe('wallet — le grounding ne débite jamais les crédits', () => {
  it('retombe sur le plancher token-only', () => {
    const { chargeMicro, providerCostMicro } = chargeForUsageMicro('gemini-3.6-flash', {
      ...ZERO,
      groundedPrompts: 1,
      searchQueries: 8,
    })
    expect(providerCostMicro).toBe(0)
    expect(chargeMicro).toBeLessThan(14_000)
  })
})

describe('D1 + API — télémétrie additive', () => {
  const quotaSrc = readFileSync(resolve(process.cwd(), 'functions/api/_lib/quota.ts'), 'utf8')
  const schemaSrc = readFileSync(resolve(process.cwd(), 'schema.sql'), 'utf8')
  const statusSrc = readFileSync(resolve(process.cwd(), 'functions/api/ai/quota/status.ts'), 'utf8')
  const monthSrc = readFileSync(resolve(process.cwd(), 'functions/api/ai/quota/month.ts'), 'utf8')

  it('recordUsage cumule les quatre compteurs détaillés', () => {
    expect(quotaSrc).toMatch(/search_grounded_prompts = search_grounded_prompts \+ \?11/)
    expect(quotaSrc).toMatch(/maps_grounded_prompts = maps_grounded_prompts \+ \?12/)
    expect(quotaSrc).toMatch(/search_queries = search_queries \+ \?13/)
    expect(quotaSrc).toMatch(/maps_queries = maps_queries \+ \?14/)
  })

  it('schema.sql déclare les colonnes additives', () => {
    expect(schemaSrc).toMatch(/search_grounded_prompts INTEGER NOT NULL DEFAULT 0/)
    expect(schemaSrc).toMatch(/maps_grounded_prompts INTEGER NOT NULL DEFAULT 0/)
    expect(schemaSrc).toMatch(/search_queries INTEGER NOT NULL DEFAULT 0/)
    expect(schemaSrc).toMatch(/maps_queries INTEGER NOT NULL DEFAULT 0/)
  })

  it('status et month forwardent les requêtes Search/Maps', () => {
    for (const source of [statusSrc, monthSrc]) {
      expect(source).toMatch(/searchQueries: m\.searchQueries/)
      expect(source).toMatch(/mapsQueries: m\.mapsQueries/)
    }
  })
})
