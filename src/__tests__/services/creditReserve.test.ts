import { describe, expect, it } from 'vitest'
import { estimateReserveMicro } from '../../../functions/api/_lib/creditPricing'
import {
  enforceWalletOutputLimit,
  estimateInputTokens,
} from '../../../functions/api/_lib/walletBilling'

describe('wallet reservation covers the provider maximum', () => {
  const OPUS = 'claude-opus-4-8'

  it('includes large prompt input in the hold', () => {
    const withoutInput = estimateReserveMicro(OPUS, 1_000, 0)
    const withLargeInput = estimateReserveMicro(OPUS, 1_000, 200_000)
    expect(withLargeInput).toBeGreaterThan(withoutInput)
    expect(estimateReserveMicro(OPUS, undefined, 200_000)).toBeGreaterThan(4_000_000)
  })

  it('keeps the historical optional input argument compatible and finite', () => {
    expect(estimateReserveMicro(OPUS, 1_000)).toBe(estimateReserveMicro(OPUS, 1_000, 0))
    expect(estimateReserveMicro(OPUS, 1_000, Number.NaN)).toBe(
      estimateReserveMicro(OPUS, 1_000, 0),
    )
    expect(estimateReserveMicro(OPUS, 1_000, -5)).toBe(estimateReserveMicro(OPUS, 1_000, 0))
    expect(Number.isFinite(estimateReserveMicro(OPUS, 1_000, 200_000))).toBe(true)
  })

  it('covers the entire requested max output instead of capping the hold at 8192', () => {
    const at8192 = estimateReserveMicro(OPUS, 8_192, 0)
    const at65536 = estimateReserveMicro(OPUS, 65_536, 0)
    expect(at65536).toBeGreaterThan(at8192 * 7)
  })

  it('counts tool schemas as provider input', () => {
    const plain = estimateInputTokens('anthropic', {
      messages: [{ role: 'user', content: 'bonjour' }],
    })
    const withTools = estimateInputTokens('anthropic', {
      messages: [{ role: 'user', content: 'bonjour' }],
      tools: [{
        name: 'search',
        description: 'Recherche documentaire approfondie',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Requete longue et precise' } },
        },
      }],
    })
    expect(withTools).toBeGreaterThan(plain)
  })

  it('holds conservatively for encoded and remote media', () => {
    const plain = estimateInputTokens('gemini', {
      contents: [{ parts: [{ text: 'analyse cette image' }] }],
    })
    const encoded = estimateInputTokens('gemini', {
      contents: [{ parts: [{ inlineData: { mimeType: 'image/png', data: 'A'.repeat(20_000) } }] }],
    })
    const remote = estimateInputTokens('openai', {
      messages: [{ content: [{ type: 'image_url', image_url: { url: 'https://example.test/photo.jpg' } }] }],
    })
    expect(encoded).toBeGreaterThan(plain + 20_000)
    expect(remote).toBeGreaterThanOrEqual(128_000)
  })

  it('uses a UTF-8 byte upper bound for CJK and emoji input', () => {
    const text = '漢字🙂'
    expect(estimateInputTokens('anthropic', { messages: [{ content: text }] }))
      .toBeGreaterThanOrEqual(new TextEncoder().encode(text).length)
  })

  it('injects and bounds the provider output limit used by the wallet hold', () => {
    const anthropic: Record<string, unknown> = { messages: [] }
    expect(enforceWalletOutputLimit('anthropic', anthropic)).toBe(8_192)
    expect(anthropic.max_tokens).toBe(8_192)

    const openai: Record<string, unknown> = { max_completion_tokens: 999_999 }
    expect(enforceWalletOutputLimit('openai', openai)).toBe(65_536)
    expect(openai.max_completion_tokens).toBe(65_536)

    const gemini: Record<string, unknown> = { generationConfig: { temperature: 0.2 } }
    enforceWalletOutputLimit('gemini', gemini)
    expect(gemini.generationConfig).toMatchObject({ temperature: 0.2, maxOutputTokens: 8_192 })
  })
})
