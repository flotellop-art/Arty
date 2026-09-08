/** Wire contract only: a funding category is not a settled-payment receipt. */
export const ANTHROPIC_FUNDING_HEADER = 'x-arty-funding'
export const ANTHROPIC_REQUIRE_FUNDING_HEADER = 'x-arty-require-funding'
export const ANTHROPIC_CONTINUATION_PATH = '/api/ai/anthropic-continue-v1'
const values = ['v1:byok', 'v1:subscription', 'v1:vip', 'v1:wallet', 'v1:free', 'v1:trial-google', 'v1:trial-email'] as const
export type AnthropicFunding = typeof values[number]
export function parseAnthropicFunding(value: string | null): AnthropicFunding | null {
  return values.includes(value as AnthropicFunding) ? value as AnthropicFunding : null
}
export class AnthropicFundingChanged extends Error {
  constructor() { super('continuation_funding_changed'); this.name = 'AnthropicFundingChanged' }
}
export function fundingChangedResponse(): Response {
  return Response.json({ error: 'continuation_funding_changed' }, { status: 409, headers: { 'cache-control': 'no-store' } })
}
