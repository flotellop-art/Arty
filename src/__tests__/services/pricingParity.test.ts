import { describe, expect, it } from 'vitest'
import { getPricing } from '../../../functions/api/_lib/pricing'
import { MODEL_COSTS, normaliseModel } from '../../services/costTracker'

// Empêche le dashboard/comparateur local d'annoncer une économie fictive par
// rapport au coût réellement utilisé pour le wallet et D1 côté serveur.
describe('parité tarifs client ↔ serveur — modèles de chat exposés', () => {
  const cases: Array<[string, number, number]> = [
    ['claude-haiku-4-5-20251001', 1, 5],
    ['claude-sonnet-5', 3, 15],
    ['claude-opus-4-6', 5, 25],
    ['claude-opus-4-7', 5, 25],
    ['claude-opus-4-8', 5, 25],
    ['gpt-5.6-terra', 2.5, 15], // défaut ChatGPT depuis C3 (18/07)
    ['gpt-5.5', 5, 30], // ancien défaut — parité conservée (coûts historiques)
    // Entrée morte mais la parité est le filet anti-sous-estimation 2× si un
    // jour câblée (fix normalisation C6 — includes('mini') la rabattait sur
    // gpt-5-mini $0.25/$2 alors que le serveur facture $0.5/$3).
    ['gpt-5.5-mini', 0.5, 3],
    ['gpt-5', 1.25, 10],
    ['gpt-5-mini', 0.25, 2],
    ['gemini-2.5-pro', 1.25, 10],
    ['gemini-2.5-flash', 0.3, 2.5],
    ['gemini-2.5-flash-lite', 0.1, 0.4],
    ['gemini-3.1-flash-lite', 0.25, 1.5],
    ['gemini-3.5-flash', 1.5, 9],
    ['gemini-3.5-flash-lite', 0.3, 2.5],
    ['gemini-3.6-flash', 1.5, 7.5],
    ['mistral-small-latest', 0.15, 0.6],
    ['mistral-medium-latest', 1.5, 7.5],
    ['mistral-large-latest', 0.5, 1.5],
  ]

  it.each(cases)('%s = $%s / $%s par MTok', (model, input, output) => {
    expect(getPricing(model)).toMatchObject({ input, output })
    expect(MODEL_COSTS[normaliseModel(model)]).toEqual({ input, output })
  })
})
