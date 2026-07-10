// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  resolveCreemCheckoutProduct,
  resolveCreemCreditAmount,
} from '../../../functions/api/_lib/creemProducts'
import type { Env } from '../../../functions/env'

function env(productId?: string): Env {
  return { CREEM_CREDITS_10_PRODUCT_ID: productId } as unknown as Env
}

describe('Creem product configuration', () => {
  it('uses the same configured product for checkout and webhook crediting', () => {
    const configured = env('prod_liveConfigured123')
    expect(resolveCreemCheckoutProduct(configured, 'credits_10')).toBe('prod_liveConfigured123')
    expect(resolveCreemCreditAmount(configured, 'prod_liveConfigured123')).toBe(10_000_000)
  })

  it('fails closed for absent, malformed, unknown pack, or unknown product', () => {
    expect(resolveCreemCheckoutProduct(env(), 'credits_10')).toBeNull()
    expect(resolveCreemCheckoutProduct(env('test-product'), 'credits_10')).toBeNull()
    expect(resolveCreemCheckoutProduct(env('prod_valid123'), 'other')).toBeNull()
    expect(resolveCreemCreditAmount(env('prod_valid123'), 'prod_other')).toBeNull()
  })
})
