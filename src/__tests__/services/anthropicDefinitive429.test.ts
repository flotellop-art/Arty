import { describe, expect, it, vi } from 'vitest'

vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }))

const { isDefinitiveProxy429 } = await import('../../services/anthropicClient')

// Issue #393 — le client retentait le 429 du quota journalier du proxy comme
// un rate limit upstream : chaque essai repassait par l'admission.
describe('isDefinitiveProxy429', () => {
  it('reconnaît le cap premium mensuel', () => {
    expect(isDefinitiveProxy429(JSON.stringify({ error: 'premium_cap_reached', bucket: 'claude-sonnet', cap: 150 }))).toBe(true)
  })
  it('reconnaît le quota journalier du proxy', () => {
    expect(isDefinitiveProxy429(JSON.stringify({ error: 'Quota journalier atteint', count: 51, limit: 50 }))).toBe(true)
  })
  it.each([
    '',
    'Too Many Requests',
    JSON.stringify({ error: 'AI service error' }),
    JSON.stringify({ error: { type: 'rate_limit_error' } }),
    JSON.stringify({ count: '51', limit: 50 }),
    'null',
  ])('laisse retenter un rate limit upstream : %s', body => {
    expect(isDefinitiveProxy429(body)).toBe(false)
  })
})
