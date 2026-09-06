/** Fixed aggregate dimensions only. No identity, content or client timestamp. */
// Publication gate, not a user's consent. Enable only in a reviewed release
// after the privacy notice and its existing notice-period commitment are settled.
export const PRODUCT_MEASUREMENT_RELEASED = false
export const PRODUCT_MEASUREMENT_PATH = '/api/measurement/client-reply-v1'
export const PRODUCT_MEASUREMENT_BODY_BYTES = 256
export const PRODUCT_MEASUREMENT_DAILY_CAP = 10_000
export const PRODUCT_MEASUREMENT_OUTCOMES = ['saved', 'empty', 'error', 'stopped', 'not_saved', 'not_started'] as const
export type ProductMeasurementOutcome = typeof PRODUCT_MEASUREMENT_OUTCOMES[number]
export interface ProductMeasurementDeclaration {
  version: 1; flow: 'client-reply'; outcome: ProductMeasurementOutcome; platform: 'web'
}
export function parseProductMeasurement(value: unknown): ProductMeasurementDeclaration | null {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 4) return null
  for (const key of ['version', 'flow', 'outcome', 'platform']) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) return null
  }
  const v = value as Record<string, unknown>
  if (v.version !== 1 || v.flow !== 'client-reply' || v.platform !== 'web' || !PRODUCT_MEASUREMENT_OUTCOMES.includes(v.outcome as ProductMeasurementOutcome)) return null
  return { version: 1, flow: 'client-reply', outcome: v.outcome as ProductMeasurementOutcome, platform: 'web' }
}
