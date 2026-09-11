import { afterEach, describe, expect, it, vi } from 'vitest'
import { gemini38Pricing } from '../../services/gemini38Pricing'
import { getPricing, hasKnownPricing } from '../../../functions/api/_lib/pricing'
import { calculateCost, EUR_PER_USD, MODEL_COSTS, normaliseModel } from '../../services/costTracker'
import { classifyPremiumModel } from '../../../functions/api/_lib/checkPremiumCap'
afterEach(() => vi.useRealTimers())
describe('Gemini 3.8 video pricing', () => {
  it.each([
    ['2026-09-11T12:00:00Z', 0.75, 3.75],
    ['2026-12-31T23:59:59Z', 0.75, 3.75],
    ['2027-01-01T00:00:00Z', 1.5, 7.5],
  ])('keeps server and client aligned at %s', (date, input, output) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(date))
    expect(gemini38Pricing()).toMatchObject({ input, output })
    expect(getPricing('gemini-3.8-flash')).toMatchObject({ input, output })
    expect(MODEL_COSTS[normaliseModel('gemini-3.8-flash')]).toEqual({ input, output })
    expect(calculateCost('gemini-3.8-flash', 1_000_000, 1_000_000)).toBeCloseTo((Number(input) + Number(output)) * EUR_PER_USD)
    expect(hasKnownPricing('gemini-3.8-flash')).toBe(true)
    expect(classifyPremiumModel('gemini-3.8-flash')).toBeNull()
  })
})
