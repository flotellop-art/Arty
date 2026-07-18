// C11 (CDC veille 2026-07) : traçage du grounding Gemini — le poste de coût
// dominant du chemin Gemini ($14/1000 prompts groundés, famille 3.x) était
// totalement invisible (aucun champ dans pricing/trackUsage/quota_model).
// Design tranché EN REVUE (2 relecteurs convergents) : persister le VOLUME
// (colonne grounded_prompts) ; le coût borne haute est DÉRIVÉ à la demande
// (groundingUpperBoundMicroUsd) et JAMAIS mélangé dans cost_usd_micro — le
// mélange polluait le conseiller de facturation (biais vers l'abo), le
// dashboard Coûts (coût gonflé sans explication, BUG 60) et divergeait du
// ledger wallet. Facturation réelle souvent 0 (palier gratuit ~5 000/mois).
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

describe('pricing grounding — borne haute DÉRIVÉE, jamais dans le coût facturable (revue C11)', () => {
  it('computeCostMicroUsd IGNORE groundedPrompts — garde anti-pollution (advisor, dashboard, ledger)', () => {
    // Invariant exigé par les 2 relecteurs : cost_usd_micro reste token-only.
    // Sans ça, le conseiller de facturation sur-estime BYOK/crédits (biais
    // vers l'abo) et le badge TopBar gonfle sans explication (BUG 60).
    expect(computeCostMicroUsd('gemini-3.5-flash', { ...ZERO, groundedPrompts: 1 })).toBe(0)
    expect(
      computeCostMicroUsd('gemini-3.5-flash', {
        ...ZERO,
        inputTokens: 1_000_000,
        groundedPrompts: 1,
      })
    ).toBe(1_500_000) // tokens seuls — pas de +14 000
  })

  it('groundingUpperBoundMicroUsd dérive la borne haute depuis le volume', () => {
    expect(groundingUpperBoundMicroUsd('gemini-3.5-flash', 1)).toBe(14000)
    expect(groundingUpperBoundMicroUsd('gemini-3.1-flash-lite', 1)).toBe(14000)
    expect(groundingUpperBoundMicroUsd('gemini-3.5-flash', 250)).toBe(3_500_000) // 250 × $0.014 = $3.50
    // Modèles sans tarif grounding (dont la famille 2.5, plus routée) → 0.
    expect(groundingUpperBoundMicroUsd('claude-sonnet-5', 1)).toBe(0)
    expect(groundingUpperBoundMicroUsd('gemini-2.5-flash', 1)).toBe(0)
    // Entrées dégénérées bornées.
    expect(groundingUpperBoundMicroUsd('gemini-3.5-flash', -3)).toBe(0)
    expect(groundingUpperBoundMicroUsd('gemini-3.5-flash', Number.NaN)).toBe(0)
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

describe('câblage D1 + exposition — le volume groundé est persisté et forwardé (gardes par source)', () => {
  const quotaSrc = readFileSync(resolve(process.cwd(), 'functions/api/_lib/quota.ts'), 'utf8')
  const schemaSrc = readFileSync(resolve(process.cwd(), 'schema.sql'), 'utf8')

  it('recordUsage insère ET cumule grounded_prompts', () => {
    expect(quotaSrc).toMatch(/grounded_prompts, cost_usd_micro, updated_at/)
    expect(quotaSrc).toMatch(/grounded_prompts = grounded_prompts \+ \?10/)
  })

  it('schema.sql (rollup prod, F-12) déclare la colonne', () => {
    expect(schemaSrc).toMatch(/grounded_prompts INTEGER NOT NULL DEFAULT 0/)
  })

  it('les endpoints status/month forwardent le volume (revue C11 : sans lui, le champ client est mort)', () => {
    const statusSrc = readFileSync(
      resolve(process.cwd(), 'functions/api/ai/quota/status.ts'),
      'utf8'
    )
    const monthSrc = readFileSync(resolve(process.cwd(), 'functions/api/ai/quota/month.ts'), 'utf8')
    expect(statusSrc).toMatch(/groundedPrompts: m\.groundedPrompts/)
    expect(monthSrc).toMatch(/groundedPrompts: m\.groundedPrompts/)
  })
})
