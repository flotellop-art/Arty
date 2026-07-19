// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  isLemonSqueezyPlan,
  isTrustedLemonSqueezyCheckoutUrl,
  resolveLemonSqueezyStoreId,
  resolveLemonSqueezyVariantId,
} from '../../../functions/api/_lib/lemonSqueezyProducts'
import type { Env } from '../../../functions/env'

const env = {
  LEMONSQUEEZY_STORE_ID: '356349',
  LEMONSQUEEZY_SUBSCRIPTION_VARIANT_ID: '1576081',
  LEMONSQUEEZY_PRO_VARIANT_ID: '1576090',
  LEMONSQUEEZY_PREMIUM_PACK_VARIANT_ID: '1576100',
} as unknown as Env

describe('Lemon Squeezy live configuration', () => {
  it('résout uniquement les plans et IDs positifs configurés', () => {
    expect(isLemonSqueezyPlan('subscription')).toBe(true)
    expect(isLemonSqueezyPlan('pro')).toBe(true)
    expect(isLemonSqueezyPlan('premium_pack')).toBe(true)
    expect(isLemonSqueezyPlan('attacker_variant')).toBe(false)
    expect(resolveLemonSqueezyStoreId(env)).toBe(356349)
    expect(resolveLemonSqueezyVariantId(env, 'subscription')).toBe(1576081)

    expect(resolveLemonSqueezyStoreId({ LEMONSQUEEZY_STORE_ID: '0' } as Env)).toBeNull()
    expect(resolveLemonSqueezyVariantId({
      LEMONSQUEEZY_PRO_VARIANT_ID: '1e6',
    } as Env, 'pro')).toBeNull()
  })

  it('n’accepte que les checkouts HTTPS du store Arty', () => {
    expect(isTrustedLemonSqueezyCheckoutUrl(
      'https://tryarty.lemonsqueezy.com/checkout/custom/checkout-id',
    )).toBe(true)
    expect(isTrustedLemonSqueezyCheckoutUrl(
      'https://evil.example/checkout/custom/checkout-id',
    )).toBe(false)
    expect(isTrustedLemonSqueezyCheckoutUrl(
      'http://tryarty.lemonsqueezy.com/checkout/custom/checkout-id',
    )).toBe(false)
    expect(isTrustedLemonSqueezyCheckoutUrl(
      'https://tryarty.lemonsqueezy.com.evil.example/checkout/custom/checkout-id',
    )).toBe(false)
  })
})
