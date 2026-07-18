// C11 (CDC veille 2026-07) : traçage du grounding Gemini — le poste de coût
// dominant du chemin Gemini ($14/1000 prompts groundés, famille 3.x) était
// totalement invisible (aucun champ dans pricing/trackUsage/quota_model).
// Design tranché : tracer le VOLUME (grounded_prompts D1) + le coût théorique
// BORNE HAUTE dans cost_usd_micro ; la facturation réelle dépend du palier
// gratuit Google partagé (~5 000/mois) donc le coût réel est souvent 0 — et le
// wallet ne débite JAMAIS ce poste (test runtime ci-dessous).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGeminiParser } from '../../../functions/api/_lib/trackUsage'
import { computeCostMicroUsd } from '../../../functions/api/_lib/pricing'
import { chargeForUsageMicro } from '../../../functions/api/_lib/creditPricing'

const ZERO = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  audioSeconds: 0,
}

describe('createGeminiParser — détection du grounding (C11)', () => {
  it('SSE : un chunk avec webSearchQueries non vide → groundedPrompts = 1', () => {
    const parser = createGeminiParser('sse')
    parser.feed('data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}\n\n')
    parser.feed(
      'data: {"candidates":[{"groundingMetadata":{"webSearchQueries":["météo paris"],"groundingChunks":[{"web":{"uri":"https://x"}}]}}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":50}}\n\n'
    )
    expect(parser.finalize()).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      groundedPrompts: 1,
      measured: true,
    })
  })

  it('plafonné à 1 par réponse (facturation Google PAR PROMPT, pas par chunk)', () => {
    const parser = createGeminiParser('sse')
    parser.feed('data: {"candidates":[{"groundingMetadata":{"webSearchQueries":["a"]}}]}\n\n')
    parser.feed('data: {"candidates":[{"groundingMetadata":{"webSearchQueries":["b","c"]}}]}\n\n')
    parser.feed('data: {"candidates":[{"groundingMetadata":{"groundingChunks":[{"web":{}}]}}]}\n\n')
    expect(parser.finalize().groundedPrompts).toBe(1)
  })

  it('groundingMetadata vide ou à tableaux vides → PAS groundé (tools déclarés sans recherche émise)', () => {
    const parser = createGeminiParser('sse')
    parser.feed('data: {"candidates":[{"groundingMetadata":{}}]}\n\n')
    parser.feed(
      'data: {"candidates":[{"groundingMetadata":{"webSearchQueries":[],"groundingChunks":[]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}\n\n'
    )
    expect(parser.finalize()).toMatchObject({ groundedPrompts: 0, measured: true })
  })

  it('searchEntryPoint seul suffit comme preuve de grounding', () => {
    const parser = createGeminiParser('json')
    parser.feed(
      JSON.stringify({
        candidates: [{ groundingMetadata: { searchEntryPoint: { renderedContent: '<div/>' } } }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 },
      })
    )
    expect(parser.finalize()).toMatchObject({ groundedPrompts: 1, measured: true })
  })

  it('réponse sans candidates (ou malformée) → groundedPrompts 0, pas de crash', () => {
    const parser = createGeminiParser('sse')
    parser.feed('data: {"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":3}}\n\n')
    parser.feed('data: {"candidates":"oops"}\n\n')
    expect(parser.finalize()).toMatchObject({ groundedPrompts: 0, measured: true })
  })
})

describe('pricing grounding — borne haute $14/1000 (C11)', () => {
  it('1 prompt groundé sur la famille 3.x = 14 000 µ$ (s’additionne aux tokens)', () => {
    expect(computeCostMicroUsd('gemini-3.5-flash', { ...ZERO, groundedPrompts: 1 })).toBe(14000)
    expect(computeCostMicroUsd('gemini-3.1-flash-lite', { ...ZERO, groundedPrompts: 1 })).toBe(14000)
    // Additif : 1M tokens input ($1.5) + grounding ($0.014) sur 3.5-flash.
    expect(
      computeCostMicroUsd('gemini-3.5-flash', {
        ...ZERO,
        inputTokens: 1_000_000,
        groundedPrompts: 1,
      })
    ).toBe(1_500_000 + 14000)
  })

  it('groundedPrompts est inerte sur les modèles sans tarif grounding', () => {
    expect(computeCostMicroUsd('claude-sonnet-5', { ...ZERO, groundedPrompts: 1 })).toBe(0)
    // Famille 2.5 : plus routée depuis C1, volontairement pas pricée grounding.
    expect(computeCostMicroUsd('gemini-2.5-flash', { ...ZERO, groundedPrompts: 1 })).toBe(0)
  })
})

describe('wallet — le grounding ne débite JAMAIS les crédits (C11, stratégie confiance)', () => {
  it('chargeForUsageMicro ignore groundedPrompts : coût fournisseur 0, plancher seul', () => {
    const { chargeMicro, providerCostMicro } = chargeForUsageMicro('gemini-3.5-flash', {
      ...ZERO,
      groundedPrompts: 1,
    })
    expect(providerCostMicro).toBe(0)
    // Le débit retombe sur le plancher anti-poussière, PAS sur les 14 000 µ$.
    expect(chargeMicro).toBeLessThan(14000)
  })
})

describe('câblage D1 — le volume groundé est persisté (gardes par source)', () => {
  const quotaSrc = readFileSync(resolve(process.cwd(), 'functions/api/_lib/quota.ts'), 'utf8')
  const schemaSrc = readFileSync(resolve(process.cwd(), 'schema.sql'), 'utf8')

  it('recordUsage insère ET cumule grounded_prompts', () => {
    expect(quotaSrc).toMatch(/grounded_prompts, cost_usd_micro, updated_at/)
    expect(quotaSrc).toMatch(/grounded_prompts = grounded_prompts \+ \?10/)
  })

  it('schema.sql (rollup prod, F-12) déclare la colonne', () => {
    expect(schemaSrc).toMatch(/grounded_prompts INTEGER NOT NULL DEFAULT 0/)
  })
})
