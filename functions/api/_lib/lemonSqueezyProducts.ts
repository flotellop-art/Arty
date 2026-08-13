import type { Env } from '../../env'

const VARIANT_ENV_BY_PLAN = {
  subscription: 'LEMONSQUEEZY_SUBSCRIPTION_VARIANT_ID',
  pro: 'LEMONSQUEEZY_PRO_VARIANT_ID',
  premium_pack: 'LEMONSQUEEZY_PREMIUM_PACK_VARIANT_ID',
} as const

export type LemonSqueezyPlan = keyof typeof VARIANT_ENV_BY_PLAN

export function isLemonSqueezyPlan(value: unknown): value is LemonSqueezyPlan {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VARIANT_ENV_BY_PLAN, value)
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function resolveLemonSqueezyStoreId(env: Env): number | null {
  return parsePositiveInteger(env.LEMONSQUEEZY_STORE_ID)
}

export function resolveLemonSqueezyVariantId(
  env: Env,
  plan: LemonSqueezyPlan,
): number | null {
  return parsePositiveInteger(env[VARIANT_ENV_BY_PLAN[plan]])
}

export function isTrustedLemonSqueezyCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:'
      && url.hostname === 'tryarty.lemonsqueezy.com'
      && url.pathname.startsWith('/checkout/')
    )
  } catch {
    return false
  }
}
