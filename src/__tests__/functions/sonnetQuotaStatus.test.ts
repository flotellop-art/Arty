import { describe, expect, it, vi } from 'vitest'
const { snapshot } = vi.hoisted(() => ({ snapshot: vi.fn() }))
vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({ checkAllowedUserPeek: async () => ({ email: 'synthetic@example.test' }) }))
vi.mock('../../../functions/api/_lib/quota', () => ({ getDailyQuotaStatus: snapshot }))
import { onRequestGet } from '../../../functions/api/ai/quota/status'
describe('Sonnet shared quota API contract', () => {
  it.each([undefined, 3])('forwards only a supplied shared admission counter=%s', async quotaCount => {
    snapshot.mockResolvedValue({ day: '2026-10-05', total: 3, limit: 50, byModel: [{ model: 'claude-sonnet-5-5', count: 1,
      limit: 3, quotaCount, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, audioSeconds: 0 }] })
    const res = await onRequestGet({ request: new Request('https://example.invalid/api/ai/quota/status'), env: {} } as never)
    const body = await res.json()
    expect(body.byModel[0].count).toBe(1)
    expect(body.byModel[0].quotaCount).toBe(quotaCount)
  })
})
