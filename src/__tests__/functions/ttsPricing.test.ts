import { describe, expect, it } from 'vitest'
import {
  computeCostMicroUsd,
  hasKnownPricing,
} from '../../../functions/api/_lib/pricing'

// C9 (CDC veille 2026-07) : le TTS n'était PAS tracé du tout — aucune entrée
// pricing, aucun recordUsage. Ces tests figent l'entrée tts-1 et le calcul par
// caractère pour que le traçage ne redevienne pas silencieusement un no-op.
describe('pricing tts-1 (brief vocal)', () => {
  const NO_TOKENS = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    audioSeconds: 0,
  }

  it('tts-1 a une entrée de pricing connue (pas le FALLBACK à $15/$75)', () => {
    expect(hasKnownPricing('tts-1')).toBe(true)
  })

  it('facture $15/1M caractères — un brief max (4096 chars) ≈ $0.0614', () => {
    const micro = computeCostMicroUsd('tts-1', { ...NO_TOKENS, chars: 4096 })
    expect(micro).toBe(Math.round(4096 * (15 / 1_000_000) * 1_000_000))
  })

  it('zéro caractère = zéro coût (pas de coût fantôme par appel)', () => {
    expect(computeCostMicroUsd('tts-1', { ...NO_TOKENS, chars: 0 })).toBe(0)
  })
})
