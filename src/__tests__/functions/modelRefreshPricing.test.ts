import { describe, expect, it } from 'vitest'
import { computeCostMicroUsd, getPricing } from '../../../functions/api/_lib/pricing'
import { estimateReserveMicro, applyMarkup } from '../../../functions/api/_lib/creditPricing'
import { createOpenAIParser } from '../../../functions/api/_lib/trackUsage'
import { calculateCost, EUR_PER_USD } from '../../services/costTracker'
import { estimateCostEur } from '../../services/comparator/tokenEstimator'

describe('September model pricing across context and cache boundaries', () => {
  it.each([
    ['gpt-5.6-luna', 272_000, 0.2, 1.2], ['gpt-5.6-terra', 272_000, 2, 12],
    ['gpt-5.6-sol', 272_000, 4, 20], ['gpt-6-astra', 272_000, 10, 50],
    ['gemini-3.1-pro-preview', 200_000, 2, 12],
  ] as const)('%s uses the full request tier, including cached input', (model, threshold, input, output) => {
    for (const count of [threshold - 1, threshold, threshold + 1]) {
      const long = count > threshold
      const rate = { input: input * (long ? 2 : 1), output: output * (long ? 1.5 : 1) }
      expect(getPricing(model, count)).toMatchObject(rate)
      const fullCost = count * rate.input + 100 * rate.output
      expect(estimateReserveMicro(model, 100, count)).toBeGreaterThanOrEqual(applyMarkup(fullCost, model, 'text'))
      const cacheMissCost = count * rate.input * (model.startsWith('gpt-') ? 1.25 : 1) + 100 * rate.output
      expect(estimateReserveMicro(model, 100, count)).toBeGreaterThanOrEqual(applyMarkup(cacheMissCost, model, 'text'))
      expect(estimateReserveMicro(model, 100, count)).toBeLessThanOrEqual(applyMarkup(cacheMissCost, model, 'text') + 3)
      expect(calculateCost(model, count, 100)).toBeCloseTo(fullCost / 1e6 * EUR_PER_USD)
      expect(estimateCostEur(model, count, 100)).toBeCloseTo(fullCost / 1e6 * EUR_PER_USD)
      const cacheReadTokens = count - 100
      expect(computeCostMicroUsd(model, { inputTokens: 100, cacheReadTokens, cacheCreationTokens: 0, outputTokens: 100, audioSeconds: 0 }))
        .toBe(Math.round(100 * rate.input + cacheReadTokens * rate.input / 10 + 100 * rate.output))
    }
  })
  it('uses the Fable 5.1 cache discount rather than a generic Claude multiplier', () => {
    expect(computeCostMicroUsd('claude-fable-5-1', { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1_000_000, audioSeconds: 0 })).toBe(250_000)
  })
  it.each(['json', 'sse'] as const)('splits OpenAI cached input once (%s), preserving reasoning output tokens', format => {
    const parser = createOpenAIParser(format)
    const json = JSON.stringify({ usage: { prompt_tokens: 272001, prompt_tokens_details: { cached_tokens: 270000 }, completion_tokens: 123, completion_tokens_details: { reasoning_tokens: 100 } } })
    parser.feed(format === 'sse' ? `data: ${json}\n\n` : json)
    expect(parser.finalize()).toMatchObject({ inputTokens: 2001, cacheReadTokens: 270000, outputTokens: 123, measured: true })
  })
  it.each([-1, 31, '20', null])('does not discount invalid cached token value %s', cached => {
    const parser = createOpenAIParser('json')
    parser.feed(JSON.stringify({ usage: { prompt_tokens: 30, prompt_tokens_details: { cached_tokens: cached }, completion_tokens: 3 } }))
    expect(parser.finalize()).toMatchObject({ inputTokens: 30, cacheReadTokens: 0 })
  })
  it('retains the previous full input charge for a legacy model without a cache price', () => {
    const parser = createOpenAIParser('json')
    parser.feed(JSON.stringify({ usage: { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 800 }, completion_tokens: 10 } }))
    expect(computeCostMicroUsd('gpt-5', parser.finalize())).toBe(1350)
  })
  it.each(['json', 'sse'] as const)('bills OpenAI cache writes separately (%s)', format => {
    const parser = createOpenAIParser(format)
    const json = JSON.stringify({ usage: { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 900 }, completion_tokens: 0 } })
    parser.feed(format === 'sse' ? `data: ${json}\n\n` : json)
    expect(parser.finalize()).toMatchObject({ inputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 900, measured: true })
    expect(computeCostMicroUsd('gpt-6-astra', parser.finalize())).toBe(12_250)
    expect(estimateReserveMicro('gpt-6-astra', 1, 1000)).toBeGreaterThanOrEqual(applyMarkup(12_250, 'gpt-6-astra', 'text'))
  })
  it('does not subtract overlapping OpenAI cache categories', () => {
    const parser = createOpenAIParser('json')
    parser.feed(JSON.stringify({ usage: { prompt_tokens: 30, prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 20 }, completion_tokens: 3 } }))
    expect(parser.finalize()).toMatchObject({ inputTokens: 30, cacheReadTokens: 0, cacheCreationTokens: 0 })
  })
  it('replaces cumulative SSE snapshots without subtracting cached tokens twice', () => {
    const parser = createOpenAIParser('sse')
    for (const output of [3, 10]) parser.feed(`data: ${JSON.stringify({ usage: { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 800 }, completion_tokens: output } })}\n\n`)
    expect(parser.finalize()).toMatchObject({ inputTokens: 200, cacheReadTokens: 800, outputTokens: 10, measured: true })
  })
})
