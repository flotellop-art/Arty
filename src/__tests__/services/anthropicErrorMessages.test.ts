import { describe, expect, it, vi, beforeEach } from 'vitest'

// Terrain 9 août 2026 — le proxy masque volontairement les erreurs upstream
// de la clé propriétaire derrière « AI service error » (audit F-6), mais le
// status HTTP reste porté. Sans mapping, l'utilisateur voyait cette chaîne
// anglaise brute dans une UI française, sans savoir quoi faire (BUG 59).
// Ces tests verrouillent : plus jamais de message brut à l'écran, et aucune
// information sur l'état de la clé propriétaire dans le texte rendu.

vi.mock('../../i18n', () => ({
  default: {
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  },
}))

const { formatApiErrorForTest } = await import('../../services/anthropicClient')

describe('formatApiError — erreur générique du proxy', () => {
  beforeEach(() => vi.clearAllMocks())

  const GENERIC = JSON.stringify({ error: 'AI service error' })

  it.each([
    [400, 'errors.apiBadRequest'],
    [429, 'errors.apiRateLimit'],
    [529, 'errors.apiOverloaded'],
    [401, 'errors.apiKeyInvalid'],
    [403, 'errors.apiAccessDenied'],
    [500, 'errors.apiServer'],
    [502, 'errors.apiServer'],
    [503, 'errors.apiServer'],
  ])('status %i → message localisé %s', (status, expected) => {
    expect(formatApiErrorForTest(status, GENERIC)).toBe(expected)
  })

  it('un status inattendu reste localisé et porte le code', () => {
    expect(formatApiErrorForTest(418, GENERIC)).toContain('errors.apiConnection')
  })

  it('ne rend JAMAIS la chaîne brute du proxy', () => {
    for (const status of [400, 401, 403, 404, 429, 500, 502, 529, 418]) {
      expect(formatApiErrorForTest(status, GENERIC)).not.toBe('AI service error')
    }
  })

  it('traduit la catégorie billing du proxy en message actionnable', () => {
    const body = JSON.stringify({ error: 'upstream_billing' })
    const out = formatApiErrorForTest(400, body)
    expect(out).toBe('errors.apiUpstreamBilling')
    // Jamais le code machine brut à l'écran.
    expect(out).not.toBe('upstream_billing')
  })

  it('laisse passer les messages explicites de nos propres endpoints', () => {
    const body = JSON.stringify({ error: 'Authentication required — please sign in with Google' })
    expect(formatApiErrorForTest(401, body)).toBe('Authentication required — please sign in with Google')
  })
})
